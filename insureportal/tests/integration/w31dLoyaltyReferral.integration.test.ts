/**
 * w31dLoyaltyReferral.integration.test.ts — W31-D (2026-11-27) REAL-DB
 * (PGlite) tests for the two residual-error fixes:
 *
 *   1. promotions.applyReferral — loyalty_accounts.referredBy is now a real
 *      column (schema.ts + migration 0048_referred_by.sql, ported from main
 *      drizzle/insurance-extended-schema.ts:61). These tests prove the
 *      referral write→read round-trip against a real database:
 *        - guarded UPDATE sets referredBy exactly once (one-time claim);
 *        - both parties are credited 500 pts and both ledger rows are
 *          written;
 *        - a repeat call fails closed (no double grant);
 *        - an already-referred account keeps its original referrer;
 *        - self-referral and unknown-code fail before any write;
 *        - a never-referred DECOY account stays referredBy=NULL, untouched.
 *
 *      2026-11-27 (W32-B) HONEST-CONTRACT REWRITE: applyReferral was
 *      re-ported from main's I2/AB-13 version (session-bound referee
 *      identity + claim/credits/ledger in ONE transaction). Where the
 *      ported behavior changed the observable contract, the legs below
 *      were rewritten (each carries a dated comment):
 *        - the referee identity now comes from the SESSION
 *          (customers.keycloakSub = String(ctx.user.id)); a client-supplied
 *          customerId is only honored for staff (role=admin) applying for
 *          a different customer, otherwise FORBIDDEN;
 *        - failures are typed TRPCError codes (NOT_FOUND unknown code,
 *          BAD_REQUEST self-referral, CONFLICT repeat claim, FORBIDDEN
 *          cross-customer/no-profile) instead of untyped Errors that
 *          surfaced as INTERNAL_SERVER_ERROR;
 *        - a crash-atomicity leg (DB-trigger partial-failure injection)
 *          proves a mid-transaction failure leaves NO locked-unpaid state
 *          (referredBy stays NULL, no points, no ledger rows).
 *      Portal-retained behavior (documented delta in the router): the two
 *      referral ledger rows are KEPT (main writes none) and are now
 *      written inside the same transaction.
 *
 *   2. agentOnboardingWizard.getProgress — the "Terminal Assignment" step
 *      previously referenced a nonexistent `serviceNodes` identifier
 *      (runtime ReferenceError-class bug, TS2304 ×2); W31-D ported main's
 *      resolution (posTerminals, already imported from @schema). Pre-fix,
 *      getProgress exploded with INTERNAL_SERVER_ERROR ("serviceNodes is
 *      not defined") under esbuild-transpiled vitest; these tests prove the
 *      step now reads pos_terminals honestly: an agent WITH a terminal row
 *      completes step 4, the no-terminal DECOY does not.
 *
 * Harness mirrors ./w30SavingsPension.integration.test.ts (W30): spawned
 * PGlite wire server (tests/integration/setup/pgliteServer.mjs, repo root),
 * allocFreePort, DATABASE_URL set before importing server/db, dynamic
 * router imports, minimal DDL with schema-verbatim column names/types for
 * every column the procedures touch (FKs omitted — joins are by value),
 * raw-SQL seeds, createCaller against the real routers. No mocks on the
 * procedures under test. The loyalty_accounts DDL carries "referredBy"
 * exactly as migration 0048 adds it (integer, nullable). The 2026-11-27
 * (W32-B) rewrite adds the customers table (session binding) and the
 * audit_log table (the ported procedure's writeAuditLog audit trail).
 */
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";
import type { TrpcContext } from "../../server/_core/context";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

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
let promotionsRouter: typeof import("../../server/routers/promotions").promotionsRouter;
let agentOnboardingWizardRouter: typeof import("../../server/routers/agentOnboardingWizard").agentOnboardingWizardRouter;
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
  email: "caller@w31d.test",
  name: "Referral Caller",
  role: "user",
  keycloakSub: "k-w31d-user",
} as unknown as TrpcContext["user"];

// 2026-11-27 (W32-B): applyReferral is now session-bound, so each caller
// class needs an explicit identity. customers.keycloakSub is matched
// against String(ctx.user.id) (H2/AB-12 discipline, same as
// customer.ts resolveCustomer) — the seeds below wire these ids up.
const referrerUser = {
  id: 950032, // session → customer 501 (owns referral code REF-AAA)
  email: "referrer@w31d.test",
  name: "Referral Owner",
  role: "user",
  keycloakSub: "k-w31d-referrer",
} as unknown as TrpcContext["user"];
const staffUser = {
  id: 950033, // role=admin: may apply a referral for a different customerId
  email: "staff@w31d.test",
  name: "Staff Caller",
  role: "admin",
  keycloakSub: "k-w31d-staff",
} as unknown as TrpcContext["user"];
const noProfileUser = {
  id: 950034, // no customers row → FORBIDDEN "No customer profile…"
  email: "orphan@w31d.test",
  name: "Profileless Caller",
  role: "user",
  keycloakSub: "k-w31d-orphan",
} as unknown as TrpcContext["user"];
const crashUser = {
  id: 950035, // session → customer 505 (crash-atomicity referee)
  email: "crash@w31d.test",
  name: "Crash Caller",
  role: "user",
  keycloakSub: "k-w31d-crash",
} as unknown as TrpcContext["user"];

// Minimal DDL — schema-verbatim column names/types for every column the
// procedures under test touch (drizzle/schema.ts; loyalty_accounts gains
// "referredBy" integer exactly as migration 0048_referred_by.sql adds it).
// FKs omitted (documented in the K-wave harness): the queries join by
// value, not by constraint. getProgress runs a full-row select() on
// agents, so agents carries every schema column; the count-only tables
// carry just the columns the queries reference (plus NOT NULL columns the
// seeds must satisfy).
const DDL = `
CREATE TABLE IF NOT EXISTS "loyalty_accounts" (
  "id" serial PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "userId" integer NOT NULL,
  "points" integer DEFAULT 0 NOT NULL,
  "tier" varchar(32) DEFAULT 'bronze',
  "lifetimePoints" integer DEFAULT 0,
  "customerId" integer,
  "referralCode" varchar(32),
  "referredBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "loyalty_transactions" (
  "id" serial PRIMARY KEY,
  "accountId" integer NOT NULL,
  "tenantId" integer NOT NULL,
  "type" varchar(32) NOT NULL,
  "points" integer NOT NULL,
  "referenceType" varchar(64),
  "referenceId" integer,
  "description" text,
  "expiresAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
-- 2026-11-27 (W32-B): customers carries exactly the columns the ported
-- applyReferral touches (id, keycloakSub for the session binding) plus the
-- NOT NULL columns the seeds must satisfy. audit_log carries the columns
-- the portal writeAuditLog inserts (status enum rendered as varchar per
-- the harness enum-as-varchar convention, cf. agents.tier above).
CREATE TABLE IF NOT EXISTS "customers" (
  "id" serial PRIMARY KEY,
  "firstName" varchar(64) NOT NULL,
  "lastName" varchar(64) NOT NULL,
  "phone" varchar(20) NOT NULL UNIQUE,
  "keycloakSub" varchar(128) UNIQUE
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
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "agents" (
  "id" serial PRIMARY KEY,
  "agentId" varchar(32) NOT NULL UNIQUE,
  "name" varchar(128) NOT NULL,
  "phone" varchar(20) NOT NULL,
  "email" varchar(320),
  "location" varchar(128),
  "terminalModel" varchar(64) DEFAULT 'PAX A920 MAX',
  "terminalSerial" varchar(64),
  "tier" varchar(32) DEFAULT 'Bronze' NOT NULL,
  "role" varchar(32) DEFAULT 'agent' NOT NULL,
  "pinHash" varchar(128) NOT NULL,
  "premiumReserve" numeric(15,2) DEFAULT '0.00' NOT NULL,
  "floatLimit" numeric(15,2) DEFAULT '1000000.00' NOT NULL,
  "commissionBalance" numeric(15,2) DEFAULT '0.00' NOT NULL,
  "loyaltyPoints" integer DEFAULT 0 NOT NULL,
  "streak" integer DEFAULT 0 NOT NULL,
  "rank" integer DEFAULT 0,
  "isActive" boolean DEFAULT true NOT NULL,
  "floatLocked" boolean DEFAULT false NOT NULL,
  "terminalEnabled" boolean DEFAULT true NOT NULL,
  "terminalDisabledReason" text,
  "lastLoginAt" timestamp,
  "deletedAt" timestamp,
  "tenantId" integer,
  "creditScore" integer DEFAULT 0,
  "creditLimit" numeric(15,2) DEFAULT '0.00',
  "creditRating" varchar(32) DEFAULT 'N/A',
  "parentAgentId" integer,
  "hierarchyRole" varchar(32) DEFAULT 'agent',
  "hierarchyLevel" integer DEFAULT 3,
  "commissionSplitOverride" numeric(5,2),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "kyc_sessions" (
  "id" serial PRIMARY KEY,
  "agentId" integer,
  "status" varchar(32) DEFAULT 'pending' NOT NULL
);
CREATE TABLE IF NOT EXISTS "float_topup_requests" (
  "id" serial PRIMARY KEY,
  "agentId" integer NOT NULL
);
CREATE TABLE IF NOT EXISTS "pos_terminals" (
  "id" serial PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "agentId" integer,
  "terminalId" varchar(64) NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS "training_enrollments" (
  "id" serial PRIMARY KEY,
  "course_id" integer NOT NULL,
  "agent_id" integer NOT NULL
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

async function loyaltyAccountById(id: number) {
  const db = (await getDb())!;
  const rows = await db.execute(
    `SELECT "id", "customerId", "points", "lifetimePoints", "referredBy" FROM "loyalty_accounts" WHERE "id" = ${id}` as never
  );
  return (rows as unknown as { rows: Record<string, unknown>[] }).rows[0] as {
    id: number;
    customerId: number;
    points: number;
    lifetimePoints: number;
    referredBy: number | null;
  };
}

async function seed() {
  // ── Loyalty accounts ───────────────────────────────────────────────────
  // 1 REF-AAA = the REFERRER (customerId 501, 1000 pts / 1000 lifetime).
  // 2 REF-BBB = the REFEREE (customerId 502, 0 pts, referredBy NULL — the
  //   claimable account).
  // 3 REF-CCC = the NEVER-REFERRED DECOY (customerId 503, 250 pts): must
  //   stay referredBy NULL and 250 pts through every test.
  // 4 REF-DDD = the ALREADY-REFERRED DECOY (customerId 504, referredBy 999,
  //   40 pts): a repeat claim must fail closed and preserve 999.
  await exec(`INSERT INTO "loyalty_accounts"
    ("id", "tenantId", "userId", "points", "lifetimePoints", "customerId", "referralCode", "referredBy") VALUES
    (1, 1, 101, 1000, 1000, 501, 'REF-AAA', NULL),
    (2, 1, 102, 0, 0, 502, 'REF-BBB', NULL),
    (3, 1, 103, 250, 250, 503, 'REF-CCC', NULL),
    (4, 1, 104, 40, 40, 504, 'REF-DDD', 999),
    (5, 1, 105, 0, 0, 505, 'REF-EEE', NULL)`);

  // ── Customers (2026-11-27, W32-B): session-binding targets ──────────
  // keycloakSub = String(ctx.user.id) of the caller each leg uses:
  //   501 ← referrerUser 950032 (self-referral leg)
  //   502 ← plainUser 950031    (success/repeat/unknown-code/… legs)
  //   505 ← crashUser 950035    (crash-atomicity leg; account 5 above)
  // staffUser 950033 and noProfileUser 950034 deliberately have NO row
  // (staff bypasses the profile; the orphan leg asserts FORBIDDEN).
  await exec(`INSERT INTO "customers" ("id", "firstName", "lastName", "phone", "keycloakSub") VALUES
    (501, 'Rita', 'Referrer', '08031000501', '950032'),
    (502, 'Ray', 'Referee', '08031000502', '950031'),
    (505, 'Cole', 'Crash', '08031000505', '950035')`);

  // ── Onboarding wizard domain ───────────────────────────────────────────
  // Agent 1 (AG-W31D-1): complete — KYC completed, float top-up, POS
  // terminal, training enrollment → all 5 steps done.
  // Agent 2 (AG-W31D-2): the NO-TERMINAL DECOY — everything except a
  // pos_terminals row; "Terminal Assignment" must read pos_terminals
  // honestly and report incomplete.
  await exec(`INSERT INTO "agents" ("id", "agentId", "name", "phone", "pinHash") VALUES
    (1, 'AG-W31D-1', 'Adaeze Wizard', '08030000001', 'x'),
    (2, 'AG-W31D-2', 'Babatunde Wizard', '08030000002', 'x')`);
  await exec(`INSERT INTO "kyc_sessions" ("agentId", "status") VALUES
    (1, 'completed'),
    (2, 'completed')`);
  await exec(`INSERT INTO "float_topup_requests" ("agentId") VALUES (1), (2)`);
  await exec(`INSERT INTO "pos_terminals" ("tenantId", "agentId", "terminalId") VALUES
    (1, 1, 'TERM-W31D-1')`);
  await exec(`INSERT INTO "training_enrollments" ("course_id", "agent_id") VALUES
    (1, 1),
    (1, 2)`);
}

describe("W31-D: loyalty referredBy + onboarding wizard serviceNodes fixes (real PGlite DB)", () => {
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
    const dbMod = await import("../../server/db");
    getDb = dbMod.getDb;
    getPool = dbMod.getPool;
    ({ promotionsRouter } = await import("../../server/routers/promotions"));
    ({ agentOnboardingWizardRouter } = await import(
      "../../server/routers/agentOnboardingWizard"
    ));
    const db = (await getDb())!;
    await db.execute(DDL as never);
    await seed();
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

  // ── promotions.applyReferral — referredBy write→read round-trip ───────
  // NOTE on ordering: the success test mutates account 2; the one-time
  // guard test re-fires the same claim against the now-referred account.
  // Vitest runs in-file tests sequentially, and the dependence is the
  // point (the second call can only fail BECAUSE the first persisted).
  //
  // 2026-11-27 (W32-B) HONEST-CONTRACT REWRITE: the ported procedure
  // session-binds the referee (customers.keycloakSub = String(ctx.user.id))
  // and answers with typed TRPCError codes. The legs below pass NO
  // customerId unless the leg is specifically about the deprecated input.
  it("applyReferral persists referredBy and credits BOTH parties (round-trip, session-bound referee)", async () => {
    const caller = promotionsRouter.createCaller(ctxFor(plainUser));
    // 2026-11-27 (W32-B): no customerId — the referee is plainUser's own
    // customer profile (502) resolved from the session.
    const res = await caller.applyReferral({
      referralCode: "REF-AAA",
    });
    expect(res).toEqual({
      success: true,
      referrerBonus: 500,
      referreeBonus: 500,
    });

    // Read back from the real DB — the write must have persisted.
    const referee = await loyaltyAccountById(2);
    expect(referee.referredBy).toBe(501); // referrer's customerId
    expect(referee.points).toBe(500); // referee welcome bonus
    expect(referee.lifetimePoints).toBe(500);
    const referrer = await loyaltyAccountById(1);
    expect(referrer.points).toBe(1500); // 1000 + 500 referral bonus
    expect(referrer.lifetimePoints).toBe(1500);
    expect(referrer.referredBy).toBeNull(); // referrer himself un-referred

    // Both referral ledger rows exist (referrer + referee) — the
    // portal-retained audit trail, now written inside the transaction.
    const db = (await getDb())!;
    const tx = await db.execute(
      `SELECT "accountId", "points", "type" FROM "loyalty_transactions" WHERE "type" = 'referral' ORDER BY "accountId"` as never
    );
    const txRows = (tx as unknown as { rows: Record<string, unknown>[] })
      .rows;
    expect(txRows).toEqual([
      { accountId: 1, points: 500, type: "referral" },
      { accountId: 2, points: 500, type: "referral" },
    ]);

    // 2026-11-27 (W32-B): the ported procedure writes a real audit row.
    const audit = await db.execute(
      `SELECT "action", "resourceId" FROM "audit_log" WHERE "action" = 'LOYALTY_REFERRAL_APPLIED'` as never
    );
    expect((audit as unknown as { rows: Record<string, unknown>[] }).rows)
      .toEqual([{ action: "LOYALTY_REFERRAL_APPLIED", resourceId: "502" }]);

    // Never-referred decoy untouched.
    const decoy = await loyaltyAccountById(3);
    expect(decoy.referredBy).toBeNull();
    expect(decoy.points).toBe(250);
  });

  it("applyReferral is a one-time claim: a repeat call fails closed with no double grant", async () => {
    const caller = promotionsRouter.createCaller(ctxFor(plainUser));
    // 2026-11-27 (W32-B): was an untyped Error (→ INTERNAL_SERVER_ERROR);
    // the ported procedure fails closed with a typed CONFLICT.
    await expectTrpcCode(
      caller.applyReferral({ referralCode: "REF-AAA" }),
      "CONFLICT"
    );
    // No double grant: points identical to the post-success state.
    const referrer = await loyaltyAccountById(1);
    expect(referrer.points).toBe(1500);
    const referee = await loyaltyAccountById(2);
    expect(referee.points).toBe(500);
    expect(referee.referredBy).toBe(501);
  });

  it("applyReferral preserves an existing referrer (already-referred decoy, staff caller)", async () => {
    // 2026-11-27 (W32-B): account 4 belongs to customer 504, which is NOT
    // the caller's profile — only a staff (role=admin) caller may pass a
    // different customerId. This leg is also the staff-bypass proof: the
    // call reaches the guarded claim and fails there with CONFLICT (not
    // FORBIDDEN), preserving the original referrer.
    const caller = promotionsRouter.createCaller(ctxFor(staffUser));
    await expectTrpcCode(
      caller.applyReferral({ customerId: 504, referralCode: "REF-AAA" }),
      "CONFLICT"
    );
    const decoy = await loyaltyAccountById(4);
    expect(decoy.referredBy).toBe(999); // original referrer preserved
    expect(decoy.points).toBe(40); // no bonus granted
    const referrer = await loyaltyAccountById(1);
    expect(referrer.points).toBe(1500); // referrer not credited either
  });

  it("applyReferral rejects self-referral before any write", async () => {
    // 2026-11-27 (W32-B): referrerUser's session resolves to customer 501
    // — the owner of REF-AAA — so the self-referral guard fires.
    const caller = promotionsRouter.createCaller(ctxFor(referrerUser));
    await expectTrpcCode(
      caller.applyReferral({ referralCode: "REF-AAA" }),
      "BAD_REQUEST"
    );
    const self = await loyaltyAccountById(1);
    expect(self.referredBy).toBeNull();
    expect(self.points).toBe(1500);
  });

  it("applyReferral rejects an unknown referral code", async () => {
    const caller = promotionsRouter.createCaller(ctxFor(plainUser));
    // 2026-11-27 (W32-B): typed NOT_FOUND instead of an untyped Error.
    await expectTrpcCode(
      caller.applyReferral({ referralCode: "REF-NOPE" }),
      "NOT_FOUND"
    );
    const decoy = await loyaltyAccountById(3);
    expect(decoy.referredBy).toBeNull();
    expect(decoy.points).toBe(250);
  });

  it("applyReferral FORBIDDEN: non-staff caller passing someone else's customerId", async () => {
    // 2026-11-27 (W32-B) NEW EDGE LEG: the pre-port procedure trusted the
    // client-supplied customerId outright — any authenticated caller could
    // apply a referral to an arbitrary account. The ported session binding
    // rejects a mismatched non-staff customerId BEFORE any write.
    const caller = promotionsRouter.createCaller(ctxFor(plainUser));
    await expectTrpcCode(
      caller.applyReferral({ customerId: 503, referralCode: "REF-AAA" }),
      "FORBIDDEN"
    );
    const decoy = await loyaltyAccountById(3);
    expect(decoy.referredBy).toBeNull();
    expect(decoy.points).toBe(250);
  });

  it("applyReferral FORBIDDEN: authenticated caller with no customer profile", async () => {
    // 2026-11-27 (W32-B) NEW EDGE LEG: session binding is unresolvable for
    // this caller class — a clear FORBIDDEN, never an INTERNAL_SERVER_ERROR.
    const caller = promotionsRouter.createCaller(ctxFor(noProfileUser));
    await expectTrpcCode(
      caller.applyReferral({ referralCode: "REF-AAA" }),
      "FORBIDDEN"
    );
    // Nothing written anywhere.
    const db = (await getDb())!;
    const c = await db.execute(
      `SELECT count(*)::int AS c FROM "loyalty_accounts" WHERE "referredBy" = 501` as never
    );
    expect((c as unknown as { rows: { c: number }[] }).rows[0].c).toBe(1); // only account 2
  });

  it("applyReferral gates unauthenticated callers (UNAUTHORIZED)", async () => {
    await expectTrpcCode(
      promotionsRouter
        .createCaller(ctxFor(null))
        .applyReferral({ referralCode: "REF-AAA" }),
      "UNAUTHORIZED"
    );
    const decoy = await loyaltyAccountById(3);
    expect(decoy.referredBy).toBeNull(); // nothing written
  });

  it("applyReferral is crash-atomic: a mid-transaction failure leaves no locked-unpaid state", async () => {
    // 2026-11-27 (W32-B) NEW CRASH-ATOMICITY LEG. The pre-port procedure
    // ran claim → credits → ledger OUTSIDE any transaction: a crash after
    // the claim set referredBy with no bonuses, and the one-time guard
    // then blocked every retry (permanently locked-unpaid). Here a real
    // Postgres trigger aborts the REFERRER credit — the statement that
    // runs AFTER the guarded claim inside the new transaction — so the
    // whole transaction must roll back: no referredBy, no points, no
    // ledger rows. This is DB-layer failure injection against the real
    // procedure, not a mock of the production path.
    await exec(`
      CREATE OR REPLACE FUNCTION w32b_abort_referrer_credit() RETURNS trigger AS $fn$
      BEGIN
        RAISE EXCEPTION 'w32b injected crash: referrer credit failed';
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await exec(`
      CREATE TRIGGER w32b_abort_referrer_credit
      BEFORE UPDATE OF points ON "loyalty_accounts"
      FOR EACH ROW WHEN (OLD.id = 1)
      EXECUTE FUNCTION w32b_abort_referrer_credit()
    `);
    try {
      const caller = promotionsRouter.createCaller(ctxFor(crashUser));
      // The trigger's RAISE is not a TRPCError → surfaces as
      // INTERNAL_SERVER_ERROR; the failure mode that matters is the
      // rollback asserted below.
      await expectTrpcCode(
        caller.applyReferral({ referralCode: "REF-AAA" }),
        "INTERNAL_SERVER_ERROR"
      );
    } finally {
      await exec(
        `DROP TRIGGER IF EXISTS w32b_abort_referrer_credit ON "loyalty_accounts"`
      );
      await exec(`DROP FUNCTION IF EXISTS w32b_abort_referrer_credit()`);
    }
    // The claim on account 5 (customer 505) must have ROLLED BACK with the
    // aborted credit — no locked-unpaid state.
    const refugee = await loyaltyAccountById(5);
    expect(refugee.referredBy).toBeNull();
    expect(refugee.points).toBe(0);
    expect(refugee.lifetimePoints).toBe(0);
    // Referrer not credited either; ledger still holds exactly the two
    // rows from the earlier success leg.
    const referrer = await loyaltyAccountById(1);
    expect(referrer.points).toBe(1500);
    const db = (await getDb())!;
    const c = await db.execute(
      `SELECT count(*)::int AS c FROM "loyalty_transactions" WHERE "type" = 'referral'` as never
    );
    expect((c as unknown as { rows: { c: number }[] }).rows[0].c).toBe(2);
    // And the retry the old code would have blocked now succeeds —
    // proving no permanent lock-out after a crash.
    const retry = await promotionsRouter
      .createCaller(ctxFor(crashUser))
      .applyReferral({ referralCode: "REF-AAA" });
    expect(retry.success).toBe(true);
    const recovered = await loyaltyAccountById(5);
    expect(recovered.referredBy).toBe(501);
    expect(recovered.points).toBe(500);
  });

  // ── agentOnboardingWizard.getProgress — posTerminals (ex-serviceNodes) ──
  it("getProgress completes 'Terminal Assignment' only when a pos_terminals row exists", async () => {
    const caller = agentOnboardingWizardRouter.createCaller(
      ctxFor(plainUser)
    );
    const complete = await caller.getProgress({ agentId: 1 });
    expect(complete.status).toBe("completed");
    expect(complete.completedSteps).toBe(5);
    expect(complete.agentName).toBe("Adaeze Wizard");
    const terminalStep = complete.steps.find(
      s => s.name === "Terminal Assignment"
    )!;
    expect(terminalStep.completed).toBe(true);
    expect(terminalStep.order).toBe(4);
  });

  it("getProgress reports the no-terminal decoy as stuck on step 4 (honest pos_terminals read)", async () => {
    const caller = agentOnboardingWizardRouter.createCaller(
      ctxFor(plainUser)
    );
    const partial = await caller.getProgress({ agentId: 2 });
    expect(partial.status).toBe("in_progress");
    expect(partial.completedSteps).toBe(4);
    expect(partial.step).toBe(4);
    const byName = new Map(partial.steps.map(s => [s.name, s.completed]));
    expect(byName.get("Profile")).toBe(true);
    expect(byName.get("KYC Verification")).toBe(true);
    expect(byName.get("Float Setup")).toBe(true);
    expect(byName.get("Terminal Assignment")).toBe(false); // ← the fixed read
    expect(byName.get("Training")).toBe(true);
  });

  it("getProgress returns the empty shape for an unknown agent", async () => {
    const caller = agentOnboardingWizardRouter.createCaller(
      ctxFor(plainUser)
    );
    const res = await caller.getProgress({ agentId: 9999 });
    expect(res).toEqual({
      step: 0,
      steps: [],
      completedSteps: 0,
      totalSteps: 5,
    });
  });

  it("getProgress gates unauthenticated callers (UNAUTHORIZED)", async () => {
    await expectTrpcCode(
      agentOnboardingWizardRouter
        .createCaller(ctxFor(null))
        .getProgress({ agentId: 1 }),
      "UNAUTHORIZED"
    );
  });
});
