/**
 * memberPolicies.test.ts — R3 batch 1 (2026-10-01, R3)
 *
 * Real-behavior PGlite tests for server/routers/memberPolicies.ts
 * (authz scoping) and memberGuards.assertPolicyOwnership. No mocks for the
 * behavior under test: real PostgreSQL (PGlite wire protocol), real router
 * createCaller invocations (embedded-factory.test.ts pattern).
 *
 * Covers: unauthenticated → UNAUTHORIZED; member sees ONLY own policies;
 * cross-member policy id → NOT_FOUND (non-enumerating); quote on
 * real/missing product; guard deny/allow.
 *
 * 2026-10-01 (R3-fix): policies.customerId is written in two identity
 * spaces — users.id by the portal journey (insuranceWorkflows ~337/669)
 * and customers.id by wallet-era rows. myPolicies/myPolicy scope BOTH
 * (caller-bound OR); a session user with NO customer profile still sees
 * their users.id-space policies instead of NOT_FOUND.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// 54397 (distinct from auth-f3's 54399 and embedded-factory's 54398) so the
// suites can run concurrently.
const PG_PORT = 54397;
const PG_URL = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;
let pgliteChild: ChildProcess | null = null;

// Unit-test env: no Permify sidecar. Explicit insecure opt-in (same pattern
// as auth-f3 / embedded-factory) so protectedProcedure passes the base gate;
// the member authz under test is enforced by the router itself.
process.env.PERMIFY_FAIL_OPEN = "true";

type Caller = ReturnType<
  (typeof import("../memberPolicies"))["memberPoliciesRouter"]["createCaller"]
>;
let memberCaller: Caller;
let otherCaller: Caller;
let dualCaller: Caller; // user 9200 → customer 5500 (distinct id spaces)
let strangerCaller: Caller; // authenticated, but no customers row
let anonCaller: Caller;

// Caller A (user id 9102) → customer 9102; caller B (user id 9103) → 9103.
const memberCtx = {
  user: { id: 9102, username: "cust-a", role: "user", name: "A", email: "a@t.io" },
} as any;
const otherCtx = {
  user: { id: 9103, username: "cust-b", role: "user", name: "B", email: "b@t.io" },
} as any;
// 2026-10-01 (R3-fix): caller C's customers.id (5500) deliberately differs
// from their users.id (9200) so the dual-space scope is exercised for real.
const dualCtx = {
  user: { id: 9200, username: "cust-c", role: "user", name: "C", email: "c@t.io" },
} as any;
const strangerCtx = {
  user: { id: 9199, username: "ghost", role: "user", name: "G", email: "g@t.io" },
} as any;
const anonCtx = { user: null } as any;

let policyA1 = 0;
let policyA2 = 0;
let policyB1 = 0;
let policyCCust = 0; // customerId = 5500 (customers.id space)
let policyCUser = 0; // customerId = 9200 (users.id space)
let policyG1 = 0;    // customerId = 9199 — stranger's portal-filed policy
let productId = 0;

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

  // Minimal tables carrying exactly the columns the router projects.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      "keycloakSub" varchar(128) UNIQUE
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS insurance_products (
      id serial PRIMARY KEY,
      "productCode" varchar(32) NOT NULL UNIQUE,
      name varchar(256) NOT NULL,
      description text,
      "coverageType" varchar(64) NOT NULL,
      "isActive" boolean NOT NULL DEFAULT true,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS policies (
      id serial PRIMARY KEY,
      "policyNumber" varchar(64) NOT NULL UNIQUE,
      "productId" integer NOT NULL,
      "customerId" integer NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'draft',
      "coverageType" varchar(64) NOT NULL,
      "sumInsured" numeric(18,2) NOT NULL,
      "annualPremium" numeric(18,2) NOT NULL,
      "startDate" timestamp,
      "endDate" timestamp,
      "renewalDate" timestamp,
      "certificateNumber" varchar(64),
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);

  const firstRow = (r: unknown) =>
    (r as any).rows?.[0] ?? (r as any)[0];
  const prod = await db.execute(sql`
    INSERT INTO insurance_products ("productCode", name, description, "coverageType")
    VALUES ('MP-TEST-1', 'Test Motor Cover', 'Comprehensive motor', 'motor')
    RETURNING id`);
  productId = Number(firstRow(prod).id);

  await db.execute(sql`
    INSERT INTO customers (id, "keycloakSub")
    VALUES (9102, '9102'), (9103, '9103'), (5500, '9200')
    ON CONFLICT DO NOTHING`);

  const mkPolicy = (num: string, customerId: number, status: string) => sql`
    INSERT INTO policies
      ("policyNumber", "productId", "customerId", status, "coverageType",
       "sumInsured", "annualPremium", "startDate", "renewalDate")
    VALUES
      (${num}, ${productId}, ${customerId}, ${status}, 'motor',
       '5000000.00', '100000.00', now(), now() + interval '1 year')
    RETURNING id`;
  policyA1 = Number(firstRow(await db.execute(mkPolicy("POL-A-1", 9102, "active"))).id);
  policyA2 = Number(firstRow(await db.execute(mkPolicy("POL-A-2", 9102, "lapsed"))).id);
  policyB1 = Number(firstRow(await db.execute(mkPolicy("POL-B-1", 9103, "active"))).id);
  // 2026-10-01 (R3-fix): caller C has one policy in EACH writer space.
  policyCCust = Number(firstRow(await db.execute(mkPolicy("POL-C-CUST", 5500, "active"))).id);
  policyCUser = Number(firstRow(await db.execute(mkPolicy("POL-C-USER", 9200, "active"))).id);
  // Stranger (no customers row) has a portal-filed policy in users.id space.
  policyG1 = Number(firstRow(await db.execute(mkPolicy("POL-G-1", 9199, "active"))).id);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberPoliciesRouter } = await import("../memberPolicies");
  memberCaller = memberPoliciesRouter.createCaller(memberCtx);
  otherCaller = memberPoliciesRouter.createCaller(otherCtx);
  dualCaller = memberPoliciesRouter.createCaller(dualCtx);
  strangerCaller = memberPoliciesRouter.createCaller(strangerCtx);
  anonCaller = memberPoliciesRouter.createCaller(anonCtx);
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("memberPolicies authz", () => {
  it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
    await expect(anonCaller.myPolicies()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(anonCaller.myPolicy({ id: policyA1 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      anonCaller.quote({ productId, sumInsured: 1_000_000 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("a member sees ONLY their own policies", async () => {
    const mine = await memberCaller.myPolicies();
    expect(mine).not.toBeNull();
    const ids = mine!.policies.map(p => p.id).sort();
    expect(ids).toEqual([policyA1, policyA2].sort());
    expect(mine!.count).toBe(2);
    expect(mine!.policies.every(p => p.currency === "NGN")).toBe(true);

    const others = await otherCaller.myPolicies();
    expect(others!.policies.map(p => p.id)).toEqual([policyB1]);
    expect(others!.count).toBe(1);
  });

  it("status filter stays inside the caller's scope", async () => {
    const active = await memberCaller.myPolicies({ status: "active" });
    expect(active!.policies.map(p => p.id)).toEqual([policyA1]);
  });

  it("cross-member policy id → NOT_FOUND (non-enumerating)", async () => {
    // B's policy requested by A: same error as a nonexistent id.
    await expect(memberCaller.myPolicy({ id: policyB1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      memberCaller.myPolicy({ id: 999_999_999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("own policy id returns the detail", async () => {
    const row = await memberCaller.myPolicy({ id: policyA1 });
    expect(row!.policyNumber).toBe("POL-A-1");
    expect(row!.productName).toBe("Test Motor Cover");
  });

  // 2026-10-01 (R3-fix): dual-space scope — a policy written in EITHER the
  // customers.id space or the users.id space belongs to the same caller.
  it("dual-space scope: caller sees policies in both customers.id and users.id spaces", async () => {
    const mine = await dualCaller.myPolicies();
    expect(mine).not.toBeNull();
    const ids = mine!.policies.map(p => p.id).sort();
    expect(ids).toEqual([policyCCust, policyCUser].sort());
    expect(mine!.count).toBe(2);

    // Foreign rows remain invisible from either direction.
    const a = await memberCaller.myPolicies();
    expect(a!.policies.map(p => p.id)).not.toContain(policyCCust);
    expect(a!.policies.map(p => p.id)).not.toContain(policyCUser);
    await expect(dualCaller.myPolicy({ id: policyA1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("myPolicy ownership works in the users.id space too", async () => {
    const row = await dualCaller.myPolicy({ id: policyCUser });
    expect(row!.policyNumber).toBe("POL-C-USER");
    const row2 = await dualCaller.myPolicy({ id: policyCCust });
    expect(row2!.policyNumber).toBe("POL-C-CUST");
  });

  // 2026-10-01 (R3-fix): no customer profile no longer blocks the
  // users.id-space match (myClaims already works without one).
  it("authenticated user without a customer profile still sees their users.id-space policies", async () => {
    const mine = await strangerCaller.myPolicies();
    expect(mine).not.toBeNull();
    expect(mine!.policies.map(p => p.id)).toEqual([policyG1]);
    expect(mine!.count).toBe(1);

    const row = await strangerCaller.myPolicy({ id: policyG1 });
    expect(row!.policyNumber).toBe("POL-G-1");
    // Still non-enumerating for foreign/nonexistent ids.
    await expect(strangerCaller.myPolicy({ id: policyA1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("memberPolicies.quote", () => {
  it("quotes a real product with catalog math and no telematics factor", async () => {
    const q = await memberCaller.quote({
      productId,
      sumInsured: 1_000_000,
      durationMonths: 12,
    });
    expect(q!.productName).toBe("Test Motor Cover");
    expect(q!.premiumNGN).toBeCloseTo(20_000, 2); // 2% of sum insured
    expect(q!.stampDuty).toBeCloseTo(100, 2); // 0.5%
    expect(q!.totalPayable).toBeCloseTo(20_100, 2);
    // Anonymous quotes never receive the UBI factor (guard required).
    expect(q!.telematicsRatingFactor).toBe(1.0);
    expect(q!.telematicsScore).toBeNull();
  });

  it("unknown product → NOT_FOUND", async () => {
    await expect(
      memberCaller.quote({ productId: 999_999_999, sumInsured: 1_000_000 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("memberGuards.assertPolicyOwnership", () => {
  it("passes for the owner, NOT_FOUND for foreign/missing ids", async () => {
    const { getDb } = await import("../../db");
    const { assertPolicyOwnership } = await import("../../lib/memberGuards");
    const db = (await getDb())!;

    await expect(
      assertPolicyOwnership(db, policyA1, 9102)
    ).resolves.toBeUndefined();
    await expect(
      assertPolicyOwnership(db, policyB1, 9102)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      assertPolicyOwnership(db, 999_999_999, 9102)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
