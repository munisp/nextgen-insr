/**
 * memberLoyalty.test.ts — R3 batch 1 (2026-10-01, R3)
 *
 * Real-behavior PGlite tests for server/routers/memberLoyalty.ts:
 *   - anonymous caller → UNAUTHORIZED (protectedProcedure)
 *   - session user with no customer profile → NOT_FOUND (non-enumerating)
 *   - scope isolation: queries are keyed by the RESOLVED customer.id, never
 *     by caller input (a foreign customerId in input cannot change the scope)
 *   - happy paths for myBalance / myHistory
 *
 * 2026-10-01 (R3-fix-ci): harness rewrite. The previous in-memory fake
 * drizzle chain double resolved queued rows at EVERY chain step regardless
 * of what the router actually awaited, so the resolveSessionCustomer chain
 * (`d.select().from(customers).where(...).limit(1)` — memberLoyalty.ts
 * lines 57-61, reached from lines 78/129) mismatched and the suite failed.
 * The production router is verified correct (same chain shape passes in the
 * memberPolicies PGlite suite), so ONLY the harness was replaced: real
 * embedded PostgreSQL (PGlite wire protocol), minimal table projections
 * matching exactly the columns the router selects, real SQL execution.
 * Same scenarios, same expectations — foreign ledger rows are now seeded
 * for real and asserted to never leak into the caller's results (stronger
 * than the old queue-order inspection).
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

// 54395 (distinct from memberPolicies' 54397, memberClaims' 54396,
// auth-f3's 54399 and embedded-factory's 54398) so the suites can run
// concurrently.
const PG_PORT = 54395;
const PG_URL = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;
let pgliteChild: ChildProcess | null = null;

// Unit-test env: no Permify sidecar. Explicit insecure opt-in (same pattern
// as memberPolicies) so protectedProcedure passes the base gate; the member
// authz under test is enforced by the router itself.
process.env.PERMIFY_FAIL_OPEN = "true";

type Caller = ReturnType<
  (typeof import("../memberLoyalty"))["memberLoyaltyRouter"]["createCaller"]
>;
let memberCaller: Caller; // session user id 1 → customer 4242
let emptyCaller: Caller; // session user id 3 → customer 5555 (no ledger rows)
let anonCaller: Caller;

// Session user id 1 (testHelpers MOCK_USER.id) → customer 4242. The foreign
// customer 9999 (session user id 2) has its own ledger rows that must never
// leak. Customer 5555 (session user id 3) has a profile but NO ledger rows.
const CUSTOMER_ID = 4242;
const OTHER_CUSTOMER_ID = 9999;

async function startPglite(): Promise<void> {
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
  // enum type matching drizzle/schema.ts loyaltyTypeEnum.
  await db.execute(sql`
    CREATE TYPE loyalty_type AS ENUM
      ('earned', 'redeemed', 'bonus', 'penalty', 'challenge')`);
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
    CREATE TABLE IF NOT EXISTS loyalty_history (
      id serial PRIMARY KEY,
      "agentId" integer NOT NULL,
      type loyalty_type NOT NULL,
      points integer NOT NULL,
      description varchar(256),
      "balanceAfter" integer NOT NULL,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);

  await db.execute(sql`
    INSERT INTO customers (id, "firstName", "lastName", phone, "keycloakSub")
    VALUES
      (4242, 'Member', 'A', '09000000001', '1'),
      (9999, 'Member', 'B', '09000000002', '2'),
      (5555, 'Member', 'C', '09000000003', '3')
    ON CONFLICT DO NOTHING`);

  // Caller 4242's ledger: earned 1000 + earned 500 − redeemed 400 → 1100.
  // Redeemed rows store NEGATIVE points (customerLoyaltyProgram.redeemPoints
  // convention); the router takes ABS sums.
  await db.execute(sql`
    INSERT INTO loyalty_history
      ("agentId", type, points, description, "balanceAfter", "createdAt")
    VALUES
      (${CUSTOMER_ID}, 'earned', 1000, 'Policy purchase', 1000, '2026-09-28T00:00:00Z'),
      (${CUSTOMER_ID}, 'earned', 500, 'Renewal bonus', 1500, '2026-09-29T00:00:00Z'),
      (${CUSTOMER_ID}, 'redeemed', -400, 'Premium offset', 1100, '2026-09-30T00:00:00Z'),
      (${OTHER_CUSTOMER_ID}, 'earned', 10, 'Foreign ledger row', 10, '2026-09-30T01:00:00Z')`);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberLoyaltyRouter } = await import("../memberLoyalty");
  memberCaller = memberLoyaltyRouter.createCaller(makeAuthenticatedCtx());
  emptyCaller = memberLoyaltyRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: 3 } as any })
  );
  anonCaller = memberLoyaltyRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("memberLoyalty router (2026-10-01, R3)", () => {
  it("rejects anonymous callers with UNAUTHORIZED", async () => {
    await expect(anonCaller.myBalance()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(anonCaller.myHistory()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("returns NOT_FOUND when the session user has no customer profile", async () => {
    const caller = (
      await import("../memberLoyalty")
    ).memberLoyaltyRouter.createCaller(
      makeAuthenticatedCtx({ user: { id: 777 } as any })
    );
    await expect(caller.myBalance()).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Customer profile not found for session user",
    });
  });

  it("myBalance scopes to the resolved customer and computes earned − redeemed", async () => {
    const result = await memberCaller.myBalance();
    expect(result).toEqual({
      customerId: CUSTOMER_ID,
      earned: 1500,
      redeemed: 400,
      balance: 1100,
    });
  });

  it("myBalance treats an empty ledger as a real zero balance", async () => {
    // Customer 5555 exists (profile resolves) but has no ledger rows.
    const result = await emptyCaller.myBalance();
    expect(result.balance).toBe(0);
    expect(result.customerId).toBe(5555);
  });

  it("myHistory returns only the caller's ledger rows with pagination", async () => {
    const result = await memberCaller.myHistory({ limit: 10, offset: 0 });
    // Real scope isolation: the foreign customer's ledger row (agentId 9999)
    // is seeded in the same table and must never appear.
    expect(result.total).toBe(3);
    expect(result.history).toHaveLength(3);
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(0);
    // Newest first (ORDER BY "createdAt" DESC).
    expect(result.history.map(r => r.points)).toEqual([-400, 500, 1000]);
    expect(result.history[2].description).toBe("Policy purchase");
    expect(result.history[2].balanceAfter).toBe(1000);
    expect(result.history[2].type).toBe("earned");

    const page = await memberCaller.myHistory({ limit: 1, offset: 1 });
    expect(page.history).toHaveLength(1);
    expect(page.history[0].points).toBe(500);
    expect(page.total).toBe(3);
  });

  it("scope isolation: a foreign customerId in input cannot re-scope the query", async () => {
    // Even if a caller smuggles another customer's id into the input, the
    // proc only ever resolves the SESSION user's customer (4242, not 9999).
    // The foreign customer's ledger (10 earned points) is seeded for real;
    // the result must still be caller 4242's own totals.
    const result = await memberCaller.myBalance({
      customerId: OTHER_CUSTOMER_ID,
    } as any);
    expect(result.customerId).toBe(CUSTOMER_ID);
    expect(result.customerId).not.toBe(OTHER_CUSTOMER_ID);
    expect(result.earned).toBe(1500);
    expect(result.balance).toBe(1100);
  });
});
