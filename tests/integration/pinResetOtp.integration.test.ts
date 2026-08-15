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
import { getDb } from "../../server/db";
import { agents, otpTokens } from "../../drizzle/schema";
import {
  callerFor,
  regularUser,
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
});
