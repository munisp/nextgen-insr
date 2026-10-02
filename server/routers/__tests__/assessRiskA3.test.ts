/**
 * assessRiskA3.test.ts — 2026-10-02 (A3): underwriting risk score is
 * SERVER-COMPUTED, never caller-supplied.
 *
 * Real-behavior PGlite tests for insuranceWorkflows.assessRisk (harness
 * pattern copied from memberQuotes.test.ts — real embedded PostgreSQL,
 * ephemeral probeFreePort, faithful minimal table projections):
 *
 *   - the input schema carries NO riskScore/riskCategory fields; a smuggled
 *     `riskScore: 1` is IGNORED and the persisted score is the server-
 *     computed one (contract change: pre-A3 the caller's score was trusted)
 *   - two policyholders with different real claims histories get DIFFERENT
 *     server-computed scores (0-claims customer vs 3-claims customer)
 *   - the score/band/factors are persisted on underwriting_assessments and
 *     returned to the caller
 *   - anonymous → UNAUTHORIZED; non-staff without an ACTIVE underwriter
 *     stakeholder profile → FORBIDDEN (fail-closed, unchanged pre-A3
 *     contract)
 *
 * Scoring expectations (server/lib/riskScoring.ts):
 *   claims 0 → +0, 3 → +40; age <25 → +15, >60 → +10; high-hazard coverage
 *   (aviation) → +10; sumInsured > 10,000,000 → +20.
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
let pgliteChild: ChildProcess | null = null;

process.env.PERMIFY_FAIL_OPEN = "true";

type Caller = ReturnType<
  (typeof import("../insuranceWorkflows"))["insuranceWorkflowsRouter"]["createCaller"]
>;
let staffCaller: Caller; // admin (id 1)
let memberCaller: Caller; // non-staff user id 2, no underwriter profile
let anonCaller: Caller;

const LOW_RISK_CUSTOMER = 4242; // 0 claims, age ~36, life cover, ₦500k
const HIGH_RISK_CUSTOMER = 5555; // 3 claims, age ~68, aviation, ₦20m
const LOW_POLICY = 9001;
const HIGH_POLICY = 9002;

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

  await db.execute(sql`
    CREATE TYPE customer_status AS ENUM
      ('pending_kyc', 'active', 'suspended', 'blacklisted')`);
  await db.execute(sql`
    CREATE TYPE coverage_type AS ENUM
      ('life', 'health', 'motor', 'property', 'liability', 'marine',
       'aviation', 'agriculture', 'credit', 'travel', 'micro', 'group_life',
       'annuity', 'pension')`);
  await db.execute(sql`
    CREATE TYPE policy_status AS ENUM
      ('draft', 'quoted', 'bound', 'active', 'endorsed', 'renewed',
       'cancelled', 'lapsed', 'expired', 'suspended')`);
  await db.execute(sql`
    CREATE TYPE claim_status AS ENUM
      ('submitted', 'under_review', 'investigation', 'approved',
       'partially_approved', 'rejected', 'paid', 'closed', 'appealed',
       'escalated', 'pending_adjudication')`);
  await db.execute(sql`
    CREATE TYPE underwriting_decision AS ENUM
      ('pending', 'approved', 'approved_with_conditions', 'referred',
       'declined', 'counter_offered')`);
  await db.execute(sql`
    CREATE TYPE insurance_stakeholder_role AS ENUM
      ('policyholder', 'beneficiary', 'broker', 'underwriter',
       'claims_adjuster', 'actuary', 'compliance_officer', 'regulator',
       'reinsurer', 'agent', 'supervisor', 'admin')`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      "firstName" varchar(64) NOT NULL,
      "lastName" varchar(64) NOT NULL,
      phone varchar(20) NOT NULL,
      "dateOfBirth" text,
      status customer_status NOT NULL DEFAULT 'pending_kyc',
      "keycloakSub" varchar(128) UNIQUE,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS policies (
      id serial PRIMARY KEY,
      "policyNumber" varchar(64) NOT NULL UNIQUE,
      "productId" integer NOT NULL,
      "customerId" integer NOT NULL,
      "agentId" integer,
      "brokerId" integer,
      "underwriterId" integer,
      status policy_status NOT NULL DEFAULT 'draft',
      "coverageType" coverage_type NOT NULL,
      "sumInsured" numeric(18,2) NOT NULL,
      "annualPremium" numeric(18,2) NOT NULL,
      "startDate" timestamp,
      "endDate" timestamp,
      "renewalDate" timestamp,
      "cancellationDate" timestamp,
      "cancellationReason" text,
      "policyDocument" text,
      "certificateNumber" varchar(64),
      "naicomRef" varchar(128),
      "termsAndConditions" json,
      metadata json,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS claims (
      id serial PRIMARY KEY,
      "claimNumber" varchar(64) NOT NULL UNIQUE,
      "policyId" integer NOT NULL,
      "claimantId" integer NOT NULL,
      status claim_status NOT NULL DEFAULT 'submitted',
      "claimType" varchar(64) NOT NULL,
      "incidentDate" timestamp NOT NULL,
      "reportedDate" timestamp NOT NULL DEFAULT now(),
      "claimedAmount" numeric(18,2) NOT NULL,
      "incidentDescription" text NOT NULL,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Faithful underwriting_assessments projection (drizzle/schema.ts:5075).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS underwriting_assessments (
      id serial PRIMARY KEY,
      "policyId" integer NOT NULL,
      "underwriterId" integer,
      decision underwriting_decision NOT NULL DEFAULT 'pending',
      "riskScore" numeric(5,2),
      "riskCategory" varchar(32),
      "premiumLoading" numeric(5,4),
      exclusions json,
      conditions json,
      notes text,
      "decisionDate" timestamp,
      "expiryDate" timestamp,
      "referralReason" text,
      "counterOfferDetails" json,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS stakeholder_profiles (
      id serial PRIMARY KEY,
      "userId" integer NOT NULL UNIQUE,
      role insurance_stakeholder_role NOT NULL,
      "licenseNumber" varchar(128),
      "licenseExpiry" timestamp,
      specializations json,
      "maxClaimAuthority" numeric(18,2),
      "isActive" boolean DEFAULT true,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Non-blocking audit/event sinks (router inserts are try/caught, but keep
  // the projections faithful so the writes really land).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id bigserial PRIMARY KEY,
      "agentId" integer,
      action varchar(128) NOT NULL,
      resource varchar(64),
      "resourceId" varchar(64),
      metadata json,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS fluvio_event_log (
      id serial PRIMARY KEY,
      topic varchar(128) NOT NULL,
      payload json,
      "processedAt" timestamp NOT NULL DEFAULT now(),
      status varchar(32) NOT NULL DEFAULT 'processed',
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Customers: LOW = DOB 1990-06-15 (age ~36 → +0); HIGH = DOB 1958-01-01
  // (age >60 → +10).
  await db.execute(sql`
    INSERT INTO customers (id, "firstName", "lastName", phone, "dateOfBirth", status, "keycloakSub")
    VALUES
      (${LOW_RISK_CUSTOMER}, 'Low', 'Risk', '09000000001', '1990-06-15', 'active', '4242'),
      (${HIGH_RISK_CUSTOMER}, 'High', 'Risk', '09000000002', '1958-01-01', 'active', '5555')
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO policies
      (id, "policyNumber", "productId", "customerId", status, "coverageType",
       "sumInsured", "annualPremium")
    VALUES
      (${LOW_POLICY}, 'POL-A3-LOW', 11, ${LOW_RISK_CUSTOMER}, 'draft', 'life',
       500000, 10000),
      (${HIGH_POLICY}, 'POL-A3-HIGH', 11, ${HIGH_RISK_CUSTOMER}, 'draft',
       'aviation', 20000000, 400000)`);

  // HIGH-risk customer: 3 historical claims (+40). LOW-risk customer: none.
  await db.execute(sql`
    INSERT INTO claims
      ("claimNumber", "policyId", "claimantId", "claimType", "incidentDate",
       "claimedAmount", "incidentDescription")
    VALUES
      ('CLM-A3-1', ${HIGH_POLICY}, ${HIGH_RISK_CUSTOMER}, 'hull', '2023-01-10', 100000, 'prior loss 1'),
      ('CLM-A3-2', ${HIGH_POLICY}, ${HIGH_RISK_CUSTOMER}, 'hull', '2024-03-11', 200000, 'prior loss 2'),
      ('CLM-A3-3', ${HIGH_POLICY}, ${HIGH_RISK_CUSTOMER}, 'liability', '2025-05-12', 50000, 'prior loss 3')`);
}

async function persistedAssessment(policyId: number) {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  const r = await db.execute(sql`
    SELECT "riskScore", "riskCategory", decision
    FROM underwriting_assessments WHERE "policyId" = ${policyId}
    ORDER BY id DESC LIMIT 1`);
  return (r as any).rows?.[0] ?? (r as any)[0];
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { insuranceWorkflowsRouter } = await import("../insuranceWorkflows");
  staffCaller = insuranceWorkflowsRouter.createCaller(makeAuthenticatedCtx());
  memberCaller = insuranceWorkflowsRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: 2, role: "user" } as any })
  );
  anonCaller = insuranceWorkflowsRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("insuranceWorkflows.assessRisk — server-computed risk score (2026-10-02, A3)", () => {
  it("rejects anonymous callers with UNAUTHORIZED", async () => {
    await expect(
      anonCaller.assessRisk({ policyId: LOW_POLICY, decision: "approved" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects non-staff callers without an active underwriter profile (FORBIDDEN)", async () => {
    await expect(
      memberCaller.assessRisk({ policyId: LOW_POLICY, decision: "approved" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("IGNORES a smuggled caller-supplied riskScore and persists the server-computed score", async () => {
    // 2026-10-02 (A3) contract change: pre-A3 the input schema TRUSTED
    // riskScore/riskCategory from the caller. The fields are removed from the
    // schema, so a smuggled value is stripped by Zod and never reaches the
    // persistence path. The caller tries to self-certify riskScore=1; the
    // server computes from real inputs (0 claims, age 36, life, ₦500k → 0).
    const result = await staffCaller.assessRisk({
      policyId: LOW_POLICY,
      decision: "approved",
      riskScore: 1,
      riskCategory: "low",
    } as any);
    expect(result.riskScore).toBe(0);
    expect(result.riskBand).toBe("low");
    expect(result.assessment.riskScore).not.toBe("1.00");

    const persisted = await persistedAssessment(LOW_POLICY);
    expect(Number(persisted.riskScore)).toBe(0);
    expect(persisted.riskCategory).toBe("low");
    expect(persisted.decision).toBe("approved");
    // Approval flips the policy draft → bound.
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = (await getDb())!;
    const r = await db.execute(
      sql`SELECT status FROM policies WHERE id = ${LOW_POLICY}`
    );
    const row = (r as any).rows?.[0] ?? (r as any)[0];
    expect(row.status).toBe("bound");
  });

  it("two policyholders with different claims histories get different server-computed scores", async () => {
    const result = await staffCaller.assessRisk({
      policyId: HIGH_POLICY,
      decision: "referred",
      // Smuggle attempt on the second caller too — ignored.
      riskScore: 5,
    } as any);

    // claims 3 → +40; age >60 → +10; aviation → +10; sumInsured 20m → +20.
    expect(result.riskScore).toBe(80);
    expect(result.riskBand).toBe("refer");
    expect(result.riskScore).toBeGreaterThan(0); // differs from LOW policy's 0

    // Every driving input is disclosed in factors.
    const byName = Object.fromEntries(
      result.riskFactors.map(f => [f.name, f] as const)
    );
    expect(byName.claims_history.points).toBe(40);
    expect(byName.claims_history.detail).toContain("claims_count=3");
    expect(byName.age.points).toBe(10);
    expect(byName.coverage_type.points).toBe(10);
    expect(byName.sum_insured.points).toBe(20);

    const persisted = await persistedAssessment(HIGH_POLICY);
    expect(Number(persisted.riskScore)).toBe(80);
    expect(persisted.riskCategory).toBe("refer");

    // 'referred' leaves the policy in its draft state.
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = (await getDb())!;
    const r = await db.execute(
      sql`SELECT status FROM policies WHERE id = ${HIGH_POLICY}`
    );
    const row = (r as any).rows?.[0] ?? (r as any)[0];
    expect(row.status).toBe("draft");
  });

  it("fails closed on an unknown policy (NOT_FOUND, nothing persisted)", async () => {
    await expect(
      staffCaller.assessRisk({ policyId: 999999, decision: "approved" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses to re-assess a policy that has left draft/quoted (CONFLICT)", async () => {
    // LOW_POLICY was bound by the earlier test.
    await expect(
      staffCaller.assessRisk({ policyId: LOW_POLICY, decision: "approved" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
