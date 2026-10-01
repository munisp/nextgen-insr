/**
 * memberClaims.test.ts — R3 batch 1 (2026-10-01, R3)
 *
 * Real-behavior PGlite tests for server/routers/memberClaims.ts (member
 * claims surface). No DB doubles: real PostgreSQL (PGlite wire protocol),
 * minimal table projections carrying exactly the columns the router selects,
 * real SQL execution — the embedded-factory/memberPolicies pattern.
 *
 * 2026-10-01 (R3-fix-ci): harness rewrite. The previous in-memory fake
 * drizzle chain double did not implement the call chain the router actually
 * uses (`d.select(...).from(...).innerJoin(...)...` — memberClaims.ts
 * lines 92/130/195/227), failing with `d.select is not a function`. The
 * production router is verified correct (the equivalent memberPolicies
 * PGlite suite passes on the same chain shapes), so ONLY the harness was
 * replaced: same scenarios, same expectations, real DB instead of chain
 * fakes. Where the old fake inspected recorded where-condition Params to
 * prove caller scoping, the real-DB equivalent is stronger: foreign rows
 * are seeded and asserted to never leak into the caller's results.
 *
 * insuranceWorkflows.fileClaim is still stubbed at the module boundary (not
 * a DB double): the delegation contract (same input in, claim out) is
 * memberClaims' behavior under test; insuranceWorkflows' own lifecycle/dedup
 * logic has its own coverage. The ownership guard (NOT_FOUND,
 * non-enumerating) is exercised for real here against real policy rows.
 *
 * Covers: unauthenticated → UNAUTHORIZED on every proc; myClaims scoped to
 * claims.claimantId = ctx.user.id (foreign rows invisible); myClaim
 * NOT_FOUND non-enumerating for foreign/nonexistent ids; own claim + real
 * claim_documents; myPoliciesPicker (caller-scoped, ACTIVE only);
 * fileClaim foreign/nonexistent → NOT_FOUND (no delegation), non-active
 * owned → BAD_REQUEST, happy path delegates unchanged.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

// 54396 (distinct from memberPolicies' 54397, auth-f3's 54399 and
// embedded-factory's 54398) so the suites can run concurrently.
const PG_PORT = 54396;
const PG_URL = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;
let pgliteChild: ChildProcess | null = null;

// Unit-test env: no Permify sidecar. Explicit insecure opt-in (same pattern
// as memberPolicies / auth-f3 / embedded-factory) so protectedProcedure
// passes the base gate; the member authz under test is enforced by the
// router itself.
process.env.PERMIFY_FAIL_OPEN = "true";

// Module-boundary stub for the delegation target (see header). NOT a DB
// double — insuranceWorkflows keeps its own coverage; here we only assert
// the delegation contract and that it is never reached for foreign policies.
const fileClaimSpy = vi.fn();
vi.mock("../insuranceWorkflows", () => ({
  insuranceWorkflowsRouter: {
    createCaller: () => ({ fileClaim: fileClaimSpy }),
  },
}));

type Caller = ReturnType<
  (typeof import("../memberClaims"))["memberClaimsRouter"]["createCaller"]
>;
let memberCaller: Caller; // user id 4242
let anonCaller: Caller;

const memberCtx = () =>
  makeAuthenticatedCtx({
    user: {
      id: 4242,
      username: "member-a",
      role: "user",
      name: "Member A",
      email: "a@example.io",
    } as never,
  });

// Seeded row ids.
let ownActivePolicyId = 0; // POL-1 — customerId 4242, active
let ownLapsedPolicyId = 0; // POL-2 — customerId 4242, lapsed
let foreignPolicyId = 0; // POL-3 — customerId 9999, active (other member)
let ownClaimId = 0; // CLM-AAA — claimantId 4242
let foreignClaimId = 0; // CLM-FRN — claimantId 9999 (other member)

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

  // Minimal tables carrying exactly the columns the router projects (plus
  // NOT-NULL columns the seed inserts). Real enum type matching
  // drizzle/schema.ts claimStatusEnum so the column type is faithful.
  await db.execute(sql`
    CREATE TYPE claim_status AS ENUM (
      'submitted', 'under_review', 'investigation', 'approved',
      'partially_approved', 'rejected', 'paid', 'closed', 'appealed',
      'escalated', 'pending_adjudication'
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS insurance_products (
      id serial PRIMARY KEY,
      name varchar(256) NOT NULL
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS policies (
      id serial PRIMARY KEY,
      "policyNumber" varchar(64) NOT NULL UNIQUE,
      "productId" integer NOT NULL,
      "customerId" integer NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'draft',
      "sumInsured" numeric(18,2) NOT NULL,
      "startDate" timestamp,
      "endDate" timestamp
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
      "approvedAmount" numeric(18,2),
      "paidAmount" numeric(18,2),
      deductible numeric(18,2),
      "incidentDescription" text NOT NULL,
      "rejectionReason" text,
      "settlementDate" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS claim_documents (
      id serial PRIMARY KEY,
      "claimId" integer NOT NULL,
      "documentType" varchar(64) NOT NULL,
      "fileName" varchar(256) NOT NULL,
      "fileUrl" text NOT NULL,
      "fileSize" integer,
      "mimeType" varchar(128),
      "isVerified" boolean DEFAULT false,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);

  const firstRow = (r: unknown) => (r as any).rows?.[0] ?? (r as any)[0];

  const prod = await db.execute(sql`
    INSERT INTO insurance_products (name) VALUES ('Motor Comprehensive')
    RETURNING id`);
  const productId = Number(firstRow(prod).id);

  const mkPolicy = (num: string, customerId: number, status: string) => sql`
    INSERT INTO policies
      ("policyNumber", "productId", "customerId", status, "sumInsured",
       "startDate", "endDate")
    VALUES
      (${num}, ${productId}, ${customerId}, ${status}, '5000000.00',
       '2026-01-01', '2027-01-01')
    RETURNING id`;
  ownActivePolicyId = Number(firstRow(await db.execute(mkPolicy("POL-1", 4242, "active"))).id);
  ownLapsedPolicyId = Number(firstRow(await db.execute(mkPolicy("POL-2", 4242, "lapsed"))).id);
  foreignPolicyId = Number(firstRow(await db.execute(mkPolicy("POL-3", 9999, "active"))).id);

  const mkClaim = (
    num: string,
    policyId: number,
    claimantId: number,
    status: string,
    claimType: string,
    amount: string,
    description: string
  ) => sql`
    INSERT INTO claims
      ("claimNumber", "policyId", "claimantId", status, "claimType",
       "incidentDate", "claimedAmount", "incidentDescription")
    VALUES
      (${num}, ${policyId}, ${claimantId}, ${status}::claim_status,
       ${claimType}, '2026-09-01', ${amount}, ${description})
    RETURNING id`;
  ownClaimId = Number(
    firstRow(
      await db.execute(
        mkClaim("CLM-AAA", ownActivePolicyId, 4242, "under_review", "fire_burglary", "5000.00", "Kitchen fire")
      )
    ).id
  );
  foreignClaimId = Number(
    firstRow(
      await db.execute(
        mkClaim("CLM-FRN", foreignPolicyId, 9999, "submitted", "motor_comprehensive", "1000.00", "Foreign claim")
      )
    ).id
  );

  await db.execute(sql`
    INSERT INTO claim_documents
      ("claimId", "documentType", "fileName", "fileUrl", "fileSize", "mimeType", "isVerified")
    VALUES
      (${ownClaimId}, 'photo', 'damage.jpg', 'https://files.example/damage.jpg',
       12345, 'image/jpeg', false)`);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberClaimsRouter } = await import("../memberClaims");
  memberCaller = memberClaimsRouter.createCaller(memberCtx());
  anonCaller = memberClaimsRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("memberClaims router (R3 batch 1, 2026-10-01)", () => {
  describe("auth gate (fail-closed)", () => {
    it("rejects anonymous callers with UNAUTHORIZED on every proc", async () => {
      await expect(anonCaller.myClaims(undefined)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(anonCaller.myClaim({ id: 1 })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(anonCaller.myPoliciesPicker()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(
        anonCaller.fileClaim({
          policyId: 1,
          claimType: "motor_comprehensive",
          incidentDate: "2026-09-01",
          claimedAmount: 1000,
          incidentDescription: "test",
        })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("myClaims", () => {
    it("scopes the query to claims.claimantId = ctx.user.id", async () => {
      const res = await memberCaller.myClaims({ limit: 50, offset: 0 });
      // Caller-scope isolation for real: the foreign claim (claimantId 9999)
      // is seeded in the same table and must never leak into the caller's
      // list — the real-DB equivalent of the old where-Param inspection.
      expect(res.count).toBe(1);
      expect(res.claims).toHaveLength(1);
      expect(res.claims[0].claimNumber).toBe("CLM-AAA");
      expect(res.claims.map(c => c.id)).not.toContain(foreignClaimId);
      expect(res.claims[0].policyNumber).toBe("POL-1");
    });
  });

  describe("myClaim", () => {
    it("returns NOT_FOUND for a foreign/nonexistent claim (non-enumerating)", async () => {
      // Ownership miss and nonexistent id are indistinguishable: the scoped
      // query simply returns no row for both.
      await expect(memberCaller.myClaim({ id: foreignClaimId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(memberCaller.myClaim({ id: 999_999_999 })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("returns the claim and its documents for the caller's own claim", async () => {
      const res = await memberCaller.myClaim({ id: ownClaimId });
      expect(res.claim.claimNumber).toBe("CLM-AAA");
      expect(res.claim.policyNumber).toBe("POL-1");
      expect(res.documents).toHaveLength(1);
      expect(res.documents[0].fileName).toBe("damage.jpg");
    });
  });

  describe("myPoliciesPicker", () => {
    it("returns the caller's active policies scoped by customerId", async () => {
      const res = await memberCaller.myPoliciesPicker();
      // Own ACTIVE policy only: the lapsed own policy and the foreign active
      // policy are both excluded by real SQL scope + status filter.
      expect(res.policies).toHaveLength(1);
      expect(res.policies[0].policyNumber).toBe("POL-1");
      expect(res.policies[0].productName).toBe("Motor Comprehensive");
      expect(res.policies[0].status).toBe("active");
    });
  });

  describe("fileClaim", () => {
    const baseInput = {
      claimType: "motor_comprehensive",
      incidentDate: "2026-09-01",
      claimedAmount: 250000,
      incidentDescription: "Rear-end collision on Third Mainland Bridge",
      documents: ["https://files.example/police-report.pdf"],
    };

    it("answers NOT_FOUND (non-enumerating) when the policy belongs to another member", async () => {
      fileClaimSpy.mockReset();
      await expect(
        memberCaller.fileClaim({ ...baseInput, policyId: foreignPolicyId })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      // Fail-closed: delegation never happens for a foreign policy.
      expect(fileClaimSpy).not.toHaveBeenCalled();
    });

    it("answers NOT_FOUND when the policy does not exist", async () => {
      fileClaimSpy.mockReset();
      await expect(
        memberCaller.fileClaim({ ...baseInput, policyId: 999_999_999 })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(fileClaimSpy).not.toHaveBeenCalled();
    });

    it("rejects filing against a non-active owned policy", async () => {
      fileClaimSpy.mockReset();
      await expect(
        memberCaller.fileClaim({ ...baseInput, policyId: ownLapsedPolicyId })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(fileClaimSpy).not.toHaveBeenCalled();
    });

    it("happy path: owned active policy delegates to insuranceWorkflows.fileClaim unchanged", async () => {
      fileClaimSpy.mockReset();
      fileClaimSpy.mockResolvedValue({
        claim: { id: 77, claimNumber: "CLM-NEW", status: "submitted" },
        claimNumber: "CLM-NEW",
      });
      const input = { ...baseInput, policyId: ownActivePolicyId };
      const res = await memberCaller.fileClaim(input);
      expect(fileClaimSpy).toHaveBeenCalledWith(input);
      expect(res.claimNumber).toBe("CLM-NEW");
    });
  });
});
