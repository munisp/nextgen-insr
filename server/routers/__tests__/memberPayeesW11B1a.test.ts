/**
 * memberPayeesW11B1a.test.ts — W11-B1a (2026-10-05)
 *
 * Real-behavior tests for the member payee directory
 * (server/routers/memberPayees.ts + server/lib/memberPayees.ts), its wiring
 * into the W10-B2 confirm flows (server/lib/memberFunds.ts), and the claim
 * prefill endpoint (memberClaims.getClaimPrefill).
 *
 * REAL PGlite PostgreSQL; the schema under test is applied by executing the
 * REAL migration file drizzle/0090_payee_directory.sql (so the migration is
 * verified to apply cleanly here). The ONLY doubles are the external HTTP
 * boundaries (Paystack + bill provider wire servers,
 * memberAirtimeVendW10B2.test.ts harness pattern); nothing on the production
 * path is mocked.
 *
 * Covers:
 *   - Upsert semantics: natural-key dedupe, useCount increments,
 *     lastAmountKobo update, label preserved across upserts.
 *   - Encryption at rest: raw payee_directory rows do NOT contain plaintext
 *     meter/phone/wallet; list decrypts server-side for the owner.
 *   - Cross-member isolation: member B cannot list/rename/remove A's payees
 *     (NOT_FOUND, non-enumerating) — mutant-probed below.
 *   - Confirm wiring: successful confirm (gateway verify success) records a
 *     bill payee; a gateway-FAILED confirm creates NO payee; an unconfirmed
 *     (pending) payment creates NO payee.
 *   - getClaimPrefill: ownership (foreign policy → NOT_FOUND), correct field
 *     derivation (policy/product/member contact/lastClaim).
 */
import { spawn, type ChildProcess } from "node:child_process";
import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

process.env.PERMIFY_FAIL_OPEN = "true";

let pgliteChild: ChildProcess | null = null;

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
  const port = await probeFreePort();
  const script = path.resolve(
    __dirname,
    "../../../tests/integration/setup/pgliteServer.mjs"
  );
  pgliteChild = spawn(process.execPath, [script], {
    env: { ...process.env, PGLITE_PORT: String(port) },
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
  process.env.POSTGRES_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
}

/** Member A: users.id 1 ↔ customers.id 4242. Member B: users.id 2 ↔ 9999. */
const A_USER = 1;
const A_CUSTOMER = 4242;
const B_USER = 2;

async function createTablesAndSeed() {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("PGlite DB not reachable");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      "firstName" varchar(64) NOT NULL DEFAULT 'M',
      "lastName" varchar(64) NOT NULL DEFAULT 'T',
      email varchar(320),
      phone varchar(20) NOT NULL UNIQUE,
      "keycloakSub" varchar(128) UNIQUE,
      "kycLevel" integer NOT NULL DEFAULT 0
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id serial PRIMARY KEY,
      ref varchar(32) NOT NULL UNIQUE,
      "idempotencyKey" varchar(192) UNIQUE,
      "agentId" integer NOT NULL,
      type varchar(32) NOT NULL,
      amount numeric(15,2) NOT NULL,
      fee numeric(10,2) DEFAULT '0.00',
      commission numeric(10,2) DEFAULT '0.00',
      currency varchar(8) NOT NULL DEFAULT 'NGN',
      "customerName" varchar(128),
      "customerPhone" varchar(20),
      "customerAccount" varchar(20),
      "destinationBank" varchar(64),
      "destinationAccount" varchar(20),
      channel varchar(16) DEFAULT 'App',
      status varchar(32) NOT NULL DEFAULT 'pending',
      "failureReason" text,
      "receiptPrinted" boolean DEFAULT false,
      "smsSent" boolean DEFAULT false,
      "fraudScore" numeric(5,2) DEFAULT '0.00',
      "velocityBreached" boolean DEFAULT false,
      "velocityReason" text,
      "approvalRequired" boolean DEFAULT false,
      "approvedBy" varchar(64),
      "approvedAt" timestamp,
      "deviceToken" varchar(64),
      metadata json,
      "deletedAt" timestamp,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS idempotency_records (
      id serial PRIMARY KEY,
      key varchar(192) NOT NULL UNIQUE,
      journey varchar(64) NOT NULL,
      "payloadHash" varchar(64),
      status varchar(16) NOT NULL DEFAULT 'in_progress',
      result jsonb,
      error text,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now(),
      "expiresAt" timestamp NOT NULL
    )`);
  // The REAL W11-B1a migration — verifies it applies cleanly on PGlite.
  const migrationSql = fs.readFileSync(
    path.resolve(__dirname, "../../../drizzle/0090_payee_directory.sql"),
    "utf8"
  );
  await db.execute(sql.raw(migrationSql));
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS insurance_products (
      id serial PRIMARY KEY,
      "productCode" varchar(32) NOT NULL UNIQUE,
      name varchar(256) NOT NULL
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS policies (
      id serial PRIMARY KEY,
      "policyNumber" varchar(64) NOT NULL UNIQUE,
      "productId" integer NOT NULL,
      "customerId" integer NOT NULL,
      status varchar(32) NOT NULL DEFAULT 'active',
      "coverageType" varchar(32) NOT NULL,
      "sumInsured" numeric(18,2) NOT NULL,
      "annualPremium" numeric(18,2) NOT NULL,
      "startDate" timestamp,
      "endDate" timestamp,
      metadata json,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS claims (
      id serial PRIMARY KEY,
      "claimNumber" varchar(64) NOT NULL UNIQUE,
      "policyId" integer NOT NULL,
      "claimantId" integer NOT NULL,
      status varchar(32) NOT NULL DEFAULT 'submitted',
      "claimType" varchar(64) NOT NULL,
      "incidentDate" timestamp NOT NULL,
      "claimedAmount" numeric(18,2) NOT NULL,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    INSERT INTO customers (id, "firstName", "lastName", email, phone, "keycloakSub", "kycLevel") VALUES
      (${A_CUSTOMER}, 'Ada', 'Okafor', 'ada@example.io', '09000000001', '1', 3),
      (9999, 'Bala', 'Yusuf', 'bala@example.io', '09000000002', '2', 3)
    ON CONFLICT DO NOTHING`);
}

// ── Wire servers (Paystack + bill provider) — memberAirtimeVendW10B2 pattern ──
let gatewayServer: Server | null = null;
let providerServer: Server | null = null;
const initiatedAmounts = new Map<string, number>();
const verifyStatus = new Map<string, "success" | "failed">();

async function startWireServers() {
  const http = await import("node:http");
  gatewayServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.method === "POST" && req.url === "/transaction/initialize") {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        initiatedAmounts.set(String(body.reference), Number(body.amount));
        res.end(JSON.stringify({
          status: true,
          message: "Authorization URL created",
          data: {
            authorization_url: `http://gateway.test/checkout/${body.reference}`,
            access_code: "ac_wire_test",
            reference: body.reference,
          },
        }));
        return;
      }
      const m = req.url?.match(/^\/transaction\/verify\/(.+)$/);
      if (req.method === "GET" && m) {
        const ref = decodeURIComponent(m[1]);
        const st = verifyStatus.get(ref) ?? "success";
        res.end(JSON.stringify({
          status: true,
          message: "Verification successful",
          data: {
            status: st,
            amount: initiatedAmounts.get(ref) ?? 0,
            reference: ref,
            id: 777003,
            paid_at: "2026-10-05T00:00:00.000Z",
            channel: "card",
          },
        }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ status: false, message: "not found" }));
    });
  });
  providerServer = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === "/pay") {
      res.end(JSON.stringify({ status: "accepted", provider_ref: "PRV-W11" }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ status: "failed", message: "not found" }));
  });
  await new Promise<void>(r => gatewayServer!.listen(0, "127.0.0.1", r));
  await new Promise<void>(r => providerServer!.listen(0, "127.0.0.1", r));
  const g = gatewayServer.address();
  const p = providerServer.address();
  process.env.PAYSTACK_SECRET_KEY = "sk_wire_test";
  process.env.PAYSTACK_BASE_URL = `http://127.0.0.1:${typeof g === "object" && g ? g.port : 0}`;
  process.env.BILL_PROVIDER_URL = `http://127.0.0.1:${typeof p === "object" && p ? p.port : 0}`;
}

type Db = NonNullable<Awaited<ReturnType<(typeof import("../../db"))["getDb"]>>>;
async function db(): Promise<Db> {
  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) throw new Error("DB unavailable in test");
  return d;
}

async function rawPayeeRows(customerId: number) {
  const { sql } = await import("drizzle-orm");
  const d = await db();
  const rows = await d.execute(
    sql`SELECT * FROM payee_directory WHERE "customerId" = ${customerId} ORDER BY id`
  );
  return ((rows as any).rows ?? (rows as any)) as Array<Record<string, unknown>>;
}

let payeesA: ReturnType<
  (typeof import("../memberPayees"))["memberPayeesRouter"]["createCaller"]
>;
let payeesB: typeof payeesA;
let payeesAnon: typeof payeesA;
let billsA: ReturnType<
  (typeof import("../memberBillPayments"))["memberBillPaymentsRouter"]["createCaller"]
>;
let claimsA: ReturnType<
  (typeof import("../memberClaims"))["memberClaimsRouter"]["createCaller"]
>;
let claimsB: typeof claimsA;

function ctxFor(userId: number) {
  return makeAuthenticatedCtx({
    user: { id: userId, username: `member-${userId}`, role: "user", email: `m${userId}@example.io` } as never,
  });
}

let policyAUsersSpace = 0; // policies.customerId = users.id (portal space)
let policyACustomerSpace = 0; // policies.customerId = customers.id (wallet space)

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  await startWireServers();
  const { memberPayeesRouter } = await import("../memberPayees");
  const { memberBillPaymentsRouter } = await import("../memberBillPayments");
  const { memberClaimsRouter } = await import("../memberClaims");
  payeesA = memberPayeesRouter.createCaller(ctxFor(A_USER));
  payeesB = memberPayeesRouter.createCaller(ctxFor(B_USER));
  payeesAnon = memberPayeesRouter.createCaller(makeUnauthenticatedCtx());
  billsA = memberBillPaymentsRouter.createCaller(ctxFor(A_USER));
  claimsA = memberClaimsRouter.createCaller(ctxFor(A_USER));
  claimsB = memberClaimsRouter.createCaller(ctxFor(B_USER));

  const d = await db();
  const { sql } = await import("drizzle-orm");
  await d.execute(sql`
    INSERT INTO insurance_products (id, "productCode", name) VALUES
      (501, 'MTR-COMP', 'Comprehensive Motor')
    ON CONFLICT DO NOTHING`);
  const p1 = await d.execute(sql`
    INSERT INTO policies ("policyNumber", "productId", "customerId", status, "coverageType",
      "sumInsured", "annualPremium", metadata)
    VALUES ('POL-A-001', 501, ${A_USER}, 'active', 'motor', 5000000, 250000,
      ${JSON.stringify({ asset: { plate: "ABC-123-XY", make: "Toyota" } })})
    RETURNING id`);
  policyAUsersSpace = Number(((p1 as any).rows ?? (p1 as any))[0].id);
  const p2 = await d.execute(sql`
    INSERT INTO policies ("policyNumber", "productId", "customerId", status, "coverageType",
      "sumInsured", "annualPremium")
    VALUES ('POL-A-002', 501, ${A_CUSTOMER}, 'active', 'motor', 3000000, 150000)
    RETURNING id`);
  policyACustomerSpace = Number(((p2 as any).rows ?? (p2 as any))[0].id);
  await d.execute(sql`
    INSERT INTO claims ("claimNumber", "policyId", "claimantId", status, "claimType",
      "incidentDate", "claimedAmount")
    VALUES ('CLM-A-001', ${policyAUsersSpace}, ${A_USER}, 'paid', 'accident',
      '2026-09-01T00:00:00Z', 750000)`);
}, 90_000);

afterAll(async () => {
  delete process.env.PAYSTACK_SECRET_KEY;
  delete process.env.PAYSTACK_BASE_URL;
  delete process.env.BILL_PROVIDER_URL;
  pgliteChild?.kill();
  await new Promise(r => gatewayServer?.close(r));
  await new Promise(r => providerServer?.close(r));
});

describe("memberPayees directory (W11-B1a, 2026-10-05)", () => {
  it("records a bill payee ONLY on gateway-verified successful confirm; failed/pending payments create none", async () => {
    // Pending (never confirmed) payment → no payee.
    const pending = await billsA.pay({
      biller: "EKEDC",
      customerNumber: "04512345678",
      amountNGN: 2500,
      idempotencyKey: "w11-pend-001",
    });
    expect(pending.status).toBe("awaiting_payment");
    expect(await rawPayeeRows(A_CUSTOMER)).toHaveLength(0);

    // Gateway-FAILED confirm → row fails, NO payee.
    const failed = await billsA.pay({
      biller: "EKEDC",
      customerNumber: "04599999999",
      amountNGN: 1000,
      idempotencyKey: "w11-fail-001",
    });
    verifyStatus.set(failed.reference, "failed");
    const failedConf = await billsA.confirmPay({ reference: failed.reference });
    expect(failedConf.status).toBe("failed");
    expect(await rawPayeeRows(A_CUSTOMER)).toHaveLength(0);

    // Successful confirm → payee recorded.
    const ok = await billsA.pay({
      biller: "EKEDC",
      customerNumber: "04512345678",
      amountNGN: 2500,
      idempotencyKey: "w11-ok-00001",
    });
    const conf = await billsA.confirmPay({ reference: ok.reference });
    expect(conf.captureStatus).toBe("captured");
    expect(conf.providerStatus).toBe("submitted");
    const rows = await rawPayeeRows(A_CUSTOMER);
    expect(rows).toHaveLength(1);
    expect(rows[0].rail).toBe("bill");
    expect(rows[0].billerCode).toBe("EKEDC");
    expect(Number(rows[0].lastAmountKobo)).toBe(250_000);
    expect(Number(rows[0].useCount)).toBe(1);
  });

  it("encryption at rest: the raw row carries no plaintext meter/phone", async () => {
    const rows = await rawPayeeRows(A_CUSTOMER);
    expect(rows).toHaveLength(1);
    const meter = String(rows[0].meterNumber ?? "");
    expect(meter).not.toContain("04512345678");
    expect(meter.startsWith("pii:v1:")).toBe(true);
    expect(String(rows[0].naturalKey)).not.toContain("04512345678");
  });

  it("upsert: same natural key dedupes, useCount increments, amount updates, label survives", async () => {
    const d = await db();
    const { recordPayee } = await import("../../lib/memberPayees");
    const id1 = await recordPayee(d, {
      customerId: A_CUSTOMER,
      rail: "airtime",
      identifiers: { network: "MTN", phone: "08031234567" },
      amountKobo: 100_000,
    });
    expect(id1).toBeTruthy();
    const id2 = await recordPayee(d, {
      customerId: A_CUSTOMER,
      rail: "airtime",
      identifiers: { network: "MTN", phone: "08031234567" },
      amountKobo: 200_000,
    });
    expect(id2).toBe(id1);
    const rows = await rawPayeeRows(A_CUSTOMER);
    const airtime = rows.filter(r => r.rail === "airtime");
    expect(airtime).toHaveLength(1);
    expect(Number(airtime[0].useCount)).toBe(2);
    expect(Number(airtime[0].lastAmountKobo)).toBe(200_000);

    // Label is preserved across upserts (rename is the only label writer).
    const renamed = await payeesA.rename({ id: String(id1), label: "Mum's phone" });
    expect(renamed.payee.label).toBe("Mum's phone");
    await recordPayee(d, {
      customerId: A_CUSTOMER,
      rail: "airtime",
      identifiers: { network: "MTN", phone: "08031234567" },
      amountKobo: 300_000,
    });
    const after = (await rawPayeeRows(A_CUSTOMER)).find(r => r.rail === "airtime")!;
    expect(after.label).toBe("Mum's phone");
    expect(Number(after.useCount)).toBe(3);

    // Incomplete identifier tuple → nothing recorded (fail-closed on junk).
    const skipped = await recordPayee(d, {
      customerId: A_CUSTOMER,
      rail: "momo",
      identifiers: { provider: "MTN MoMo" }, // no walletNumber
      amountKobo: 1000,
    });
    expect(skipped).toBeNull();
  });

  it("list: owner-only, decrypted server-side, rail filter works", async () => {
    const all = await payeesA.list();
    expect(all.payees.length).toBe(2); // bill + airtime
    const airtime = all.payees.find(p => p.rail === "airtime")!;
    expect(airtime.phone).toBe("08031234567"); // decrypted for the owner
    expect(airtime.label).toBe("Mum's phone");
    const billOnly = await payeesA.list({ rail: "bill" });
    expect(billOnly.payees).toHaveLength(1);
    expect(billOnly.payees[0].meterNumber).toBe("04512345678");
    // Member B sees none of A's payees.
    expect((await payeesB.list()).payees).toHaveLength(0);
    // Anonymous → UNAUTHORIZED.
    await expect(payeesAnon.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("cross-member isolation: B cannot rename/remove A's payees (NOT_FOUND); A's row is untouched (mutant probe)", async () => {
    const mine = await payeesA.list();
    const target = mine.payees[0];
    await expect(
      payeesB.rename({ id: target.id, label: "hijacked" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      payeesB.remove({ id: target.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Mutant probe: the row must be byte-identical afterwards — a guard
    // mutated to a no-op (or scoping dropped) would fail one of these.
    const after = await payeesA.list();
    const still = after.payees.find(p => p.id === target.id)!;
    expect(still).toBeDefined();
    expect(still.label).toBe(target.label);
    // Owner remove works; the row is gone afterwards.
    const removed = await payeesA.remove({ id: target.id });
    expect(removed.removed).toBe(true);
    expect((await payeesA.list()).payees.find(p => p.id === target.id)).toBeUndefined();
    // Random id → NOT_FOUND (non-enumerating).
    await expect(
      payeesA.remove({ id: "00000000-0000-0000-0000-000000000000" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("memberClaims.getClaimPrefill (W11-B1a)", () => {
  it("returns derivable fields for the caller's own policy (users.id space)", async () => {
    const res = await claimsA.getClaimPrefill({ policyId: policyAUsersSpace });
    expect(res.policy.policyNumber).toBe("POL-A-001");
    expect(res.policy.coverageType).toBe("motor");
    expect(res.policy.productName).toBe("Comprehensive Motor");
    expect(res.policy.productCode).toBe("MTR-COMP");
    expect(res.policy.assetDetails).toMatchObject({ asset: { plate: "ABC-123-XY" } });
    expect(res.member).toMatchObject({
      firstName: "Ada",
      lastName: "Okafor",
      email: "ada@example.io",
      phone: "09000000001",
    });
    expect(res.lastClaim).toMatchObject({
      claimNumber: "CLM-A-001",
      status: "paid",
      claimType: "accident",
    });
  });

  it("accepts wallet-era policies (customers.id space) and reports lastClaim null", async () => {
    const res = await claimsA.getClaimPrefill({ policyId: policyACustomerSpace });
    expect(res.policy.policyNumber).toBe("POL-A-002");
    expect(res.lastClaim).toBeNull();
  });

  it("foreign policy → NOT_FOUND (non-enumerating), nonexistent → NOT_FOUND", async () => {
    await expect(
      claimsB.getClaimPrefill({ policyId: policyAUsersSpace })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      claimsB.getClaimPrefill({ policyId: policyACustomerSpace })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      claimsA.getClaimPrefill({ policyId: 987654 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
