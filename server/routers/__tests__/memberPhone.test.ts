/**
 * memberPhone.test.ts — R3 batch 6 (2026-10-01, R3-b6)
 *
 * Real-behavior PGlite tests for server/routers/memberPhone.ts (harness
 * copied from memberIdentity.test.ts — real embedded PostgreSQL, ephemeral
 * probeFreePort, faithful minimal projections: full customers column set +
 * full phone_verification_otps column set from drizzle/schema.ts:5973).
 * The router delegates to the REAL phoneOwnership/phoneOtp implementation
 * (bcrypt-hashed tokens in DB, 5-attempt fail-closed lock, fail-loud SMS;
 * in NODE_ENV=test the Termii helper uses its labelled dev console
 * fallback, so the request path exercises the real DB insert):
 *   - anonymous caller → UNAUTHORIZED on both procs
 *   - session user with no customer profile → NOT_FOUND (caller binding:
 *     the proof binds to the caller's OWN customer record)
 *   - requestPhoneOtp writes a REAL bcrypt-hashed token row (plaintext OTP
 *     never stored) and the response does not echo the phone
 *   - verifyPhoneOtp without a token → BAD_REQUEST, zero rows changed
 *   - wrong OTP → BAD_REQUEST + attempts incremented on the REAL row
 *   - correct OTP with NO Redis (test env): the token is consumed
 *     (used=true) but the call FAILS CLOSED — the proof-marker write
 *     requires Redis (phoneOtp.ts:151, documented R3-b6 limitation), so the
 *     error surfaces instead of a silent pass
 *   - the member input schemas carry no userId/customerId fields (smuggled
 *     keys are stripped — nothing to bind but the session)
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

let PG_PORT = 0;
let PG_URL = "";

async function probeFreePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error("no port"))));
    });
  });
}
let pgliteChild: ChildProcess | null = null;

// Unit-test env: no Permify sidecar (same pattern as memberIdentity); the
// member authz under test is the router's own scoping.
process.env.PERMIFY_FAIL_OPEN = "true";

type Caller = ReturnType<
  (typeof import("../memberPhone"))["memberPhoneRouter"]["createCaller"]
>;
let memberCaller: Caller; // session user id 1 → customer 4242
let noProfileCaller: Caller; // session user id 777 → no customers row
let anonCaller: Caller;

const CALLER_PHONE = "09000000001";
const KNOWN_OTP = "123456";
let seededTokenId = 0;

async function startPglite(): Promise<void> {
  PG_PORT = await probeFreePort();
  PG_URL = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;
  const script = path.resolve(
    __dirname,
    "../../../tests/integration/setup/pgliteServer.mjs"
  );
  pgliteChild = spawn(process.execPath, [script], {
    env: { ...process.env, PGLITE_PORT: String(PG_PORT) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("PGlite start timeout")), 30_000);
    pgliteChild!.stdout!.on("data", d => {
      if (String(d).includes("PGLITE_READY")) {
        clearTimeout(to);
        resolve();
      }
    });
    pgliteChild!.on("exit", c => reject(new Error(`pglite exited ${c}`)));
  });
  process.env.POSTGRES_URL = PG_URL;
}

async function createTablesAndSeed() {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const bcrypt = await import("bcryptjs");
  const db = await getDb();
  if (!db) throw new Error("PGlite DB not reachable");

  // Full customers projection (memberIdentity harness shape).
  await db.execute(sql`
    CREATE TYPE customer_status AS ENUM
      ('pending_kyc', 'active', 'suspended', 'blacklisted')`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      "externalId" varchar(128) UNIQUE,
      "firstName" varchar(64) NOT NULL,
      "lastName" varchar(64) NOT NULL,
      email varchar(320),
      phone varchar(20) NOT NULL UNIQUE,
      bvn text,
      nin text,
      bvn_hash varchar(64),
      nin_hash varchar(64),
      "dateOfBirth" text,
      address text,
      status customer_status NOT NULL DEFAULT 'pending_kyc',
      "kycLevel" integer NOT NULL DEFAULT 0,
      "walletBalance" numeric(15,2) NOT NULL DEFAULT '0.00',
      "dailyLimit" numeric(15,2) NOT NULL DEFAULT '50000.00',
      "monthlyLimit" numeric(15,2) NOT NULL DEFAULT '300000.00',
      "preferredAgentId" integer,
      "keycloakSub" varchar(128) UNIQUE,
      "passwordHash" varchar(256),
      "refreshToken" text,
      "lastLoginAt" timestamp,
      "deletedAt" timestamp,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // phone_verification_otps — full drizzle/schema.ts:5973 column set.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS phone_verification_otps (
      id serial PRIMARY KEY,
      phone varchar(20) NOT NULL,
      hashed_otp varchar(128) NOT NULL,
      purpose varchar(32) NOT NULL DEFAULT 'phone_ownership',
      attempts integer NOT NULL DEFAULT 0,
      used boolean NOT NULL DEFAULT false,
      expires_at timestamp NOT NULL,
      used_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    )`);

  await db.execute(sql`
    INSERT INTO customers (id, "firstName", "lastName", phone, "keycloakSub", "kycLevel", status)
    VALUES
      (4242, 'Member', 'A', ${CALLER_PHONE}, '1', 2, 'active'),
      (9999, 'Member', 'B', '09000000002', '2', 0, 'pending_kyc')
    ON CONFLICT DO NOTHING`);

  // A real bcrypt-hashed token for a KNOWN OTP (verify-path tests).
  const hashed = bcrypt.hashSync(KNOWN_OTP, 10);
  const inserted = await db.execute(sql`
    INSERT INTO phone_verification_otps (phone, hashed_otp, expires_at)
    VALUES ('09011112222', ${hashed}, now() + interval '10 minutes')
    RETURNING id`);
  seededTokenId = Number(
    (inserted as any).rows?.[0]?.id ?? (inserted as any)[0]?.id
  );
}

async function otpRowCount(): Promise<number> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  const r = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM phone_verification_otps`
  );
  return Number((r as any).rows?.[0]?.n ?? (r as any)[0]?.n);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberPhoneRouter } = await import("../memberPhone");
  memberCaller = memberPhoneRouter.createCaller(makeAuthenticatedCtx());
  noProfileCaller = memberPhoneRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: 777 } as any })
  );
  anonCaller = memberPhoneRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("memberPhone router (2026-10-01, R3-b6)", () => {
  it("rejects anonymous callers with UNAUTHORIZED on both procs", async () => {
    await expect(
      anonCaller.requestPhoneOtp({ phone: CALLER_PHONE })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonCaller.verifyPhoneOtp({ phone: CALLER_PHONE, otp: KNOWN_OTP })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns NOT_FOUND when the session user has no customer profile (caller binding)", async () => {
    const before = await otpRowCount();
    await expect(
      noProfileCaller.requestPhoneOtp({ phone: "09033334444" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      noProfileCaller.verifyPhoneOtp({ phone: "09033334444", otp: KNOWN_OTP })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await otpRowCount()).toBe(before);
  });

  it("requestPhoneOtp writes a REAL bcrypt-hashed token row and never echoes the phone", async () => {
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = (await getDb())!;
    const before = await otpRowCount();

    const result = await memberCaller.requestPhoneOtp({
      phone: CALLER_PHONE,
      // Smuggled identity keys are stripped by the schema — the flow binds
      // to the session customer, never to input.
      customerId: 9999,
      userId: 9999,
    } as any);
    expect(result.success).toBe(true);
    expect(JSON.stringify(result)).not.toContain(CALLER_PHONE);
    expect(await otpRowCount()).toBe(before + 1);

    const row = await db.execute(sql`
      SELECT phone, hashed_otp, attempts, used FROM phone_verification_otps
      WHERE phone = ${CALLER_PHONE}`);
    const r = (row as any).rows?.[0] ?? (row as any)[0];
    expect(r.phone).toBe(CALLER_PHONE);
    // bcrypt hash at rest — the plaintext OTP is never stored.
    expect(r.hashed_otp).toMatch(/^\$2[aby]\$/);
    expect(r.attempts).toBe(0);
    expect(r.used).toBe(false);
  });

  it("verifyPhoneOtp with no token → BAD_REQUEST, zero rows changed", async () => {
    const before = await otpRowCount();
    await expect(
      memberCaller.verifyPhoneOtp({ phone: "09055556666", otp: KNOWN_OTP })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await otpRowCount()).toBe(before);
  });

  it("wrong OTP → BAD_REQUEST and the REAL row's attempts increment", async () => {
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = (await getDb())!;

    await expect(
      memberCaller.verifyPhoneOtp({ phone: "09011112222", otp: "000000" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const row = await db.execute(sql`
      SELECT attempts, used FROM phone_verification_otps
      WHERE id = ${seededTokenId}`);
    const r = (row as any).rows?.[0] ?? (row as any)[0];
    expect(r.attempts).toBe(1);
    expect(r.used).toBe(false);
  });

  it("correct OTP without a Redis proof store FAILS CLOSED (documented R3-b6 limitation)", async () => {
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = (await getDb())!;

    // phoneOtp.ts:151 writes the proof marker to Redis WITHOUT a catch —
    // with no Redis in the test env the verified token is consumed but the
    // call surfaces an error instead of a silent pass.
    await expect(
      memberCaller.verifyPhoneOtp({ phone: "09011112222", otp: KNOWN_OTP })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const row = await db.execute(sql`
      SELECT used FROM phone_verification_otps WHERE id = ${seededTokenId}`);
    const r = (row as any).rows?.[0] ?? (row as any)[0];
    expect(r.used).toBe(true);
  });
});
