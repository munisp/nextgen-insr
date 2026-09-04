/**
 * pinResetOtp.integration.test.ts — OTP brute-force lockout (F-05 residual,
 * THREAT_MODEL.md §7.6).
 *
 * pinReset.resetPin verifies a 6-digit OTP against otp_tokens. There was no
 * attempt counter: an online attacker could grind codes (10^6 space) behind
 * only the generic rate limiter. Now otp_tokens.attempts persists failed
 * verifications and the token LOCKS after MAX_OTP_ATTEMPTS (5) — fail-closed:
 * once locked, even the correct OTP is rejected and a fresh code is required
 * (requestOtp deletes old tokens, so a new code starts a new counter).
 *
 * These tests seed otp_tokens rows directly (the real OTP is only ever
 * delivered via SMS), then exercise the REAL resetPin procedure through the
 * REAL middleware chain against the REAL database.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { eq, like } from "drizzle-orm";
import { SignJWT } from "jose";
import { getDb } from "../../server/db";
import { agents, otpTokens } from "../../drizzle/schema";
import type { User } from "../../drizzle/schema";
import type { TrpcContext } from "../../server/_core/context";
import { getJwtSecret } from "../../server/lib/envValidation";
import {
  callerFor,
  regularUser,
  integrationRouter,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "pinResetOtp";
const AGENT_CODE = "AGT-OTP-0001";
const ORIGINAL_PIN_HASH = "a".repeat(64);

let agentPk = 0;

async function seedOtpToken(
  plaintextOtp: string,
  opts: { expired?: boolean } = {}
): Promise<number> {
  const db = (await getDb())!;
  const hashedOtp = await bcrypt.hash(plaintextOtp, 10);
  const expiresAt = opts.expired
    ? new Date(Date.now() - 60_000)
    : new Date(Date.now() + 10 * 60_000);
  const [row] = await db
    .insert(otpTokens)
    .values({ agentId: agentPk, hashedOtp, expiresAt, used: false })
    .returning();
  return row!.id;
}

async function tokenById(id: number) {
  const db = (await getDb())!;
  const [row] = await db.select().from(otpTokens).where(eq(otpTokens.id, id));
  return row!;
}

async function agentPinHash(): Promise<string> {
  const db = (await getDb())!;
  const [row] = await db.select().from(agents).where(eq(agents.id, agentPk));
  return row!.pinHash;
}

describe("pinReset OTP attempt limiting (integration, real DB)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    const db = (await getDb())!;
    const [a] = await db
      .insert(agents)
      .values({
        agentId: AGENT_CODE,
        name: "OTP Lockout Test Agent",
        phone: "08099990001",
        pinHash: ORIGINAL_PIN_HASH,
        isActive: true,
      })
      .returning();
    agentPk = a!.id;
  });

  afterAll(async () => {
    const db = (await getDb())!;
    await db.delete(otpTokens).where(eq(otpTokens.agentId, agentPk));
    await db.delete(agents).where(like(agents.agentId, "AGT-OTP-%"));
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
  });

  it("correct OTP resets the PIN and consumes the token (single-use)", async () => {
    const tokenId = await seedOtpToken("246810");
    const caller = callerFor(regularUser);
    const res = await caller.pinReset.resetPin({
      agentCode: AGENT_CODE,
      otp: "246810",
      newPin: "9876",
    });
    expect(res.success).toBe(true);

    const token = await tokenById(tokenId);
    expect(token.used).toBe(true);
    expect(await bcrypt.compare("9876", await agentPinHash())).toBe(true);

    // Replay of the same (now used) code is rejected.
    await expectTrpcError(
      caller.pinReset.resetPin({ agentCode: AGENT_CODE, otp: "246810", newPin: "1111" }),
      "BAD_REQUEST"
    );
  });

  it("wrong attempts increment the persisted counter without locking below the cap", async () => {
    const tokenId = await seedOtpToken("135791");
    const caller = callerFor(regularUser);
    for (let i = 0; i < 2; i++) {
      await expectTrpcError(
        caller.pinReset.resetPin({ agentCode: AGENT_CODE, otp: "000000", newPin: "1111" }),
        "BAD_REQUEST"
      );
    }
    const token = await tokenById(tokenId);
    expect(token.attempts).toBe(2);
    expect(token.used).toBe(false);

    // Correct code still works before the cap is reached.
    const res = await caller.pinReset.resetPin({
      agentCode: AGENT_CODE,
      otp: "135791",
      newPin: "4321",
    });
    expect(res.success).toBe(true);
    expect(await bcrypt.compare("4321", await agentPinHash())).toBe(true);
  });

  it("5 wrong attempts LOCK the token — even the correct OTP is then rejected (fail-closed)", async () => {
    // Fresh token; reset the PIN baseline so we can prove no reset happened.
    const db = (await getDb())!;
    await db.delete(otpTokens).where(eq(otpTokens.agentId, agentPk));
    const baselineHash = await agentPinHash();

    const tokenId = await seedOtpToken("555123");
    const caller = callerFor(regularUser);
    for (let i = 0; i < 5; i++) {
      await expectTrpcError(
        caller.pinReset.resetPin({ agentCode: AGENT_CODE, otp: "999999", newPin: "1111" }),
        "BAD_REQUEST"
      );
    }
    const locked = await tokenById(tokenId);
    expect(locked.attempts).toBe(5);

    // The correct OTP no longer helps — the code is burned.
    await expectTrpcError(
      caller.pinReset.resetPin({ agentCode: AGENT_CODE, otp: "555123", newPin: "1111" }),
      "BAD_REQUEST"
    );
    // And the PIN was never changed by any of the attempts.
    expect(await agentPinHash()).toBe(baselineHash);
  });

  it("a fresh code after lockout works — new token, new counter", async () => {
    // Simulate requestOtp's invalidation (it DELETEs prior tokens server-side).
    const db = (await getDb())!;
    await db.delete(otpTokens).where(eq(otpTokens.agentId, agentPk));
    const tokenId = await seedOtpToken("777000");
    expect((await tokenById(tokenId)).attempts).toBe(0);

    const caller = callerFor(regularUser);
    const res = await caller.pinReset.resetPin({
      agentCode: AGENT_CODE,
      otp: "777000",
      newPin: "2468",
    });
    expect(res.success).toBe(true);
    expect(await bcrypt.compare("2468", await agentPinHash())).toBe(true);
  });

  it("expired code is rejected regardless of attempts", async () => {
    const db = (await getDb())!;
    await db.delete(otpTokens).where(eq(otpTokens.agentId, agentPk));
    await seedOtpToken("888999", { expired: true });
    const caller = callerFor(regularUser);
    await expectTrpcError(
      caller.pinReset.resetPin({ agentCode: AGENT_CODE, otp: "888999", newPin: "1111" }),
      "BAD_REQUEST"
    );
  });

  it("unknown agent code is rejected without revealing existence", async () => {
    const caller = callerFor(regularUser);
    await expectTrpcError(
      caller.pinReset.resetPin({
        agentCode: "AGT-OTP-NOPE",
        otp: "123456",
        newPin: "1111",
      }),
      "BAD_REQUEST"
    );
  });

  // ── DD-TSSEC (A7-12): identity binding ────────────────────────────────────
  // A caller holding an agent_session may only drive the reset flow for its
  // OWN agent code; callers without an agent session are bound by the OTP
  // itself (it is only sent to the phone on file).

  async function agentSessionCookie(agentPkForSub: number, agentCode: string) {
    const jwt = await new SignJWT({
      agentId: agentCode,
      name: "Binding Test Agent",
      tier: "1",
      role: "agent",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(String(agentPkForSub))
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(getJwtSecret()));
    return `agent_session=${jwt}`;
  }

  function callerWithCookie(cookie: string) {
    const ctx = {
      user: regularUser as User | null,
      req: {
        headers: { cookie },
      } as unknown as TrpcContext["req"],
      res: {
        cookie: () => undefined,
        clearCookie: () => undefined,
      } as unknown as TrpcContext["res"],
      requestId: "integration-test-request",
    };
    return integrationRouter.createCaller(ctx);
  }

  it("an agent session for a DIFFERENT agent cannot request an OTP (FORBIDDEN)", async () => {
    const cookie = await agentSessionCookie(999999, "AGT-OTP-OTHER");
    const caller = callerWithCookie(cookie);
    await expectTrpcError(
      caller.pinReset.requestOtp({ agentCode: AGENT_CODE, phone: "08099990001" }),
      "FORBIDDEN"
    );
  });

  it("an agent session for a DIFFERENT agent cannot reset the PIN even with a valid OTP (FORBIDDEN)", async () => {
    const db = (await getDb())!;
    await db.delete(otpTokens).where(eq(otpTokens.agentId, agentPk));
    await seedOtpToken("121212");
    const baselineHash = await agentPinHash();

    const cookie = await agentSessionCookie(999999, "AGT-OTP-OTHER");
    const caller = callerWithCookie(cookie);
    await expectTrpcError(
      caller.pinReset.resetPin({ agentCode: AGENT_CODE, otp: "121212", newPin: "1111" }),
      "FORBIDDEN"
    );
    // The PIN was untouched and the OTP was NOT consumed by the rejected call.
    expect(await agentPinHash()).toBe(baselineHash);
  });

  it("a matching agent session may reset its own PIN (positive control)", async () => {
    const db = (await getDb())!;
    await db.delete(otpTokens).where(eq(otpTokens.agentId, agentPk));
    await seedOtpToken("343434");

    const cookie = await agentSessionCookie(agentPk, AGENT_CODE);
    const caller = callerWithCookie(cookie);
    const res = await caller.pinReset.resetPin({
      agentCode: AGENT_CODE,
      otp: "343434",
      newPin: "5151",
    });
    expect(res.success).toBe(true);
    expect(await bcrypt.compare("5151", await agentPinHash())).toBe(true);
  });
});
