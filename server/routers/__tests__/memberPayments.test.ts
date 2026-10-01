/**
 * memberPayments.test.ts — R3 batch 2 (2026-10-01, R3-b2)
 *
 * Real-behavior PGlite tests for server/routers/memberPayments.ts (member
 * payments surface, READ-ONLY). No DB doubles: real embedded PostgreSQL
 * (PGlite wire protocol), minimal table projections carrying exactly the
 * columns the router selects, real SQL execution — the
 * memberClaims/memberReferrals R3 harness pattern. Caller scoping is proven
 * for real: foreign rows are seeded in the same tables and asserted to never
 * leak into the caller's results.
 *
 * 2026-10-01 (R3-b2): EPHEMERAL port probe copied verbatim from
 * memberReferrals.test.ts (R3-fix-ci2) — hardcoded ports collided in CI
 * (EADDRINUSE); probe a free port, compute PG_URL after the probe.
 *
 * Covers: anonymous → UNAUTHORIZED on both procs; myPremiums dual-identity
 * scope isolation (users.id-space AND customers.id-space own rows returned,
 * every status shown verbatim; foreign rows invisible); policyId filter
 * ownership check (foreign/nonexistent → NOT_FOUND, non-enumerating);
 * myPremiumDue due-amount correctness against seeded rows (status "due"
 * ledger rows only, recorded annualPremium per payable policy, foreign
 * policies excluded); empty states for a caller with no customer profile.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

// Ephemeral free port (memberReferrals.test.ts probe, 2026-10-01 R3 copy).
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
// as memberPolicies / memberReferrals) so protectedProcedure passes the base
// gate; the member authz under test is enforced by the router itself.
process.env.PERMIFY_FAIL_OPEN = "true";

type Caller = ReturnType<
  (typeof import("../memberPayments"))["memberPaymentsRouter"]["createCaller"]
>;
let memberCaller: Caller; // session user id 1 → customer 4242
let emptyCaller: Caller; // session user id 3 → no customer profile, no policies
let anonCaller: Caller;

// Seeded row ids.
let ownUsersSpacePolicyId = 0; // POL-A — customerId 1 (users.id space), active
let ownCustSpacePolicyId = 0; // POL-B — customerId 4242 (customers.id space), lapsed
let foreignPolicyId = 0; // POL-C — customerId 9999, active (other member)

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

  // Minimal tables carrying exactly the columns the router projects (plus
  // NOT-NULL columns the seed inserts).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      "firstName" varchar(64) NOT NULL,
      "lastName" varchar(64) NOT NULL,
      phone varchar(20) NOT NULL UNIQUE,
      "keycloakSub" varchar(128) UNIQUE
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
      "annualPremium" numeric(18,2) NOT NULL,
      "renewalDate" timestamp
    )`);
  // premiums (drizzle/schema.additions.ts:303): minimal faithful projection.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS premiums (
      id serial PRIMARY KEY,
      "policyId" integer NOT NULL,
      "customerId" integer,
      "agentId" integer,
      "premiumRef" varchar(128) NOT NULL UNIQUE,
      amount numeric(15,2) NOT NULL,
      currency varchar(8) NOT NULL DEFAULT 'NGN',
      "dueDate" timestamp NOT NULL,
      "paidDate" timestamp,
      status varchar(32) NOT NULL DEFAULT 'due',
      "paymentMethod" varchar(64),
      "paymentRef" varchar(128),
      "gracePeriodDays" integer DEFAULT 30,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);

  const firstRow = (r: unknown) => (r as any).rows?.[0] ?? (r as any)[0];

  await db.execute(sql`
    INSERT INTO customers (id, "firstName", "lastName", phone, "keycloakSub")
    VALUES
      (4242, 'Member', 'A', '09000000001', '1'),
      (9999, 'Member', 'B', '09000000002', '2')
    ON CONFLICT DO NOTHING`);

  const prod = await db.execute(sql`
    INSERT INTO insurance_products (name) VALUES ('Motor Comprehensive')
    RETURNING id`);
  const productId = Number(firstRow(prod).id);

  const mkPolicy = (
    num: string,
    customerId: number,
    status: string,
    annualPremium: string,
    renewalDate: string | null
  ) => sql`
    INSERT INTO policies
      ("policyNumber", "productId", "customerId", status, "annualPremium",
       "renewalDate")
    VALUES
      (${num}, ${productId}, ${customerId}, ${status}, ${annualPremium},
       ${renewalDate})
    RETURNING id`;
  ownUsersSpacePolicyId = Number(
    firstRow(await db.execute(mkPolicy("POL-A", 1, "active", "120000.00", "2027-01-01"))).id
  );
  ownCustSpacePolicyId = Number(
    firstRow(await db.execute(mkPolicy("POL-B", 4242, "lapsed", "45000.00", null))).id
  );
  foreignPolicyId = Number(
    firstRow(await db.execute(mkPolicy("POL-C", 9999, "active", "99999.00", "2027-06-01"))).id
  );

  const mkPremium = (
    premiumRef: string,
    policyId: number,
    customerId: number,
    amount: string,
    status: string,
    dueDate: string,
    paidDate: string | null
  ) => sql`
    INSERT INTO premiums
      ("policyId", "customerId", "premiumRef", amount, status, "dueDate",
       "paidDate")
    VALUES
      (${policyId}, ${customerId}, ${premiumRef}, ${amount}, ${status},
       ${dueDate}, ${paidDate})`;

  // Caller-owned, users.id space: one paid, one failed (shown verbatim).
  await db.execute(
    mkPremium("PRE-PAID-1", ownUsersSpacePolicyId, 1, "120000.00", "paid", "2026-01-05", "2026-01-05")
  );
  await db.execute(
    mkPremium("PRE-FAIL-1", ownUsersSpacePolicyId, 1, "120000.00", "failed", "2026-10-05", null)
  );
  // Caller-owned, customers.id space: one still due.
  await db.execute(
    mkPremium("PRE-DUE-1", ownCustSpacePolicyId, 4242, "45000.00", "due", "2026-11-01", null)
  );
  // Foreign: due premium on the other member's policy — must never leak.
  await db.execute(
    mkPremium("PRE-FRN-1", foreignPolicyId, 9999, "99999.00", "due", "2026-10-15", null)
  );
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberPaymentsRouter } = await import("../memberPayments");
  memberCaller = memberPaymentsRouter.createCaller(
    makeAuthenticatedCtx({
      user: {
        id: 1,
        username: "member-a",
        role: "user",
        name: "Member A",
        email: "a@example.io",
      } as never,
    })
  );
  emptyCaller = memberPaymentsRouter.createCaller(
    makeAuthenticatedCtx({
      user: {
        id: 3,
        username: "member-c",
        role: "user",
        name: "Member C",
        email: "c@example.io",
      } as never,
    })
  );
  anonCaller = memberPaymentsRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("memberPayments router (R3 batch 2, 2026-10-01)", () => {
  describe("auth gate (fail-closed)", () => {
    it("rejects anonymous callers with UNAUTHORIZED on every proc", async () => {
      await expect(anonCaller.myPremiums(undefined)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(anonCaller.myPremiumDue()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });

  describe("myPremiums", () => {
    it("returns the caller's premium rows in BOTH identity spaces, every status verbatim, and never foreign rows", async () => {
      const res = await memberCaller.myPremiums({ limit: 50, offset: 0 });
      expect(res.count).toBe(3);
      expect(res.premiums).toHaveLength(3);
      const refs = res.premiums.map(p => p.premiumRef).sort();
      expect(refs).toEqual(["PRE-DUE-1", "PRE-FAIL-1", "PRE-PAID-1"]);
      // Settled + failed shown verbatim — no cosmetic status filtering.
      const statuses = res.premiums.map(p => p.status).sort();
      expect(statuses).toEqual(["due", "failed", "paid"]);
      // Foreign premium never leaks.
      expect(refs).not.toContain("PRE-FRN-1");
      // Policy numbers joined through for the caller's own policies.
      const paid = res.premiums.find(p => p.premiumRef === "PRE-PAID-1");
      expect(paid?.policyNumber).toBe("POL-A");
      expect(paid?.amount).toBe("120000.00");
      const due = res.premiums.find(p => p.premiumRef === "PRE-DUE-1");
      expect(due?.policyNumber).toBe("POL-B");
    });

    it("filters by an owned policyId", async () => {
      const res = await memberCaller.myPremiums({
        policyId: ownUsersSpacePolicyId,
        limit: 50,
        offset: 0,
      });
      expect(res.count).toBe(2);
      const refs = res.premiums.map(p => p.premiumRef).sort();
      expect(refs).toEqual(["PRE-FAIL-1", "PRE-PAID-1"]);
    });

    it("answers NOT_FOUND (non-enumerating) for a foreign or nonexistent policyId filter", async () => {
      await expect(
        memberCaller.myPremiums({ policyId: foreignPolicyId })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        memberCaller.myPremiums({ policyId: 999_999_999 })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("myPremiumDue", () => {
    it("returns only the caller's status-due ledger rows with recorded amounts", async () => {
      const res = await memberCaller.myPremiumDue();
      expect(res.duePremiums).toHaveLength(1);
      const due = res.duePremiums[0];
      expect(due.premiumRef).toBe("PRE-DUE-1");
      expect(due.amount).toBe("45000.00");
      expect(due.currency).toBe("NGN");
      expect(due.policyNumber).toBe("POL-B");
      expect(due.status).toBe("due");
      // The foreign due premium (PRE-FRN-1) must never appear.
      expect(res.duePremiums.map(p => p.premiumRef)).not.toContain("PRE-FRN-1");
    });

    it("returns the caller's payable policies with their recorded annualPremium, foreign policies excluded", async () => {
      const res = await memberCaller.myPremiumDue();
      const numbers = res.policies.map(p => p.policyNumber).sort();
      expect(numbers).toEqual(["POL-A", "POL-B"]); // POL-C excluded
      const polA = res.policies.find(p => p.policyNumber === "POL-A");
      expect(polA?.annualPremium).toBe("120000.00");
      expect(polA?.status).toBe("active");
      expect(polA?.productName).toBe("Motor Comprehensive");
      expect(polA?.currency).toBe("NGN");
      const polB = res.policies.find(p => p.policyNumber === "POL-B");
      expect(polB?.annualPremium).toBe("45000.00");
      expect(polB?.status).toBe("lapsed");
      // Honest disclosure ships verbatim for the UI.
      expect(res.disclosure).toContain("recorded policy amounts");
    });
  });

  describe("empty states", () => {
    it("a caller with no customer profile and no policies gets empty results, not errors", async () => {
      const history = await emptyCaller.myPremiums(undefined);
      expect(history.count).toBe(0);
      expect(history.premiums).toHaveLength(0);
      const due = await emptyCaller.myPremiumDue();
      expect(due.duePremiums).toHaveLength(0);
      expect(due.policies).toHaveLength(0);
    });
  });
});
