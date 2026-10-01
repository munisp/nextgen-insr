/**
 * quotePricingA1b.test.ts — Actuarial Wave stage A1b (2026-10-01, A1b)
 *
 * Real-behavior PGlite tests for the THREE monolith quote paths rewired from
 * hardcoded premium constants to the fail-closed filed-rate engine
 * (server/lib/ratingEngine.ts, stage A1):
 *   - insuranceProductCatalog.calculatePremium (was: baseRate 0.02 + age
 *     bumps +0.15/+0.3/+0.5)
 *   - memberPolicies.quote (was: duplicated 2% math, telematics pinned 1.00)
 *   - insurancePolicyQuoteManager.addToCart (was: minPremium/maxCoverage
 *     derivation with a 0.02 fallback)
 *
 * Harness copied from memberIdentity.test.ts — real embedded PostgreSQL
 * (PGlite wire protocol), ephemeral probeFreePort, faithful minimal table
 * projections matching exactly the columns each router/engine touches.
 * PERMIFY_FAIL_OPEN=true (unit-test env, no Permify sidecar); the member
 * authz under test is the router's own scoping.
 *
 * Asserts:
 *   - exact engine premium math through each of the three rewired paths
 *   - policy-linked telematics flows through the engine's telematics_cap
 *     clamp on the catalog path; member quote/cart paths pass NO telematics
 *   - claimsCount comes from the caller's REAL claims rows (never input)
 *   - FAIL-CLOSED: no active rating table → PRECONDITION_FAILED on all
 *     three paths (no fabricated premium, no cart row written)
 *   - existing guards intact: calculatePremium's assertPolicyOwnership IDOR
 *     (foreign policyId → NOT_FOUND), quote/addToCart catalog NOT_FOUNDs
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

process.env.PERMIFY_FAIL_OPEN = "true";

type CatalogCaller = ReturnType<
  (typeof import("../insuranceProductCatalog"))["insuranceProductCatalogRouter"]["createCaller"]
>;
type MemberCaller = ReturnType<
  (typeof import("../memberPolicies"))["memberPoliciesRouter"]["createCaller"]
>;
type CartCaller = ReturnType<
  (typeof import("../insurancePolicyQuoteManager"))["insurancePolicyQuoteCartRouter"]["createCaller"]
>;

let catalog: CatalogCaller; // user id 1 — owns policy 100, has 2 claims
let member: MemberCaller;
let cart: CartCaller;
let foreignCatalog: CatalogCaller; // user id 2 — owns policy 101, no claims
let anonCatalog: CatalogCaller;
let anonMember: MemberCaller;
let anonCart: CartCaller;

const MOTOR_PRODUCT = 11; // productCode MOTOR-A1B — filed active table 1
const LIFE_PRODUCT = 12; // productCode LIFE-A1B — resolves via class table 2
const NORATE_PRODUCT = 13; // productCode NORATE-A1B — no filed rate
const OWN_POLICY = 100; // customerId = 1 (caller user 1)
const FOREIGN_POLICY = 101; // customerId = 2

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

async function db() {
  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) throw new Error("PGlite DB not reachable");
  return d;
}

async function createTablesAndSeed() {
  const { sql } = await import("drizzle-orm");
  const d = await db();

  await d.execute(sql`
    CREATE TYPE coverage_type AS ENUM
      ('life', 'health', 'motor', 'property', 'liability', 'marine',
       'aviation', 'agriculture', 'credit', 'travel', 'micro', 'group_life',
       'annuity', 'pension')`);

  // FULL insurance_products projection (schema.ts:4878) — calculatePremium /
  // addToCart select() the whole row.
  await d.execute(sql`
    CREATE TABLE IF NOT EXISTS insurance_products (
      id serial PRIMARY KEY,
      "productCode" varchar(32) NOT NULL UNIQUE,
      name varchar(256) NOT NULL,
      description text,
      "coverageType" coverage_type NOT NULL,
      "minPremium" numeric(18,2),
      "maxCoverageAmount" numeric(18,2),
      "minAge" integer,
      "maxAge" integer,
      "waitingPeriodDays" integer DEFAULT 0,
      "policyTermMonths" integer DEFAULT 12,
      "isActive" boolean NOT NULL DEFAULT true,
      "regulatoryApprovalRef" varchar(128),
      "naicomProductCode" varchar(64),
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Minimal policies projection (assertPolicyOwnership touches id/customerId).
  await d.execute(sql`
    CREATE TABLE IF NOT EXISTS policies (
      id serial PRIMARY KEY,
      "policyNumber" varchar(64) NOT NULL UNIQUE,
      "productId" integer NOT NULL,
      "customerId" integer NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'draft',
      "coverageType" coverage_type NOT NULL,
      "sumInsured" numeric(18,2) NOT NULL,
      "annualPremium" numeric(18,2) NOT NULL,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);

  // telematics_scores (schema.innovations.ts:498 — snake_case columns).
  await d.execute(sql`
    CREATE TABLE IF NOT EXISTS telematics_scores (
      id serial PRIMARY KEY,
      policy_id integer NOT NULL UNIQUE,
      customer_id integer NOT NULL,
      score numeric(5,2) NOT NULL,
      rating_factor numeric(4,2) NOT NULL DEFAULT 1.00,
      trips_counted integer NOT NULL DEFAULT 0,
      window_days integer NOT NULL DEFAULT 30,
      computed_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);

  // Minimal claims projection — the routers COUNT by claimantId only.
  await d.execute(sql`
    CREATE TABLE IF NOT EXISTS claims (
      id serial PRIMARY KEY,
      "claimantId" integer NOT NULL
    )`);

  // Faithful rating tables (A1; ratingEngine.test.ts projection).
  await d.execute(sql`
    CREATE TABLE IF NOT EXISTS rating_tables (
      id serial PRIMARY KEY,
      "productCode" text,
      "coverageClass" text,
      "effectiveFrom" timestamp NOT NULL,
      "effectiveTo" timestamp,
      status varchar(16) NOT NULL DEFAULT 'draft',
      version integer NOT NULL,
      "filedBy" integer,
      "approvedBy" integer,
      "naicomFilingRef" text,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
  await d.execute(sql`
    CREATE TABLE IF NOT EXISTS rating_factors (
      id serial PRIMARY KEY,
      "tableId" integer NOT NULL,
      "factorType" varchar(32) NOT NULL,
      "factorKey" text NOT NULL,
      value numeric(18,6) NOT NULL,
      "minClamp" numeric(18,6),
      "maxClamp" numeric(18,6),
      "sortOrder" integer NOT NULL,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Full policy_quotes projection (schema.additions.ts:470 — addToCart
  // inserts with .returning()).
  await d.execute(sql`
    CREATE TABLE IF NOT EXISTS policy_quotes (
      id serial PRIMARY KEY,
      "customerId" integer,
      "agentId" integer,
      "productId" integer,
      "productName" text,
      "productType" varchar(64),
      "sumInsured" numeric(18,2),
      "premiumAmount" numeric(18,2),
      "stampDuty" numeric(18,2),
      "totalPayable" numeric(18,2),
      "durationMonths" integer,
      "coverageType" varchar(64),
      status varchar(32) NOT NULL DEFAULT 'pending',
      "validUntil" timestamp,
      metadata jsonb,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  await d.execute(sql`
    INSERT INTO insurance_products (id, "productCode", name, "coverageType")
    VALUES
      (${MOTOR_PRODUCT}, 'MOTOR-A1B', 'A1b Motor Comprehensive', 'motor'),
      (${LIFE_PRODUCT}, 'LIFE-A1B', 'A1b Term Life', 'life'),
      (${NORATE_PRODUCT}, 'NORATE-A1B', 'A1b Unrated Product', 'motor')`);

  await d.execute(sql`
    INSERT INTO policies
      (id, "policyNumber", "productId", "customerId", status, "coverageType",
       "sumInsured", "annualPremium")
    VALUES
      (${OWN_POLICY}, 'POL-A1B-OWN', ${MOTOR_PRODUCT}, 1, 'active', 'motor',
       1000000, 38250),
      (${FOREIGN_POLICY}, 'POL-A1B-FGN', ${MOTOR_PRODUCT}, 2, 'active', 'motor',
       1000000, 38250)`);

  // Caller user 1's REAL claims history (2 claims → claims_loading '1+').
  await d.execute(sql`
    INSERT INTO claims ("claimantId") VALUES (1), (1)`);

  // Policy-linked telematics for OWN_POLICY: rating factor 0.85 (inside the
  // router's 0.70–1.30 acceptance band; engine cap [0.7, 1.0] keeps 0.85).
  await d.execute(sql`
    INSERT INTO telematics_scores (policy_id, customer_id, score, rating_factor)
    VALUES (${OWN_POLICY}, 1, 82.50, 0.85)`);

  // Table 1 (MOTOR-A1B): base 3%, age 40-49 ×1.2, claims 1+ ×1.25,
  // telematics cap [0.7, 1.0], min premium 5000.
  // Table 2 (class 'life'): base 1.5% — coverageClass fallback target.
  await d.execute(sql`
    INSERT INTO rating_tables
      (id, "productCode", "coverageClass", "effectiveFrom", status, version)
    VALUES
      (1, 'MOTOR-A1B', NULL, '2026-01-01', 'active', 1),
      (2, NULL, 'life', '2026-01-01', 'active', 1)`);
  await d.execute(sql`
    INSERT INTO rating_factors
      ("tableId", "factorType", "factorKey", value, "minClamp", "maxClamp", "sortOrder")
    VALUES
      (1, 'base', 'rate', 0.03, NULL, NULL, 0),
      (1, 'age_band', '40-49', 1.2, NULL, NULL, 10),
      (1, 'claims_loading', '1+', 1.25, NULL, NULL, 20),
      (1, 'telematics_cap', 'cap', 1.0, 0.7, 1.0, 50),
      (1, 'base', 'min_premium', 5000, NULL, NULL, 99),
      (2, 'base', 'rate', 0.015, NULL, NULL, 0)`);
}

async function pendingQuoteCount(): Promise<number> {
  const { sql } = await import("drizzle-orm");
  const d = await db();
  const r = await d.execute(
    sql`SELECT COUNT(*)::int AS n FROM policy_quotes WHERE status = 'pending'`
  );
  const row = (r as unknown as { rows?: { n: number }[] }).rows?.[0] ??
    (r as unknown as { n: number }[])[0];
  return Number(row.n);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { insuranceProductCatalogRouter } = await import(
    "../insuranceProductCatalog"
  );
  const { memberPoliciesRouter } = await import("../memberPolicies");
  const { insurancePolicyQuoteCartRouter } = await import(
    "../insurancePolicyQuoteManager"
  );
  catalog = insuranceProductCatalogRouter.createCaller(makeAuthenticatedCtx());
  member = memberPoliciesRouter.createCaller(makeAuthenticatedCtx());
  cart = insurancePolicyQuoteCartRouter.createCaller(makeAuthenticatedCtx());
  foreignCatalog = insuranceProductCatalogRouter.createCaller(
    makeAuthenticatedCtx({
      user: { id: 2, username: "cust-b", role: "user", name: "B", email: "b@t.io" } as never,
    })
  );
  anonCatalog = insuranceProductCatalogRouter.createCaller(makeUnauthenticatedCtx());
  anonMember = memberPoliciesRouter.createCaller(makeUnauthenticatedCtx());
  anonCart = insurancePolicyQuoteCartRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("A1b rewired quote paths (2026-10-01, A1b)", () => {
  it("rejects anonymous callers with UNAUTHORIZED on all three paths", async () => {
    await expect(
      anonCatalog.calculatePremium({ productId: MOTOR_PRODUCT, sumInsured: 1000 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonMember.quote({ productId: MOTOR_PRODUCT, sumInsured: 1000 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonCart.addToCart({ productId: MOTOR_PRODUCT, sumInsured: 1000 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("calculatePremium: engine math with age band, real claims count and clamped telematics", async () => {
    const r = await catalog.calculatePremium({
      productId: MOTOR_PRODUCT,
      sumInsured: 1_000_000,
      durationMonths: 12,
      age: 45,
      policyId: OWN_POLICY,
    });
    // 1,000,000 × 0.03 = 30,000 → ×1.2 (age 40-49) = 36,000
    // → ×1.25 (caller's REAL 2 claims match '1+') = 45,000
    // → ×0.85 telematics (cap [0.7,1.0] keeps 0.85) = 38,250
    // stamp 0.5% = 191.25; total 38,441.25.
    expect(r.baseRate).toBeCloseTo(0.03, 6);
    expect(r.loadingFactor).toBeCloseTo(1.2 * 1.25, 6);
    expect(r.telematicsRatingFactor).toBeCloseTo(0.85, 6);
    expect(r.telematicsScore).toBeCloseTo(82.5, 2);
    expect(r.annualPremium).toBeCloseTo(38_250, 2);
    expect(r.premiumNGN).toBeCloseTo(38_250, 2);
    expect(r.stampDuty).toBeCloseTo(191.25, 2);
    expect(r.totalPayable).toBeCloseTo(38_441.25, 2);
  });

  it("calculatePremium without policyId passes NO telematics factor", async () => {
    const r = await catalog.calculatePremium({
      productId: MOTOR_PRODUCT,
      sumInsured: 1_000_000,
      durationMonths: 12,
      age: 45,
    });
    // Same as above but no telematics: 45,000; stamp 225; total 45,225.
    expect(r.telematicsRatingFactor).toBe(1.0);
    expect(r.telematicsScore).toBeNull();
    expect(r.annualPremium).toBeCloseTo(45_000, 2);
    expect(r.totalPayable).toBeCloseTo(45_225, 2);
  });

  it("calculatePremium keeps the assertPolicyOwnership IDOR guard (foreign policyId → NOT_FOUND)", async () => {
    await expect(
      catalog.calculatePremium({
        productId: MOTOR_PRODUCT,
        sumInsured: 1_000_000,
        policyId: FOREIGN_POLICY,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The foreign caller owns that policy and gets a real quote instead.
    const r = await foreignCatalog.calculatePremium({
      productId: MOTOR_PRODUCT,
      sumInsured: 1_000_000,
      policyId: FOREIGN_POLICY,
    });
    // Foreign caller has NO claims rows → no claims loading:
    // 30,000 (no age given; telematics row exists only for OWN_POLICY).
    expect(r.premiumNGN).toBeCloseTo(30_000, 2);
  });

  it("memberPolicies.quote: coverageClass fallback table, duration pro-rating, no telematics", async () => {
    const q = await member.quote({
      productId: LIFE_PRODUCT,
      sumInsured: 2_000_000,
      durationMonths: 6,
      age: 30,
    });
    // LIFE-A1B has no product table; class 'life' table resolves: base 1.5%.
    // Annual = 2,000,000 × 0.015 = 30,000 (life table defines no age/claims
    // rows, so the caller's 2 claims apply no loading) → 6-month pro-rate
    // 15,000; stamp 75; total 15,075.
    expect(q.baseRate).toBeCloseTo(0.015, 6);
    expect(q.premiumNGN).toBeCloseTo(15_000, 2);
    expect(q.stampDuty).toBeCloseTo(75, 2);
    expect(q.totalPayable).toBeCloseTo(15_075, 2);
    expect(q.telematicsRatingFactor).toBe(1.0);
    expect(q.telematicsScore).toBeNull();
  });

  it("addToCart: engine premium persisted on the real quote row", async () => {
    const before = await pendingQuoteCount();
    const r = await cart.addToCart({
      productId: MOTOR_PRODUCT,
      sumInsured: 1_000_000,
      durationMonths: 12,
    });
    // Caller has 2 real claims: 30,000 × 1.25 = 37,500; stamp 187.5;
    // total 37,687.5. No age input exists on this proc (documented).
    expect(r.premiumAmount).toBeCloseTo(37_500, 2);
    expect(r.stampDuty).toBeCloseTo(187.5, 2);
    expect(r.totalPayable).toBeCloseTo(37_687.5, 2);
    expect(r.quote.productName).toBe("A1b Motor Comprehensive");
    expect(Number(r.quote.premiumAmount)).toBeCloseTo(37_500, 2);
    expect(Number(r.quote.totalPayable)).toBeCloseTo(37_687.5, 2);
    expect(await pendingQuoteCount()).toBe(before + 1);
  });

  it("FAIL-CLOSED: no active rating table → PRECONDITION_FAILED on all three paths", async () => {
    await expect(
      catalog.calculatePremium({ productId: NORATE_PRODUCT, sumInsured: 1_000_000 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      member.quote({ productId: NORATE_PRODUCT, sumInsured: 1_000_000 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const before = await pendingQuoteCount();
    await expect(
      cart.addToCart({ productId: NORATE_PRODUCT, sumInsured: 1_000_000 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    // No fabricated quote row was written.
    expect(await pendingQuoteCount()).toBe(before);
  });

  it("existing catalog guards intact: unknown product → NOT_FOUND on all three paths", async () => {
    await expect(
      catalog.calculatePremium({ productId: 999_999, sumInsured: 1000 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      member.quote({ productId: 999_999, sumInsured: 1000 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      cart.addToCart({ productId: 999_999, sumInsured: 1000 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
