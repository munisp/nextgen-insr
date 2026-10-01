/**
 * memberReferrals.test.ts — R3 batch 1 (2026-10-01, R3)
 *
 * Real-behavior PGlite tests for server/routers/memberReferrals.ts:
 *   - anonymous caller → UNAUTHORIZED (protectedProcedure)
 *   - session user with no customer profile → NOT_FOUND (non-enumerating)
 *   - scope isolation: referrals keyed by RESOLVED customer.id, never by
 *     caller input
 *   - myCode (2026-10-01, R3-fix): READ-ONLY — returns the caller's existing
 *     still-valid pending code only when the caller has an agent identity
 *     (agents.id coincides with the resolved customers.id — agents has no
 *     member identity link); null otherwise (no agent identity, or only
 *     expired codes). NEVER inserts: referrals.referrer_agent_id FKs to
 *     agents.id (schema.ts:2486-2489, migration 0026), so member-context
 *     minting was removed (23503 → 500, or mis-attribution into the agent
 *     program with persisted bonus fields). The FK is enforced FOR REAL in
 *     this harness, so the read-only contract is exercised against the same
 *     constraint that broke the old minting path.
 *
 * 2026-10-01 (R3-fix-ci): harness rewrite. The previous in-memory fake
 * drizzle chain double resolved queued rows at EVERY chain step regardless
 * of what the router actually awaited, so the resolveSessionCustomer chain
 * (`d.select().from(customers).where(...).limit(1)` — memberReferrals.ts
 * lines 67-71, reached from lines 99/161) mismatched and the suite failed.
 * The production router is verified correct (same chain shape passes in the
 * memberPolicies PGlite suite), so ONLY the harness was replaced: real
 * embedded PostgreSQL (PGlite wire protocol), minimal table projections
 * matching exactly the columns the router selects, real SQL execution. Same
 * scenarios, same expectations; the old `inserted` spy is replaced by real
 * row-count assertions on the referrals table (nothing is ever inserted).
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

// 54394 (distinct from memberPolicies' 54397, memberClaims' 54396,
// memberLoyalty's 54395, auth-f3's 54399 and embedded-factory's 54398) so
// the suites can run concurrently.
// 2026-10-01 (R3-fix-ci2): hardcoded 54394 collided in CI (EADDRINUSE —
// another runner process held it). Probe an ephemeral free port instead;
// PG_URL is computed after the probe in startPglite().
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

// Unit-test env: no Permify sidecar. Explicit insecure opt-in (same pattern
// as memberPolicies) so protectedProcedure passes the base gate; the member
// authz under test is enforced by the router itself.
process.env.PERMIFY_FAIL_OPEN = "true";

type Caller = ReturnType<
  (typeof import("../memberReferrals"))["memberReferralsRouter"]["createCaller"]
>;
let memberCaller: Caller; // session user id 1 → customer 4242 (agent id 4242 exists)
let noAgentCaller: Caller; // session user id 3 → customer 5555 (no agents row)
let expiredCaller: Caller; // session user id 4 → customer 6666 (agent row, only expired code)
let anonCaller: Caller;

const CUSTOMER_ID = 4242;
const OTHER_CUSTOMER_ID = 9999; // foreign agent + foreign referral seeded

// Fixed future expiry for the caller's valid pending code (myCode happy
// path). Far enough ahead to be unambiguous under test TZ=UTC.
const VALID_CODE_EXPIRY = new Date("2027-01-01T00:00:00Z");
const SEEDED_REFERRAL_ROWS = 4; // rewarded + pending + expired + foreign

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
  const db = await getDb();
  if (!db) throw new Error("PGlite DB not reachable");

  // Minimal tables carrying exactly the columns the router projects. Real
  // enum type matching drizzle/schema.ts referralStatusEnum, real FK from
  // referrals.referrer_agent_id → agents.id (schema.ts:2486-2489) so the
  // read-only myCode contract is exercised against the production
  // constraint. referrals uses snake_case column names in the DB mapping.
  await db.execute(sql`
    CREATE TYPE referral_status AS ENUM
      ('pending', 'activated', 'rewarded', 'expired')`);
  // resolveSessionCustomer uses d.select() (full-row projection), so the
  // customers table must carry EVERY schema column (drizzle/schema.ts:1431).
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
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agents (
      id serial PRIMARY KEY,
      "agentId" varchar(32) NOT NULL UNIQUE,
      name varchar(128) NOT NULL,
      phone varchar(20) NOT NULL,
      "pinHash" varchar(128) NOT NULL
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS referrals (
      id serial PRIMARY KEY,
      referrer_agent_id integer NOT NULL REFERENCES agents(id),
      referrer_code varchar(32) NOT NULL,
      referral_code varchar(16) NOT NULL UNIQUE,
      referee_agent_id integer REFERENCES agents(id),
      referee_code varchar(32),
      status referral_status NOT NULL DEFAULT 'pending',
      bonus_points integer NOT NULL DEFAULT 0,
      bonus_cash numeric(10,2) NOT NULL DEFAULT '0',
      activated_at timestamp,
      rewarded_at timestamp,
      expires_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    )`);

  await db.execute(sql`
    INSERT INTO customers (id, "firstName", "lastName", phone, "keycloakSub")
    VALUES
      (4242, 'Member', 'A', '09000000001', '1'),
      (9999, 'Member', 'B', '09000000002', '2'),
      (5555, 'Member', 'C', '09000000003', '3'),
      (6666, 'Member', 'D', '09000000004', '4')
    ON CONFLICT DO NOTHING`);
  // Agent identities: 4242 (coincides with the caller's customer id),
  // 6666 (expired-code customer) and 9999 (foreign). Customer 5555 has NO
  // coinciding agents row.
  await db.execute(sql`
    INSERT INTO agents (id, "agentId", name, phone, "pinHash")
    VALUES
      (4242, 'AGT4242', 'Agent A', '08000000001', 'hash-a'),
      (6666, 'AGT6666', 'Agent C', '08000000003', 'hash-c'),
      (9999, 'AGT9999', 'Agent B', '08000000002', 'hash-b')
    ON CONFLICT DO NOTHING`);

  // Caller 4242's referrals: one rewarded (myReferrals filter target) and
  // one still-valid pending code (myCode happy path).
  await db.execute(sql`
    INSERT INTO referrals
      (referrer_agent_id, referrer_code, referral_code, referee_code, status,
       bonus_points, bonus_cash, activated_at, rewarded_at, expires_at, created_at)
    VALUES
      (${CUSTOMER_ID}, 'AGT4242', 'REFA1B2C3', 'AGT900', 'rewarded',
       500, '1000.00', '2026-09-01', '2026-09-15', '2026-12-01',
       '2026-08-20'),
      (${CUSTOMER_ID}, 'AGT4242', 'REFEXIST1', NULL, 'pending',
       0, '0.00', NULL, NULL, ${VALID_CODE_EXPIRY}, '2026-09-25'),
      (6666, 'AGT6666', 'REFOLD99', NULL, 'pending',
       0, '0.00', NULL, NULL, '2026-01-01', '2025-12-01'),
      (${OTHER_CUSTOMER_ID}, 'AGT9999', 'REF9999X', NULL, 'pending',
       0, '0.00', NULL, NULL, '2027-06-01', '2026-09-01')`);
}

async function referralRowCount(): Promise<number> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM referrals`);
  return Number((r as any).rows?.[0]?.n ?? (r as any)[0]?.n);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberReferralsRouter } = await import("../memberReferrals");
  memberCaller = memberReferralsRouter.createCaller(makeAuthenticatedCtx());
  noAgentCaller = memberReferralsRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: 3 } as any })
  );
  expiredCaller = memberReferralsRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: 4 } as any })
  );
  anonCaller = memberReferralsRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("memberReferrals router (2026-10-01, R3)", () => {
  it("rejects anonymous callers with UNAUTHORIZED", async () => {
    await expect(anonCaller.myReferrals()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(anonCaller.myCode()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("returns NOT_FOUND when the session user has no customer profile", async () => {
    const caller = (
      await import("../memberReferrals")
    ).memberReferralsRouter.createCaller(
      makeAuthenticatedCtx({ user: { id: 777 } as any })
    );
    await expect(caller.myReferrals()).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Customer profile not found for session user",
    });
  });

  it("myReferrals returns only the caller's rows, paginated", async () => {
    const result = await memberCaller.myReferrals({
      status: "rewarded",
      limit: 10,
    });
    expect(result.total).toBe(1);
    expect(result.limit).toBe(10);
    expect(result.referrals).toHaveLength(1);
    const row = result.referrals[0];
    expect(row.referralCode).toBe("REFA1B2C3");
    expect(row.refereeCode).toBe("AGT900");
    expect(row.status).toBe("rewarded");
    expect(row.bonusPoints).toBe(500);
    expect(Number(row.bonusCash)).toBe(1000);
  });

  it("scope isolation: a foreign referrerAgentId in input cannot re-scope the query", async () => {
    // The foreign agent's referral (REF9999X) is seeded for real. A smuggled
    // referrerAgentId in the input cannot re-scope the query: only the
    // caller's own rows (keyed by the RESOLVED customer.id 4242) come back.
    const result = await memberCaller.myReferrals({ referrerAgentId: 9999 } as any);
    expect(result.total).toBe(2);
    expect(result.referrals).toHaveLength(2);
    const codes = result.referrals.map(r => r.referralCode).sort();
    expect(codes).toEqual(["REFA1B2C3", "REFEXIST1"]);
    expect(codes).not.toContain("REF9999X");
  });

  // 2026-10-01 (R3-fix): myCode is read-only. The referrals row count must
  // stay at the seeded count in EVERY case (the old fake's `inserted` spy
  // is replaced by real row-count assertions).
  it("myCode returns the caller's existing valid pending code when the caller has an agent identity", async () => {
    const result = await memberCaller.myCode();
    expect(result).toEqual({
      referralCode: "REFEXIST1",
      expiresAt: VALID_CODE_EXPIRY,
      existing: true,
    });
    expect(await referralRowCount()).toBe(SEEDED_REFERRAL_ROWS);
  });

  it("myCode returns null when the caller has no agent identity (no coinciding agents row)", async () => {
    await expect(noAgentCaller.myCode()).resolves.toBeNull();
    expect(await referralRowCount()).toBe(SEEDED_REFERRAL_ROWS);
  });

  it("myCode returns null when only expired/no longer valid codes exist", async () => {
    await expect(expiredCaller.myCode()).resolves.toBeNull();
    expect(await referralRowCount()).toBe(SEEDED_REFERRAL_ROWS);
  });
});
