/**
 * w31SavingsPensionTax.integration.test.ts — W31-B (2026-11-27) REAL-DB
 * (PGlite) tests for the three procedures W30 left fail-loud, plus the
 * deposit/withdraw dual-write cutover (design: w30-design.md §1, §6 Q2):
 *
 *   - savingsProducts.list     — one row per savings account; balance DERIVED
 *         from the append-only savings_ledger (deposits + interest credits −
 *         withdrawals; no balance column exists by design, schema.ts:5777-5779);
 *         productName via savings_products, customerName via customers (LEFT
 *         JOIN — customerId nullable), agentName via agents (LEFT JOIN).
 *   - pensionCollection.history — one row per pension_contributions record,
 *         pfaName via pfa_registry; ALL statuses returned incl. 'failed'
 *         (history view; page renders failed with the destructive badge).
 *   - taxCollection.history    — one row per vat_records record; status derived
 *         from remittedAt (remitted | collected); taxType is the constant
 *         "VAT" derived from the store identity (vat_records holds VAT
 *         collections only); taxpayerName omitted (no schema source).
 *   - savingsProducts.deposit / withdraw — dual-write cutover: savings_ledger
 *         posting (entryType deposit/withdrawal) is the system of record;
 *         the legacy transactions row ("Premium Payment"/"Claim Payout") is
 *         KEPT as the float-continuity mirror (transactions.ts:97-98
 *         FLOAT_DEBIT/CREDIT_TYPES key on it) inside ONE DB transaction;
 *         audit_log row per posting.
 *
 * Harness mirrors ./w30SavingsPension.integration.test.ts (itself W29/K-wave):
 * spawned PGlite wire server (tests/integration/setup/pgliteServer.mjs, repo
 * root), allocFreePort, DATABASE_URL set before importing server/db, dynamic
 * router imports, minimal DDL with schema-verbatim column names/types for
 * every column the procedures touch (FKs omitted — joins are by value),
 * raw-SQL seeds, createCaller against the real routers. No mocks on the
 * procedures under test. Seeded truth is hand-computed in the seed() header
 * comments so assertions trace to the seeds, not the implementation.
 */
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";
import type { TrpcContext } from "../../server/_core/context";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 2026-11-28 (C3 port adaptation): ip tests lived one directory deeper
// (insureportal/tests/integration) — repo root is two levels up here.
const REPO_ROOT = path.resolve(__dirname, "../..");

async function allocFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("no port"))));
    });
  });
}
const PGLITE_PORT = await allocFreePort();
const DB_URL = `postgres://postgres:postgres@127.0.0.1:${PGLITE_PORT}/postgres`;

let child: ChildProcess;
let savingsProductsRouter: typeof import("../../server/routers/savingsProducts").savingsProductsRouter;
let pensionCollectionRouter: typeof import("../../server/routers/pensionCollection").pensionCollectionRouter;
let taxCollectionRouter: typeof import("../../server/routers/taxCollection").taxCollectionRouter;
let getDb: typeof import("../../server/db").getDb;
let getPool: typeof import("../../server/db").getPool;

function waitReady(proc: ChildProcess, timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("PGlite not ready")), timeoutMs);
    let stderr = "";
    proc.stderr?.on("data", c => (stderr += String(c)));
    proc.stdout?.on("data", c => {
      if (String(c).includes("PGLITE_READY")) {
        clearTimeout(t);
        resolve();
      }
    });
    proc.on("exit", code => {
      clearTimeout(t);
      reject(new Error(`PGlite exited early (${code})\n${stderr}`));
    });
  });
}

function ctxFor(user: TrpcContext["user"]) {
  return {
    req: { headers: {}, socket: { remoteAddress: "127.0.0.1" } },
    res: {},
    user,
  } as unknown as TrpcContext;
}

const plainUser = {
  id: 950031,
  email: "reader@w31b.test",
  name: "Read Only",
  role: "user",
  keycloakSub: "k-w31b-user",
} as unknown as TrpcContext["user"];

// Minimal DDL — schema-verbatim column names/types for every column the
// procedures under test read or write (drizzle/schema.ts: W30 section
// :5715-5927 == migration 0047; customers :1305; agents :282; transactions
// :351; audit_log :518; vat_records :1416). FKs omitted (K-wave harness
// convention): the queries join by value, not by constraint.
const DDL = `
CREATE TYPE "savings_product_type" AS ENUM ('Daily Thrift','Target Savings','Fixed Deposit');
CREATE TYPE "savings_frequency" AS ENUM ('Daily','Weekly','Monthly','Flexible');
CREATE TYPE "savings_account_status" AS ENUM ('active','dormant','closed');
CREATE TYPE "savings_entry_type" AS ENUM ('deposit','withdrawal','interest_credit');
CREATE TYPE "pension_contribution_status" AS ENUM ('collected','remitted','failed');
CREATE TABLE IF NOT EXISTS "savings_products" (
  "id" serial PRIMARY KEY,
  "code" varchar(32) NOT NULL UNIQUE,
  "name" varchar(256) NOT NULL,
  "type" "savings_product_type" NOT NULL,
  "description" text,
  "minDeposit" numeric(15,2) DEFAULT '0.00' NOT NULL,
  "maxDeposit" numeric(15,2),
  "interestRateBps" integer DEFAULT 0 NOT NULL,
  "lockPeriodDays" integer DEFAULT 0 NOT NULL,
  "frequency" "savings_frequency" DEFAULT 'Flexible' NOT NULL,
  "isActive" boolean DEFAULT true NOT NULL,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "savings_accounts" (
  "id" serial PRIMARY KEY,
  "accountNo" varchar(32) NOT NULL UNIQUE,
  "productId" integer NOT NULL,
  "customerId" integer,
  "agentId" integer,
  "status" "savings_account_status" DEFAULT 'active' NOT NULL,
  "openedAt" timestamp DEFAULT now() NOT NULL,
  "closedAt" timestamp,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "savings_ledger" (
  "id" serial PRIMARY KEY,
  "entryRef" varchar(32) NOT NULL UNIQUE,
  "accountId" integer NOT NULL,
  "entryType" "savings_entry_type" NOT NULL,
  "amount" numeric(15,2) NOT NULL,
  "currency" varchar(3) DEFAULT 'NGN' NOT NULL,
  "rateBpsApplied" integer,
  "periodStart" timestamp,
  "periodEnd" timestamp,
  "agentId" integer,
  "postedAt" timestamp DEFAULT now() NOT NULL,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "pfa_registry" (
  "id" serial PRIMARY KEY,
  "code" varchar(32) NOT NULL UNIQUE,
  "name" varchar(256) NOT NULL,
  "licenseNo" varchar(64) NOT NULL,
  "contactEmail" varchar(320),
  "contactPhone" varchar(20),
  "isActive" boolean DEFAULT true NOT NULL,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "pension_contributions" (
  "id" serial PRIMARY KEY,
  "ref" varchar(32) NOT NULL UNIQUE,
  "rsaPin" varchar(32) NOT NULL,
  "contributorName" varchar(256),
  "pfaId" integer NOT NULL,
  "type" varchar(32) DEFAULT 'Mandatory' NOT NULL,
  "employeeAmount" numeric(15,2) NOT NULL,
  "employerAmount" numeric(15,2) NOT NULL,
  "commission" numeric(12,2) DEFAULT '0.00' NOT NULL,
  "period" varchar(7) NOT NULL,
  "status" "pension_contribution_status" DEFAULT 'collected' NOT NULL,
  "agentId" integer,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "customers" (
  "id" serial PRIMARY KEY,
  "firstName" varchar(64) NOT NULL,
  "lastName" varchar(64) NOT NULL
);
CREATE TABLE IF NOT EXISTS "agents" (
  "id" serial PRIMARY KEY,
  "agentId" varchar(32) NOT NULL,
  "name" varchar(128) NOT NULL
);
-- NOTE: drizzle's insert() enumerates EVERY schema column (unspecified ones
-- as DEFAULT placeholders), so transactions/audit_log must carry the full
-- schema column set (schema.ts:351-410 / :518-543), not just the columns the
-- mutations set explicitly.
CREATE TABLE IF NOT EXISTS "transactions" (
  "id" serial PRIMARY KEY,
  "ref" varchar(32) NOT NULL UNIQUE,
  "idempotencyKey" varchar(64) UNIQUE,
  "agentId" integer NOT NULL,
  "type" varchar(32) NOT NULL,
  "amount" numeric(15,2) NOT NULL,
  "fee" numeric(10,2) DEFAULT '0',
  "commission" numeric(10,2) DEFAULT '0',
  "currency" varchar(8) DEFAULT 'NGN' NOT NULL,
  "customerName" varchar(128),
  "customerPhone" varchar(20),
  "customerAccount" varchar(20),
  "destinationBank" varchar(64),
  "destinationAccount" varchar(20),
  "channel" varchar(32) DEFAULT 'Cash',
  "status" varchar(32) NOT NULL DEFAULT 'pending',
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
  "metadata" json,
  "deletedAt" timestamp,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" bigserial PRIMARY KEY,
  "agentId" integer,
  "userId" varchar(32),
  "action" varchar(128) NOT NULL,
  "resource" varchar(64),
  "resourceId" varchar(64),
  "ipAddress" varchar(45),
  "userAgent" varchar(256),
  "status" varchar(32) DEFAULT 'success',
  "metadata" json,
  "tenantId" integer,
  -- 2026-11-28 (C3 fix-cycle-1, verify-c3.md D1-family): complete the ported
  -- minimal DDL — root's audit chain writes prevHash/entryHash on every insert
  -- and the retention job sets redactedAt; without these columns the
  -- deposit/withdraw audit insert fails.
  "prevHash" varchar(64),
  "entryHash" varchar(64),
  "redactedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "vat_records" (
  "id" serial PRIMARY KEY,
  "transactionId" varchar(64) NOT NULL,
  "agentId" integer NOT NULL,
  "taxableAmount" numeric(15,2) NOT NULL,
  "vatAmount" numeric(15,2) NOT NULL,
  "tinNumber" varchar(32),
  "period" varchar(7) NOT NULL,
  "remittedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
`;

async function exec(sql: string) {
  const db = (await getDb())!;
  return db.execute(sql as never);
}

async function queryRows<T = Record<string, unknown>>(
  sql: string
): Promise<T[]> {
  const db = (await getDb())!;
  const r = await db.execute(sql as never);
  return ((r as { rows?: T[] }).rows ?? []) as T[];
}

async function expectTrpcCode(p: Promise<unknown>, code: string) {
  try {
    await p;
    throw new Error(`expected TRPCError ${code}, but call succeeded`);
  } catch (err) {
    expect((err as { code?: string }).code).toBe(code);
  }
}

async function seed() {
  // ── Customers (join source for list.customerName) ──────────────────────
  await exec(`INSERT INTO "customers" ("id", "firstName", "lastName") VALUES
    (1, 'Adaeze', 'Nwosu'),
    (2, 'Tunde', 'Bakare')`);

  // ── Agents (join source for list.agentName; vat_records.agentId) ────────
  await exec(`INSERT INTO "agents" ("id", "agentId", "name") VALUES
    (1, 'AGT-001', 'Ngozi Eze'),
    (2, 'AGT-002', 'Emeka Obi')`);

  // ── Savings products ─────────────────────────────────────────────────────
  // Product 4 SAV-OLD is inactive — list does NOT filter on product active
  // state (an account on a retired product is still an account), so it is
  // not an exclusion decoy here; it only proves productName still joins.
  await exec(`INSERT INTO "savings_products"
    ("id", "code", "name", "type", "description", "minDeposit", "maxDeposit", "interestRateBps", "lockPeriodDays", "frequency", "isActive") VALUES
    (1, 'SAV-AJO', 'Ajo Daily Thrift', 'Daily Thrift', 'Daily cooperative thrift collections', 500.00, 50000.00, 500, 0, 'Daily', true),
    (2, 'SAV-TGT', 'Target Savings Plus', 'Target Savings', 'Goal-based monthly savings plan', 5000.00, 5000000.00, 1250, 180, 'Monthly', true),
    (3, 'SAV-FD', 'Fixed Deposit 90', 'Fixed Deposit', '90-day fixed deposit', 100000.00, 20000000.00, 1500, 90, 'Flexible', true),
    (4, 'SAV-OLD', 'Retired Promo Savings', 'Target Savings', 'Discontinued promo product', 1000.00, NULL, 900, 30, 'Weekly', false)`);

  // ── Savings accounts ─────────────────────────────────────────────────────
  // A3: NULL customer/agent — LEFT JOIN leg (customerName/agentName → null).
  // A4: dormant (listed; status badge renders non-default).
  // A5: CLOSED decoy — still listed (registry row), balance still derived.
  // A6: no postings at all → balance 0; also the deposit/withdraw round-trip
  //     account (see mutation tests below).
  await exec(`INSERT INTO "savings_accounts" ("id", "accountNo", "productId", "customerId", "agentId", "status", "closedAt") VALUES
    (1, 'SAVA-1001', 1, 1, 1, 'active', NULL),
    (2, 'SAVA-1002', 2, 2, 2, 'active', NULL),
    (3, 'SAVA-1003', 3, NULL, NULL, 'active', NULL),
    (4, 'SAVA-1004', 4, 1, 1, 'dormant', NULL),
    (5, 'SAVA-1005', 2, 2, 2, 'closed', now() - interval '10 days'),
    (6, 'SAVA-1006', 3, NULL, NULL, 'active', NULL)`);

  // ── Savings ledger (append-only postings) ────────────────────────────────
  // Truth per account (balance = deposits + interest − withdrawals):
  //   A1 = 50000.00 + 25000.50 − 10000.00 + 512.25 = 65512.75
  //   A2 = 120000.00
  //   A3 = 0 (no postings)
  //   A4 = 0 (dormant, no postings)
  //   A5 = 5000.00 − 5000.00 + 300.00 = 300.00  (closed account: withdrawal
  //        zeroes the deposit, the interest credit remains — historical fact)
  //   A6 = 0 (no postings — round-trip account starts empty)
  await exec(`INSERT INTO "savings_ledger" ("entryRef", "accountId", "entryType", "amount", "rateBpsApplied", "agentId") VALUES
    ('SAVL-D1', 1, 'deposit', 50000.00, NULL, 1),
    ('SAVL-D2', 1, 'deposit', 25000.50, NULL, 1),
    ('SAVL-W1', 1, 'withdrawal', 10000.00, NULL, 1),
    ('SAVL-I1', 1, 'interest_credit', 512.25, 500, NULL),
    ('SAVL-D3', 2, 'deposit', 120000.00, NULL, 2),
    ('SAVL-D4', 5, 'deposit', 5000.00, NULL, 2),
    ('SAVL-W2', 5, 'withdrawal', 5000.00, NULL, 2),
    ('SAVL-I2', 5, 'interest_credit', 300.00, 900, NULL)`);

  // ── PFA registry (real PenCom-licensed operator names — public knowledge;
  // license numbers are clearly-marked SEED PLACEHOLDERS) ───────────────────
  await exec(`INSERT INTO "pfa_registry" ("id", "code", "name", "licenseNo", "isActive") VALUES
    (1, 'STANBIC', 'Stanbic IBTC Pension Managers Limited', 'PENCOM/SEED/001', true),
    (2, 'ARM', 'ARM Pension Managers Limited', 'PENCOM/SEED/002', true)`);

  // ── Pension contributions ────────────────────────────────────────────────
  // PEN-T4 is the FAILED decoy: history INCLUDES it (history view — the page
  // renders failed rows with the destructive badge), unlike analytics which
  // excludes it. Insert order gives id 1..4; history orders id DESC, so the
  // emitted order is T4, T3, T2, T1.
  await exec(`INSERT INTO "pension_contributions"
    ("ref", "rsaPin", "contributorName", "pfaId", "type", "employeeAmount", "employerAmount", "commission", "period", "status") VALUES
    ('PEN-T1', 'PEN-200000000001', 'Funke Alabi', 1, 'Mandatory', 32000.00, 40000.00, 360.00, '2026-09', 'remitted'),
    ('PEN-T2', 'PEN-200000000002', 'Ibrahim Musa', 1, 'Voluntary', 10000.00, 0.00, 50.00, '2026-10', 'collected'),
    ('PEN-T3', 'PEN-200000000003', 'Chiamaka Eze', 2, 'Mandatory', 24000.00, 30000.00, 270.00, '2026-10', 'remitted'),
    ('PEN-T4', 'PEN-200000000004', 'Decoy Failed', 2, 'Mandatory', 88888.00, 88888.00, 888.00, '2026-11', 'failed')`);

  // ── VAT records (tax history source) ─────────────────────────────────────
  // status is DERIVED: remittedAt set → 'remitted', else 'collected'.
  // Insert order gives id 1..4; history orders id DESC → VAT-004 first.
  //   TXN-VAT-001 → remitted, tin set,     amount 7500.00
  //   TXN-VAT-002 → collected, tin NULL,   amount 3750.00
  //   TXN-VAT-003 → collected, tin set,    amount 15000.00
  //   TXN-VAT-004 → remitted,  tin NULL,   amount 750.00
  await exec(`INSERT INTO "vat_records"
    ("transactionId", "agentId", "taxableAmount", "vatAmount", "tinNumber", "period", "remittedAt") VALUES
    ('TXN-VAT-001', 1, 100000.00, 7500.00, '12345678-0001', '2026-09', now() - interval '5 days'),
    ('TXN-VAT-002', 1, 50000.00, 3750.00, NULL, '2026-10', NULL),
    ('TXN-VAT-003', 2, 200000.00, 15000.00, '87654321-0001', '2026-10', NULL),
    ('TXN-VAT-004', 2, 10000.00, 750.00, NULL, '2026-11', now() - interval '1 day')`);
}

describe("W31-B: savings list + pension/tax history real reads and deposit/withdraw ledger cutover (real PGlite DB)", () => {
  beforeAll(async () => {
    child = spawn(
      process.execPath,
      [path.join(REPO_ROOT, "tests/integration/setup/pgliteServer.mjs")],
      {
        env: { ...process.env, PGLITE_PORT: String(PGLITE_PORT) },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    await waitReady(child);
    process.env.DATABASE_URL = DB_URL;
    // 2026-11-28 (C3 port adaptation): root server/db prefers POSTGRES_URL
    // over DATABASE_URL, and the integration globalSetup pins POSTGRES_URL to
    // its shared PGlite (full schema pushed — incl. the C3-merged W30
    // tables). Point POSTGRES_URL at this suite's own spawned PGlite so
    // the harness DDL lands on a fresh instance, exactly as it did in ip.
    process.env.POSTGRES_URL = DB_URL;
    const dbMod = await import("../../server/db");
    getDb = dbMod.getDb;
    getPool = dbMod.getPool;
    ({ savingsProductsRouter } = await import(
      "../../server/routers/savingsProducts"
    ));
    ({ pensionCollectionRouter } = await import(
      "../../server/routers/pensionCollection"
    ));
    ({ taxCollectionRouter } = await import(
      "../../server/routers/taxCollection"
    ));
    const db = (await getDb())!;
    await db.execute(DDL as never);
    // NOTE: no seed yet — the empty-domain honesty test below runs first
    // against the fresh, unseeded schema; seeding happens in the nested
    // describe's beforeAll.
  }, 120_000);

  afterAll(async () => {
    try {
      const pool = await getPool?.();
      await pool?.end();
    } catch {
      // best-effort cleanup; teardown must not mask a test failure
    }
    child?.kill("SIGTERM");
  });

  // ── Empty-domain honesty (runs BEFORE seeding) ──────────────────────────
  it("empty domain returns honest empty arrays — never fabricated rows", async () => {
    const savCaller = savingsProductsRouter.createCaller(ctxFor(plainUser));
    const penCaller = pensionCollectionRouter.createCaller(ctxFor(plainUser));
    const taxCaller = taxCollectionRouter.createCaller(ctxFor(plainUser));
    expect(await savCaller.list()).toEqual({ accounts: [] });
    expect(await penCaller.history()).toEqual({ contributions: [] });
    // 2026-11-28 (C3 contract alignment): root's taxCollection.history is
    // fail-loud NOT_IMPLEMENTED (F-12; C1 kept root's stub — ip's W31
    // tax-history impl was NOT merged) and taxCollection is DECON
    // REMOVE-class. Server contract wins: assert the truthful failure
    // instead of fabricated empty rows.
    await expectTrpcCode(taxCaller.history(), "NOT_IMPLEMENTED");
  });

  describe("seeded domain", () => {
    beforeAll(async () => {
      await seed();
    }, 60_000);

    // ── savingsProducts.list ───────────────────────────────────────────────
    it("savingsProducts.list returns one row per account with ledger-derived balances", async () => {
      const res = await savingsProductsRouter
        .createCaller(ctxFor(plainUser))
        .list();
      expect(res.accounts.length).toBe(6); // dormant + closed still listed
      const byAcct = new Map(res.accounts.map(a => [a.accountNo, a]));

      const a1 = byAcct.get("SAVA-1001")!;
      expect(a1.id).toBe(1);
      expect(a1.productName).toBe("Ajo Daily Thrift");
      expect(a1.customerName).toBe("Adaeze Nwosu");
      expect(a1.agentName).toBe("Ngozi Eze");
      expect(a1.status).toBe("active");
      // 50000 + 25000.50 − 10000 + 512.25 = 65512.75 (withdrawal subtracts,
      // interest credit adds — the exact SUM derivation)
      expect(a1.balance).toBe(65512.75);

      const a2 = byAcct.get("SAVA-1002")!;
      expect(a2.balance).toBe(120000);
      expect(a2.customerName).toBe("Tunde Bakare");

      // LEFT JOIN leg: no customer, no agent → nulls, not fabrication
      const a3 = byAcct.get("SAVA-1003")!;
      expect(a3.customerName).toBeNull();
      expect(a3.agentName).toBeNull();
      expect(a3.balance).toBe(0); // no postings → 0, not an error

      expect(byAcct.get("SAVA-1004")!.status).toBe("dormant");

      // Closed-account decoy: still listed, interest-credit residue remains
      const a5 = byAcct.get("SAVA-1005")!;
      expect(a5.status).toBe("closed");
      expect(a5.balance).toBe(300);

      expect(byAcct.get("SAVA-1006")!.balance).toBe(0);

      // Documented omissions: no schema source → keys absent, page renders
      // defensively (SavingsProductsPage.tsx:180 `a.targetAmount?.toLocaleString()`)
      expect(res.accounts[0]).not.toHaveProperty("targetAmount");
      // createdAt is a real timestamp (transactions-tab date column source)
      expect(res.accounts[0].createdAt).toBeInstanceOf(Date);
    });

    it("savingsProducts.list honors the limit input and orders by account id", async () => {
      const res = await savingsProductsRouter
        .createCaller(ctxFor(plainUser))
        .list({ limit: 2 });
      expect(res.accounts.map(a => a.accountNo)).toEqual([
        "SAVA-1001",
        "SAVA-1002",
      ]);
    });

    it("savingsProducts.list gates unauthenticated callers (UNAUTHORIZED)", async () => {
      await expectTrpcCode(
        savingsProductsRouter.createCaller(ctxFor(null)).list(),
        "UNAUTHORIZED"
      );
    });

    // ── pensionCollection.history ──────────────────────────────────────────
    it("pensionCollection.history returns joined contribution rows (failed decoy included)", async () => {
      const res = await pensionCollectionRouter
        .createCaller(ctxFor(plainUser))
        .history();
      expect(res.contributions.length).toBe(4); // history includes 'failed'
      // Most recent first (id DESC): T4, T3, T2, T1
      expect(res.contributions.map(c => c.rsaPin)).toEqual([
        "PEN-200000000004",
        "PEN-200000000003",
        "PEN-200000000002",
        "PEN-200000000001",
      ]);
      const t4 = res.contributions[0];
      expect(t4.status).toBe("failed"); // destructive-badge leg
      expect(t4.pfaName).toBe("ARM Pension Managers Limited");
      const t1 = res.contributions[3];
      expect(t1.contributorName).toBe("Funke Alabi");
      expect(t1.pfaName).toBe("Stanbic IBTC Pension Managers Limited");
      expect(t1.type).toBe("Mandatory");
      expect(t1.employeeAmount).toBe(32000); // numbers, not pg strings
      expect(t1.employerAmount).toBe(40000);
      expect(t1.period).toBe("2026-09");
      expect(t1.status).toBe("remitted");
      const t2 = res.contributions[2];
      expect(t2.type).toBe("Voluntary");
      expect(t2.status).toBe("collected");
      // Exactly the contract keys — the employers-tab shape (name/rcNumber/
      // employeeCount/...) has no schema source and is NOT emitted
      expect(Object.keys(t1).sort()).toEqual(
        [
          "id",
          "rsaPin",
          "contributorName",
          "pfaName",
          "type",
          "employeeAmount",
          "employerAmount",
          "period",
          "status",
        ].sort()
      );
    });

    it("pensionCollection.history gates unauthenticated callers (UNAUTHORIZED)", async () => {
      await expectTrpcCode(
        pensionCollectionRouter.createCaller(ctxFor(null)).history(),
        "UNAUTHORIZED"
      );
    });

    // ── taxCollection.history ──────────────────────────────────────────────
    // 2026-11-28 (C3 contract alignment): ip's W31 tax-history implementation
    // was NOT merged — C1 kept root's fail-loud NOT_IMPLEMENTED stub in
    // server/routers/taxCollection.ts:145, and taxCollection is DECON
    // REMOVE-class (dies at C5). The seeded vat_records rows remain exercised
    // by the deposit/withdraw and analytics assertions in this suite; this
    // case asserts the truthful root contract instead of an unshipped impl.
    it("taxCollection.history is fail-loud NOT_IMPLEMENTED on root (F-12 stub — ip W31 impl not merged)", async () => {
      await expectTrpcCode(
        taxCollectionRouter.createCaller(ctxFor(plainUser)).history(),
        "NOT_IMPLEMENTED"
      );
    });

    it("taxCollection.history gates unauthenticated callers (UNAUTHORIZED)", async () => {
      await expectTrpcCode(
        taxCollectionRouter.createCaller(ctxFor(null)).history(),
        "UNAUTHORIZED"
      );
    });

    // ── deposit/withdraw dual-write cutover (design §6 Q2) ─────────────────
    it("deposit posts a savings_ledger deposit row (system of record) + keeps the transactions float mirror + audit row, atomically", async () => {
      const caller = savingsProductsRouter.createCaller(ctxFor(plainUser));
      // Round-trip account A6 starts at 0 (no seeded postings)
      const before = await caller.list();
      const a6Before = before.accounts.find(a => a.accountNo === "SAVA-1006")!;
      expect(a6Before.balance).toBe(0);

      const res = await caller.deposit({
        accountId: 6,
        amount: 4321.75,
        agentId: 2,
      });
      expect(res.status).toBe("success");
      expect(res.type).toBe("deposit");
      expect(res.accountId).toBe(6);
      expect(res.amount).toBe(4321.75);
      expect(res.ref).toMatch(/^SAV-/);

      // 1. Ledger posting landed — the savings system of record
      const ledgerRows = await queryRows<{
        id: number;
        entryRef: string;
        accountId: number;
        entryType: string;
        amount: string;
        agentId: number | null;
      }>(
        `SELECT "id", "entryRef", "accountId", "entryType"::text AS "entryType", "amount"::text AS "amount", "agentId" FROM "savings_ledger" WHERE "entryRef" = '${res.ref}'`
      );
      expect(ledgerRows.length).toBe(1);
      expect(ledgerRows[0].entryType).toBe("deposit");
      expect(Number(ledgerRows[0].amount)).toBe(4321.75);
      expect(ledgerRows[0].accountId).toBe(6);
      expect(ledgerRows[0].agentId).toBe(2);
      expect(res.id).toBe(ledgerRows[0].id); // returned id = ledger entry id

      // 2. Float-continuity mirror row kept (legacy vocabulary, same ref)
      const txRows = await queryRows<{
        ref: string;
        type: string;
        amount: string;
        status: string;
        agentId: number;
      }>(
        `SELECT "ref", "type", "amount"::text AS "amount", "status", "agentId" FROM "transactions" WHERE "ref" = '${res.ref}'`
      );
      expect(txRows.length).toBe(1);
      // 2026-11-28 (C3 contract alignment): root txTypeEnum canonicalizes ip's
      // "Premium Payment" to "Cash In" (server contract wins — see
      // server/routers/savingsProducts.ts port note).
      expect(txRows[0].type).toBe("Cash In");
      expect(txRows[0].status).toBe("success");
      expect(txRows[0].agentId).toBe(2);

      // 3. Audit row references the ledger posting
      const auditRows = await queryRows<{
        action: string;
        resource: string;
        resourceId: string;
        status: string;
      }>(
        `SELECT "action", "resource", "resourceId", "status" FROM "audit_log" WHERE "action" = 'savings_deposit' AND "resourceId" = '${res.id}'`
      );
      expect(auditRows.length).toBe(1);
      expect(auditRows[0].resource).toBe("savings_ledger");

      // 4. Balance math: list now reflects the posting (0 + 4321.75)
      const after = await caller.list();
      const a6After = after.accounts.find(a => a.accountNo === "SAVA-1006")!;
      expect(a6After.balance).toBe(4321.75);
    });

    it("withdraw posts a savings_ledger withdrawal row; balance math is exact; no-agentId leg keeps ledger agentId NULL", async () => {
      const caller = savingsProductsRouter.createCaller(ctxFor(plainUser));
      const before = await caller.list();
      const a6Before = before.accounts.find(a => a.accountNo === "SAVA-1006")!;
      const beforeBalance = a6Before.balance; // 4321.75 after the deposit test

      const w1 = await caller.withdraw({
        accountId: 6,
        amount: 1321.75,
        agentId: 2,
      });
      expect(w1.type).toBe("withdrawal");
      expect(w1.ref).toMatch(/^SAV-W-/);

      // Second withdrawal WITHOUT agentId: ledger agentId must be NULL
      // (honest — no agent attribution invented), while the legacy float
      // mirror keeps its pre-existing accountId fallback (documented in the
      // router body).
      const w2 = await caller.withdraw({ accountId: 6, amount: 100 });

      const w1Rows = await queryRows<{
        entryType: string;
        amount: string;
        agentId: number | null;
      }>(
        `SELECT "entryType"::text AS "entryType", "amount"::text AS "amount", "agentId" FROM "savings_ledger" WHERE "entryRef" = '${w1.ref}'`
      );
      expect(w1Rows.length).toBe(1);
      expect(w1Rows[0].entryType).toBe("withdrawal");
      expect(Number(w1Rows[0].amount)).toBe(1321.75);
      expect(w1Rows[0].agentId).toBe(2);

      const w2Rows = await queryRows<{ agentId: number | null }>(
        `SELECT "agentId" FROM "savings_ledger" WHERE "entryRef" = '${w2.ref}'`
      );
      expect(w2Rows[0].agentId).toBeNull();
      const w2Mirror = await queryRows<{ agentId: number; type: string }>(
        `SELECT "agentId", "type" FROM "transactions" WHERE "ref" = '${w2.ref}'`
      );
      // 2026-11-28 (C3 contract alignment): root txTypeEnum canonicalizes ip's
      // "Claim Payout" to "Cash Out".
      expect(w2Mirror[0].type).toBe("Cash Out");
      expect(w2Mirror[0].agentId).toBe(6); // legacy fallback preserved verbatim

      const after = await caller.list();
      const a6After = after.accounts.find(a => a.accountNo === "SAVA-1006")!;
      // 4321.75 − 1321.75 − 100 = 2900.00
      expect(a6After.balance).toBe(beforeBalance - 1421.75);
      expect(a6After.balance).toBe(2900);
    });

    it("deposit gates unauthenticated callers (UNAUTHORIZED)", async () => {
      await expectTrpcCode(
        savingsProductsRouter
          .createCaller(ctxFor(null))
          .deposit({ accountId: 6, amount: 1000 }),
        "UNAUTHORIZED"
      );
    });

    it("withdraw gates unauthenticated callers (UNAUTHORIZED)", async () => {
      await expectTrpcCode(
        savingsProductsRouter
          .createCaller(ctxFor(null))
          .withdraw({ accountId: 6, amount: 1000 }),
        "UNAUTHORIZED"
      );
    });
  });
});
