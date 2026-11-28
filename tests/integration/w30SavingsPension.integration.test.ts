/**
 * w30SavingsPension.integration.test.ts — W30 (2026-11-27) REAL-DB (PGlite)
 * tests for the newly-implemented savings & pension domain procedures
 * (design: w30-design.md §4):
 *
 *   - savingsProducts.products / savingsProducts.analytics
 *       Sources: savings_products (catalog), savings_accounts (registry),
 *       savings_ledger (append-only postings — deposits/withdrawals/interest
 *       credits; W30 schema + migration 0047).
 *   - pensionCollection.pfas / pensionCollection.analytics
 *       Sources: pfa_registry (PenCom-licensed PFAs — real operator names,
 *       PUBLIC knowledge; license numbers below are clearly-marked SEED
 *       PLACEHOLDERS "PENCOM/SEED/00x", not the operators' real license
 *       numbers) + pension_contributions (per-row employee/employer amounts
 *       and per-row platform collection commission).
 *
 * Harness mirrors ./w29Analytics.integration.test.ts (W29, itself mirroring
 * the K-wave harness): spawned PGlite wire server
 * (tests/integration/setup/pgliteServer.mjs, repo root), allocFreePort,
 * DATABASE_URL set before importing server/db, dynamic router imports,
 * minimal DDL with schema-verbatim column names/types for every column the
 * procedures touch (FKs omitted — joins are by value), raw-SQL seeds,
 * createCaller against the real routers. No mocks on the procedures under
 * test.
 *
 * Seeded truth is computed in the header comments of seed() so the
 * assertions trace to the seeds, not to the implementation.
 *
 * KNOWN DESIGN-DOC CORRECTION (W30 coder, 2026-11-27): w30-design.md §4.2's
 * truth line and §4.3 test #5 both state ARM contributorCount = 0, but the
 * doc's own seed table gives ARM one non-failed contribution (PEN-R4, rsaPin
 * PEN-100000000003, collected) — per the normative §3.3 rule (COUNT DISTINCT
 * rsaPin WHERE status <> 'failed') ARM's contributorCount is 1. The seed is
 * kept verbatim (its analytics truth — totalVolume 234000, 4 contributions,
 * 1170 commission — is self-consistent and includes PEN-R4); the assertion
 * below uses the correctly derived ARM = 1.
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
  id: 950030,
  email: "reader@w30.test",
  name: "Read Only",
  role: "user",
  keycloakSub: "k-w30-user",
} as unknown as TrpcContext["user"];

// Minimal DDL — schema-verbatim column names/types for every column the
// procedures under test read (drizzle/schema.ts W30 section == migration
// 0047_savings_pension_domain.sql). FKs omitted (documented in the K-wave
// harness): the queries join by value, not by constraint.
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
-- 2026-11-27 (W31-B): the retired scope guards below now exercise the REAL
-- savingsProducts.list, which joins customers/agents for customerName/
-- agentName — these two minimal tables (join-by-value, FKs omitted per the
-- harness convention) exist solely so that positive contract assertion can
-- run. Additive only; no W30 assertion depends on them.
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
`;

async function exec(sql: string) {
  const db = (await getDb())!;
  return db.execute(sql as never);
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
  // ── Savings products (plausible Nigerian thrift/MFB market rates) ──────
  // 4 = SAV-OLD is the DECOY (isActive false — must be excluded from the
  // products catalog). Rates stored as basis points: 500 = 5.0% p.a.,
  // 1250 = 12.5%, 1500 = 15.0%, 900 = 9.0%.
  await exec(`INSERT INTO "savings_products"
    ("id", "code", "name", "type", "description", "minDeposit", "maxDeposit", "interestRateBps", "lockPeriodDays", "frequency", "isActive") VALUES
    (1, 'SAV-AJO', 'Ajo Daily Thrift', 'Daily Thrift', 'Daily cooperative thrift (ajo/esusu) collections', 500.00, 50000.00, 500, 0, 'Daily', true),
    (2, 'SAV-TGT', 'Target Savings', 'Target Savings', 'Goal-based monthly savings plan', 5000.00, 5000000.00, 1250, 180, 'Monthly', true),
    (3, 'SAV-FD', 'Fixed Deposit 90', 'Fixed Deposit', '90-day fixed deposit', 100000.00, 20000000.00, 1500, 90, 'Flexible', true),
    (4, 'SAV-OLD', 'Retired Promo Savings', 'Target Savings', 'Discontinued promo product', 1000.00, NULL, 900, 30, 'Weekly', false)`);
  // → products (ordered by name asc): Ajo Daily Thrift(1), Fixed Deposit
  //   90(3), Target Savings(2) — 3 rows, SAV-OLD excluded.
  //   Row 2 emitted as: interestRate 1250/100 = 12.5, minDeposit 5000,
  //   lockPeriod "180 days", type "Target Savings", frequency "Monthly".
  //   Row 1 lockPeriodDays 0 → lockPeriod "None", interestRate 5.

  // ── Savings accounts ───────────────────────────────────────────────────
  // A1/A2/A3 active (products 1/2/3); A4 CLOSED ← decoy for activeAccounts.
  await exec(`INSERT INTO "savings_accounts" ("id", "accountNo", "productId", "status", "closedAt") VALUES
    (1, 'SAVA-0001', 1, 'active', NULL),
    (2, 'SAVA-0002', 2, 'active', NULL),
    (3, 'SAVA-0003', 3, 'active', NULL),
    (4, 'SAVA-0004', 1, 'closed', now() - interval '10 days')`);
  // → activeAccounts = 3

  // ── Savings ledger (append-only postings) ──────────────────────────────
  // SAVL-W1 is the withdrawal DECOY (never enters totalDeposits).
  // SAVL-I3 posts interest against the CLOSED account A4 — it still counts
  // toward totalInterestPaid (a historical fact: the money was paid).
  await exec(`INSERT INTO "savings_ledger" ("entryRef", "accountId", "entryType", "amount", "rateBpsApplied") VALUES
    ('SAVL-D1', 1, 'deposit', 250000.00, NULL),
    ('SAVL-D2', 2, 'deposit', 100000.00, NULL),
    ('SAVL-D3', 3, 'deposit', 75000.00, NULL),
    ('SAVL-W1', 1, 'withdrawal', 40000.00, NULL),
    ('SAVL-I1', 1, 'interest_credit', 3125.50, 500),
    ('SAVL-I2', 2, 'interest_credit', 1200.00, 1250),
    ('SAVL-I3', 4, 'interest_credit', 900.00, 900)`);
  // → totalDeposits = 250000 + 100000 + 75000 = 425000
  // → totalInterestPaid = 3125.50 + 1200.00 + 900.00 = 5225.50

  // ── PFA registry (real PenCom-licensed operator names — public knowledge;
  // license numbers are clearly-marked SEED PLACEHOLDERS, not the operators'
  // real license numbers) ─────────────────────────────────────────────────
  // 4 = TRUSTFUND is the DECOY (inactive registry entry — still listed, with
  // active=false badge).
  await exec(`INSERT INTO "pfa_registry" ("id", "code", "name", "licenseNo", "isActive") VALUES
    (1, 'STANBIC', 'Stanbic IBTC Pension Managers Limited', 'PENCOM/SEED/001', true),
    (2, 'ARM', 'ARM Pension Managers Limited', 'PENCOM/SEED/002', true),
    (3, 'FGPL', 'First Guarantee Pension Limited', 'PENCOM/SEED/003', true),
    (4, 'TRUSTFUND', 'Trustfund Pensions Limited', 'PENCOM/SEED/004', false)`);
  // → pfas (ordered by name asc): ARM(2), First Guarantee(3), Stanbic(1),
  //   Trustfund(4) — 4 rows including the inactive decoy.

  // ── Pension contributions (PenCom mandatory 18% split: 8% employee /
  // 10% employer; commission = platform collection fee per row) ───────────
  // PEN-R3 repeats PEN-R2's rsaPin (same contributor, second month) —
  // distinct-count leg. PEN-R5 is the FAILED DECOY: excluded from every
  // aggregate and from contributorCount.
  await exec(`INSERT INTO "pension_contributions"
    ("ref", "rsaPin", "contributorName", "pfaId", "type", "employeeAmount", "employerAmount", "commission", "period", "status") VALUES
    ('PEN-R1', 'PEN-100000000001', 'Adaeze Nwosu', 1, 'Mandatory', 40000.00, 50000.00, 450.00, '2026-10', 'remitted'),
    ('PEN-R2', 'PEN-100000000002', 'Babatunde Adeyemi', 1, 'Mandatory', 24000.00, 30000.00, 270.00, '2026-10', 'collected'),
    ('PEN-R3', 'PEN-100000000002', 'Babatunde Adeyemi', 1, 'Mandatory', 24000.00, 30000.00, 270.00, '2026-11', 'remitted'),
    ('PEN-R4', 'PEN-100000000003', 'Chidinma Okafor', 2, 'Mandatory', 16000.00, 20000.00, 180.00, '2026-11', 'collected'),
    ('PEN-R5', 'PEN-100000000009', 'Decoy Failure', 3, 'Mandatory', 999999.00, 999999.00, 9999.00, '2026-11', 'failed')`);
  // → analytics (status <> 'failed', i.e. R1..R4):
  //     totalVolume = (40000+50000) + (24000+30000) + (24000+30000)
  //                 + (16000+20000) = 234000
  //     totalContributions = 4
  //     totalCommission = 450 + 270 + 270 + 180 = 1170
  // → contributorCount (distinct rsaPin, failed excluded):
  //     STANBIC 2 (PEN-…001, PEN-…002), ARM 1 (PEN-…003), FGPL 0, TRUSTFUND 0
  //     [design-doc truth line said "ARM 0" — hand-arithmetic slip, see file
  //      header; §3.3's normative rule yields 1 for the doc's own seed]
}

describe("W30: savings & pension domain real implementations (real PGlite DB)", () => {
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
  it("empty domain returns honest zeros/empty arrays — never fabricated numbers", async () => {
    const savCaller = savingsProductsRouter.createCaller(ctxFor(plainUser));
    const penCaller = pensionCollectionRouter.createCaller(ctxFor(plainUser));
    const products = await savCaller.products();
    expect(products.products).toEqual([]);
    const savAnalytics = await savCaller.analytics();
    expect(savAnalytics).toEqual({
      totalDeposits: 0,
      activeAccounts: 0,
      totalInterestPaid: 0,
    });
    const pfas = await penCaller.pfas();
    expect(pfas.pfas).toEqual([]);
    const penAnalytics = await penCaller.analytics();
    expect(penAnalytics).toEqual({
      totalVolume: 0,
      totalContributions: 0,
      totalCommission: 0,
    });
  });

  describe("seeded domain", () => {
    beforeAll(async () => {
      await seed();
    }, 60_000);

    // ── savingsProducts.products ───────────────────────────────────────────
    it("savingsProducts.products returns the active catalog (decoy excluded)", async () => {
      const res = await savingsProductsRouter
        .createCaller(ctxFor(plainUser))
        .products();
      expect(res.products.length).toBe(3); // SAV-OLD (inactive) excluded
      // Ordered by name asc: Ajo Daily Thrift, Fixed Deposit 90, Target Savings
      const byId = new Map(res.products.map(p => [p.id, p]));
      const p2 = byId.get(2)!;
      expect(p2.name).toBe("Target Savings");
      expect(p2.type).toBe("Target Savings"); // display-cased enum, raw
      expect(p2.minDeposit).toBe(5000);
      expect(p2.interestRate).toBe(12.5); // 1250 bps → percent p.a.
      expect(p2.lockPeriod).toBe("180 days");
      expect(p2.frequency).toBe("Monthly");
      expect(typeof p2.description).toBe("string");
      const p1 = byId.get(1)!;
      expect(p1.lockPeriod).toBe("None"); // lockPeriodDays 0 → "None"
      expect(p1.interestRate).toBe(5);
      const p3 = byId.get(3)!;
      expect(p3.type).toBe("Fixed Deposit");
      expect(p3.lockPeriod).toBe("90 days");
    });

    it("savingsProducts.products gates unauthenticated callers (UNAUTHORIZED)", async () => {
      await expectTrpcCode(
        savingsProductsRouter.createCaller(ctxFor(null)).products(),
        "UNAUTHORIZED"
      );
    });

    // ── savingsProducts.analytics ──────────────────────────────────────────
    it("savingsProducts.analytics aggregates the ledger + account registry", async () => {
      const res = await savingsProductsRouter
        .createCaller(ctxFor(plainUser))
        .analytics();
      expect(res.totalDeposits).toBe(425000); // withdrawal decoy excluded
      expect(res.activeAccounts).toBe(3); // closed-account decoy excluded
      expect(res.totalInterestPaid).toBe(5225.5); // incl. closed-account interest
    });

    it("savingsProducts.analytics gates unauthenticated callers (UNAUTHORIZED)", async () => {
      await expectTrpcCode(
        savingsProductsRouter.createCaller(ctxFor(null)).analytics(),
        "UNAUTHORIZED"
      );
    });

    // ── pensionCollection.pfas ─────────────────────────────────────────────
    it("pensionCollection.pfas returns all registry rows with real contributor counts", async () => {
      const res = await pensionCollectionRouter
        .createCaller(ctxFor(plainUser))
        .pfas();
      expect(res.pfas.length).toBe(4); // incl. inactive TRUSTFUND decoy
      const byCode = new Map(res.pfas.map(p => [p.code, p]));
      const stanbic = byCode.get("STANBIC")!;
      expect(stanbic.name).toBe("Stanbic IBTC Pension Managers Limited");
      expect(stanbic.licenseNo).toBe("PENCOM/SEED/001");
      expect(stanbic.contributorCount).toBe(2); // distinct rsaPin, R2+R3 dedupe
      expect(stanbic.active).toBe(true);
      const arm = byCode.get("ARM")!;
      // NOTE: design doc §4.2/§4.3 said "ARM 0" — hand-arithmetic slip; the
      // doc's own seed gives ARM one non-failed contributor (PEN-R4). See
      // file header.
      expect(arm.contributorCount).toBe(1);
      expect(arm.active).toBe(true);
      expect(byCode.get("FGPL")!.contributorCount).toBe(0); // failed decoy excluded
      const trustfund = byCode.get("TRUSTFUND")!;
      expect(trustfund.contributorCount).toBe(0);
      expect(trustfund.active).toBe(false); // boolean, not string
      expect(typeof trustfund.active).toBe("boolean");
    });

    it("pensionCollection.pfas gates unauthenticated callers (UNAUTHORIZED)", async () => {
      await expectTrpcCode(
        pensionCollectionRouter.createCaller(ctxFor(null)).pfas(),
        "UNAUTHORIZED"
      );
    });

    // ── pensionCollection.analytics ────────────────────────────────────────
    it("pensionCollection.analytics aggregates contributions (failed decoy excluded)", async () => {
      const res = await pensionCollectionRouter
        .createCaller(ctxFor(plainUser))
        .analytics();
      expect(res.totalVolume).toBe(234000); // employee+employer over R1..R4
      expect(res.totalContributions).toBe(4); // failed R5 excluded
      expect(res.totalCommission).toBe(1170);
    });

    it("pensionCollection.analytics gates unauthenticated callers (UNAUTHORIZED)", async () => {
      await expectTrpcCode(
        pensionCollectionRouter.createCaller(ctxFor(null)).analytics(),
        "UNAUTHORIZED"
      );
    });

    // ── Former scope guards (W30 kept list/history fail-loud as out-of-scope;
    // W31-B implemented them — guards rewritten as positive contract checks) ──
    // ── Retired scope guards (positive contract assertions) ────────────────
    it("savingsProducts.list returns real per-account rows (scope guard retired)", async () => {
      // 2026-11-27 (W31-B): scope guard retired — this test previously
      // asserted list throws NOT_IMPLEMENTED; the procedure is now
      // implemented as a real read over savings_accounts JOIN
      // savings_products with a ledger-SUM balance (router
      // savingsProducts.ts). Full behavioral coverage (decoys, deposit/
      // withdraw round-trip, gates) lives in
      // tests/integration/w31SavingsPensionTax.integration.test.ts; this
      // block positively asserts the new contract against the W30 seeds.
      // Truth (from the seed table above): A1 = 250000 − 40000 + 3125.50
      // = 213125.50, A2 = 100000 + 1200 = 101200, A3 = 75000, A4 = 900
      // (interest on the closed account still sums into its balance).
      const res = await savingsProductsRouter
        .createCaller(ctxFor(plainUser))
        .list();
      expect(res.accounts.length).toBe(4); // all accounts, incl. closed A4
      const byAcct = new Map(res.accounts.map(a => [a.accountNo, a]));
      const a1 = byAcct.get("SAVA-0001")!;
      expect(a1.productName).toBe("Ajo Daily Thrift");
      expect(a1.balance).toBe(213125.5);
      expect(a1.status).toBe("active");
      expect(a1.customerName).toBeNull(); // no customers seeded → LEFT JOIN null
      expect(byAcct.get("SAVA-0004")!.status).toBe("closed");
      expect(byAcct.get("SAVA-0004")!.balance).toBe(900);
      expect(byAcct.get("SAVA-0002")!.balance).toBe(101200);
    });

    it("pensionCollection.history returns real contribution rows (scope guard retired)", async () => {
      // 2026-11-27 (W31-B): scope guard retired — this test previously
      // asserted history throws NOT_IMPLEMENTED; the procedure is now
      // implemented as a real read over pension_contributions JOIN
      // pfa_registry (router pensionCollection.ts). Full behavioral coverage
      // lives in tests/integration/w31SavingsPensionTax.integration.test.ts;
      // this block positively asserts the new contract against the W30
      // seeds: all 5 seeded rows are returned (history includes the failed
      // R5 — the page renders it with the destructive badge), most recent
      // first (R5 has the highest id).
      const res = await pensionCollectionRouter
        .createCaller(ctxFor(plainUser))
        .history();
      expect(res.contributions.length).toBe(5);
      expect(res.contributions[0].rsaPin).toBe("PEN-100000000009"); // R5 first (id desc)
      expect(res.contributions[0].status).toBe("failed");
      const byRefPin = new Map(res.contributions.map(c => [c.rsaPin + c.period, c]));
      const r1 = byRefPin.get("PEN-1000000000012026-10")!;
      expect(r1.pfaName).toBe("Stanbic IBTC Pension Managers Limited");
      expect(r1.contributorName).toBe("Adaeze Nwosu");
      expect(r1.employeeAmount).toBe(40000);
      expect(r1.employerAmount).toBe(50000);
      expect(r1.type).toBe("Mandatory");
      expect(r1.status).toBe("remitted");
    });
  });
});
