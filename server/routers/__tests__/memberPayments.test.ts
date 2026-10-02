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
let adminCaller: Caller; // session user id 99, role admin (authz bypass)
let anonCaller: Caller;

// Seeded row ids.
let ownUsersSpacePolicyId = 0; // POL-A — customerId 1 (users.id space), active
let ownCustSpacePolicyId = 0; // POL-B — customerId 4242 (customers.id space), lapsed
let foreignPolicyId = 0; // POL-C — customerId 9999, active (other member)
let duePremiumId = 0; // PRE-DUE-1 (POL-B, ₦45,000)
let duePremiumId2 = 0; // PRE-DUE-2 (POL-A, ₦120,000)
let foreignPremiumId = 0; // PRE-FRN-1 (POL-C)

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
      "tbTransferId" varchar(128),
      "gracePeriodDays" integer DEFAULT 30,
      "tenantId" integer,
      "updatedAt" timestamp NOT NULL DEFAULT now(),
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
  const dueRow = await db.execute(sql`
    INSERT INTO premiums
      ("policyId", "customerId", "premiumRef", amount, status, "dueDate",
       "paidDate")
    VALUES
      (${ownCustSpacePolicyId}, 4242, 'PRE-DUE-1', '45000.00', 'due',
       '2026-11-01', null)
    RETURNING id`);
  duePremiumId = Number(firstRow(dueRow).id);
  // Second due row on the caller's users.id-space policy (pay-flow tests).
  const dueRow2 = await db.execute(sql`
    INSERT INTO premiums
      ("policyId", "customerId", "premiumRef", amount, status, "dueDate",
       "paidDate")
    VALUES
      (${ownUsersSpacePolicyId}, 1, 'PRE-DUE-2', '120000.00', 'due',
       '2026-12-01', null)
    RETURNING id`);
  duePremiumId2 = Number(firstRow(dueRow2).id);
  // Foreign: due premium on the other member's policy — must never leak.
  const frnRow = await db.execute(sql`
    INSERT INTO premiums
      ("policyId", "customerId", "premiumRef", amount, status, "dueDate",
       "paidDate")
    VALUES
      (${foreignPolicyId}, 9999, 'PRE-FRN-1', '99999.00', 'due',
       '2026-10-15', null)
    RETURNING id`);
  foreignPremiumId = Number(firstRow(frnRow).id);

  // W7-B6: premium_payments (drizzle/schema.ts:5314) — faithful projection.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS premium_payments (
      id serial PRIMARY KEY,
      "policyId" integer NOT NULL,
      "paymentReference" varchar(128) NOT NULL UNIQUE,
      amount numeric(18,2) NOT NULL,
      currency varchar(8) NOT NULL DEFAULT 'NGN',
      "paymentDate" timestamp NOT NULL DEFAULT now(),
      "dueDate" timestamp,
      "paymentMethod" varchar(64),
      channel varchar(64),
      status varchar(32) NOT NULL DEFAULT 'pending',
      "gatewayRef" varchar(256),
      "receiptNumber" varchar(64),
      "periodStart" timestamp,
      "periodEnd" timestamp,
      "isInstallment" boolean DEFAULT false,
      "installmentNumber" integer,
      "totalInstallments" integer,
      "tigerBeetleRef" varchar(128),
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // W7-B6: idempotency_records (drizzle/schema.ts:913) — the F-02 store the
  // journey-activities helpers execute against for real.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS idempotency_records (
      id serial PRIMARY KEY,
      key varchar(192) NOT NULL UNIQUE,
      journey varchar(32) NOT NULL,
      "payloadHash" varchar(64),
      status varchar(16) NOT NULL DEFAULT 'in_progress',
      result jsonb,
      error text,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now(),
      "expiresAt" timestamp NOT NULL
    )`);
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
  adminCaller = memberPaymentsRouter.createCaller(
    makeAuthenticatedCtx({
      user: {
        id: 99,
        username: "admin-1",
        role: "admin",
        name: "Admin",
        email: "admin@example.io",
      } as never,
    })
  );
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
      expect(res.count).toBe(4);
      expect(res.premiums).toHaveLength(4);
      const refs = res.premiums.map(p => p.premiumRef).sort();
      expect(refs).toEqual(["PRE-DUE-1", "PRE-DUE-2", "PRE-FAIL-1", "PRE-PAID-1"]);
      // Settled + failed shown verbatim — no cosmetic status filtering.
      const statuses = res.premiums.map(p => p.status).sort();
      expect(statuses).toEqual(["due", "due", "failed", "paid"]);
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
      expect(res.count).toBe(3);
      const refs = res.premiums.map(p => p.premiumRef).sort();
      expect(refs).toEqual(["PRE-DUE-2", "PRE-FAIL-1", "PRE-PAID-1"]);
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
      expect(res.duePremiums).toHaveLength(2);
      const refs = res.duePremiums.map(p => p.premiumRef).sort();
      expect(refs).toEqual(["PRE-DUE-1", "PRE-DUE-2"]);
      const due = res.duePremiums.find(p => p.premiumRef === "PRE-DUE-1");
      expect(due?.amount).toBe("45000.00");
      expect(due?.currency).toBe("NGN");
      expect(due?.policyNumber).toBe("POL-B");
      expect(due?.status).toBe("due");
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

  /**
   * W7-B6 (2026-10-03): initiatePremiumPayment / verifyPremiumPayment.
   * The "gateway" is a REAL local HTTP wire server speaking the Paystack
   * response shape (PAYSTACK_BASE_URL override) — the same real-wire ethos
   * as the PGlite DB; nothing is mocked on the production path.
   */
  describe("pay premium (W7-B6)", () => {
    let gatewayServer: import("node:http").Server | null = null;
    let gatewayUrl = "";
    // Scriptable gateway behavior per reference (default: verify succeeds
    // with the amount recorded at initialize).
    const verifyOverrides = new Map<
      string,
      { status: string; amountKobo?: number }
    >();
    const initiatedAmounts = new Map<string, number>();

    beforeAll(async () => {
      const http = await import("node:http");
      gatewayServer = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", c => chunks.push(c));
        req.on("end", () => {
          res.setHeader("content-type", "application/json");
          if (req.method === "POST" && req.url === "/transaction/initialize") {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            initiatedAmounts.set(String(body.reference), Number(body.amount));
            res.end(
              JSON.stringify({
                status: true,
                message: "Authorization URL created",
                data: {
                  authorization_url: `http://gateway.test/checkout/${body.reference}`,
                  access_code: "ac_wire_test",
                  reference: body.reference,
                },
              })
            );
            return;
          }
          const verifyMatch = req.url?.match(/^\/transaction\/verify\/(.+)$/);
          if (req.method === "GET" && verifyMatch) {
            const ref = decodeURIComponent(verifyMatch[1]);
            const override = verifyOverrides.get(ref);
            const status = override?.status ?? "success";
            res.end(
              JSON.stringify({
                status: true,
                message: "Verification successful",
                data: {
                  status,
                  amount:
                    override?.amountKobo ?? initiatedAmounts.get(ref) ?? 0,
                  reference: ref,
                  id: 777001,
                  paid_at: "2026-10-03T00:00:00.000Z",
                  channel: "card",
                },
              })
            );
            return;
          }
          res.statusCode = 404;
          res.end(JSON.stringify({ status: false, message: "not found" }));
        });
      });
      await new Promise<void>(resolve =>
        gatewayServer!.listen(0, "127.0.0.1", resolve)
      );
      const addr = gatewayServer.address();
      gatewayUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    }, 30_000);

    afterAll(async () => {
      delete process.env.PAYSTACK_SECRET_KEY;
      delete process.env.PAYSTACK_BASE_URL;
      await new Promise(resolve => gatewayServer?.close(resolve));
    });

    function configureGateway() {
      process.env.PAYSTACK_SECRET_KEY = "sk_wire_test";
      process.env.PAYSTACK_BASE_URL = gatewayUrl;
    }
    function unconfigureGateway() {
      delete process.env.PAYSTACK_SECRET_KEY;
      delete process.env.PAYSTACK_BASE_URL;
    }

    it("rejects anonymous callers on both pay procedures", async () => {
      await expect(
        anonCaller.initiatePremiumPayment({
          policyId: ownCustSpacePolicyId,
          premiumId: duePremiumId,
          idempotencyKey: "anon-key-0001",
        })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(
        anonCaller.verifyPremiumPayment({ reference: "PP-POL-B-anon" })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("requires an idempotency key (missing → BAD_REQUEST)", async () => {
      await expect(
        memberCaller.initiatePremiumPayment({
          policyId: ownCustSpacePolicyId,
          premiumId: duePremiumId,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("gates ownership: non-owner → NOT_FOUND (non-enumerating), owner and admin pass the gate", async () => {
      unconfigureGateway();
      // Non-owner: refused at the ownership gate, no existence leak.
      await expect(
        emptyCaller.initiatePremiumPayment({
          policyId: ownCustSpacePolicyId,
          premiumId: duePremiumId,
          idempotencyKey: "gate-key-00001",
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        memberCaller.initiatePremiumPayment({
          policyId: foreignPolicyId,
          premiumId: foreignPremiumId,
          idempotencyKey: "gate-key-00002",
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      // Owner + admin pass the gate and hit the NEXT fail-closed guard
      // (gateway unconfigured) — proving the gate, not ownership, differed.
      await expect(
        memberCaller.initiatePremiumPayment({
          policyId: ownCustSpacePolicyId,
          premiumId: duePremiumId,
          idempotencyKey: "gate-key-00003",
        })
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("not configured"),
      });
      await expect(
        adminCaller.initiatePremiumPayment({
          policyId: foreignPolicyId,
          premiumId: foreignPremiumId,
          idempotencyKey: "gate-key-00004",
        })
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("not configured"),
      });
    });

    it("fails closed with an honest error when the gateway is unconfigured (no rows written)", async () => {
      unconfigureGateway();
      await expect(
        memberCaller.initiatePremiumPayment({
          policyId: ownUsersSpacePolicyId,
          premiumId: duePremiumId2,
          idempotencyKey: "unconf-key-001",
        })
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("NOT initiated"),
      });
      const { getDb } = await import("../../db");
      const { sql } = await import("drizzle-orm");
      const d = await getDb();
      const rows = await d!.execute(sql`
        SELECT COUNT(*)::int AS c FROM premium_payments
        WHERE "paymentReference" LIKE 'PP-POL-A-unconf%'`);
      const c = (rows as any).rows?.[0]?.c ?? (rows as any)[0]?.c;
      expect(Number(c)).toBe(0);
    });

    it("initiates for real: derived reference, server-side amount, pending payment row, ledger link", async () => {
      configureGateway();
      const res = await memberCaller.initiatePremiumPayment({
        policyId: ownCustSpacePolicyId,
        premiumId: duePremiumId,
        idempotencyKey: "pay-key-000001",
      });
      expect(res.idempotent).toBe(false);
      expect(res.reference).toBe("PP-POL-B-pay-key-000001");
      expect(res.authorizationUrl).toBe(
        "http://gateway.test/checkout/PP-POL-B-pay-key-000001"
      );
      // Amount derived SERVER-SIDE from the due ledger row (₦45,000).
      expect(res.amount).toBe("45000.00");
      expect(initiatedAmounts.get(res.reference)).toBe(4_500_000); // kobo

      const { getDb } = await import("../../db");
      const { sql } = await import("drizzle-orm");
      const d = await getDb();
      const rows = await d!.execute(sql`
        SELECT status, amount::text, "policyId" FROM premium_payments
        WHERE "paymentReference" = 'PP-POL-B-pay-key-000001'`);
      const row = (rows as any).rows?.[0] ?? (rows as any)[0];
      expect(row.status).toBe("pending");
      expect(row.amount).toBe("45000.00");
      expect(Number(row.policyId)).toBe(ownCustSpacePolicyId);
      // The due ledger row is linked to the payment reference.
      const prem = await d!.execute(sql`
        SELECT status, "paymentRef" FROM premiums WHERE id = ${duePremiumId}`);
      const prow = (prem as any).rows?.[0] ?? (prem as any)[0];
      expect(prow.status).toBe("due");
      expect(prow.paymentRef).toBe("PP-POL-B-pay-key-000001");
    });

    it("replays the same key+payload without a second payment row; different payload → CONFLICT", async () => {
      configureGateway();
      const replay = await memberCaller.initiatePremiumPayment({
        policyId: ownCustSpacePolicyId,
        premiumId: duePremiumId,
        idempotencyKey: "pay-key-000001",
      });
      expect(replay.idempotent).toBe(true);
      expect(replay.reference).toBe("PP-POL-B-pay-key-000001");

      const { getDb } = await import("../../db");
      const { sql } = await import("drizzle-orm");
      const d = await getDb();
      const rows = await d!.execute(sql`
        SELECT COUNT(*)::int AS c FROM premium_payments
        WHERE "paymentReference" = 'PP-POL-B-pay-key-000001'`);
      const c = (rows as any).rows?.[0]?.c ?? (rows as any)[0]?.c;
      expect(Number(c)).toBe(1);

      // Same key, different funds terms → CONFLICT (payload-hash binding).
      await expect(
        memberCaller.initiatePremiumPayment({
          policyId: ownUsersSpacePolicyId,
          premiumId: duePremiumId2,
          idempotencyKey: "pay-key-000001",
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("verify credits atomically on gateway success and is replay-safe", async () => {
      configureGateway();
      const ref = "PP-POL-B-pay-key-000001";
      const first = await memberCaller.verifyPremiumPayment({
        reference: ref,
      });
      expect(first.status).toBe("success");
      expect(first.idempotent).toBe(false);

      const { getDb } = await import("../../db");
      const { sql } = await import("drizzle-orm");
      const d = await getDb();
      const pay = await d!.execute(sql`
        SELECT status, "gatewayRef" FROM premium_payments
        WHERE "paymentReference" = ${ref}`);
      const payRow = (pay as any).rows?.[0] ?? (pay as any)[0];
      expect(payRow.status).toBe("success");
      expect(payRow.gatewayRef).toBe("777001");
      const prem = await d!.execute(sql`
        SELECT status, "paidDate" FROM premiums WHERE id = ${duePremiumId}`);
      const premRow = (prem as any).rows?.[0] ?? (prem as any)[0];
      expect(premRow.status).toBe("paid");
      expect(premRow.paidDate).toBeTruthy();

      // Replay: returns the existing result, credits exactly once.
      const again = await memberCaller.verifyPremiumPayment({
        reference: ref,
      });
      expect(again.status).toBe("success");
      expect(again.idempotent).toBe(true);
      const cnt = await d!.execute(sql`
        SELECT COUNT(*)::int AS c FROM premiums
        WHERE "paymentRef" = ${ref} AND status = 'paid'`);
      const c = (cnt as any).rows?.[0]?.c ?? (cnt as any)[0]?.c;
      expect(Number(c)).toBe(1);
    });

    it("verify gates ownership (foreign reference → NOT_FOUND)", async () => {
      configureGateway();
      await expect(
        emptyCaller.verifyPremiumPayment({
          reference: "PP-POL-B-pay-key-000001",
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        emptyCaller.verifyPremiumPayment({ reference: "PP-NOPE-00000000" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("refuses credit when the gateway amount does not match the recorded premium", async () => {
      configureGateway();
      const res = await memberCaller.initiatePremiumPayment({
        policyId: ownUsersSpacePolicyId,
        premiumId: duePremiumId2,
        idempotencyKey: "pay-key-000002",
      });
      verifyOverrides.set(res.reference, {
        status: "success",
        amountKobo: 1_000, // gateway claims ₦10 — row says ₦120,000
      });
      await expect(
        memberCaller.verifyPremiumPayment({ reference: res.reference })
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
      const { getDb } = await import("../../db");
      const { sql } = await import("drizzle-orm");
      const d = await getDb();
      const rows = await d!.execute(sql`
        SELECT status FROM premium_payments WHERE "paymentReference" = ${res.reference}`);
      const row = (rows as any).rows?.[0] ?? (rows as any)[0];
      expect(row.status).toBe("pending"); // never credited
    });

    it("honest unpaid surface: gateway 'failed' never credits", async () => {
      configureGateway();
      const res = await adminCaller.initiatePremiumPayment({
        policyId: foreignPolicyId,
        premiumId: foreignPremiumId,
        idempotencyKey: "pay-key-000003",
      });
      verifyOverrides.set(res.reference, { status: "failed" });
      const v = await adminCaller.verifyPremiumPayment({
        reference: res.reference,
      });
      expect(v.status).toBe("failed");
      const { getDb } = await import("../../db");
      const { sql } = await import("drizzle-orm");
      const d = await getDb();
      const rows = await d!.execute(sql`
        SELECT status FROM premiums WHERE id = ${foreignPremiumId}`);
      const row = (rows as any).rows?.[0] ?? (rows as any)[0];
      expect(row.status).toBe("due"); // still unpaid
    });
  });
});
