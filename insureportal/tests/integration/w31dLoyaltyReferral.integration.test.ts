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
 * exactly as migration 0048 adds it (integer, nullable).
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

async function expectErrorMessage(p: Promise<unknown>, message: string) {
  try {
    await p;
    throw new Error(`expected Error "${message}", but call succeeded`);
  } catch (err) {
    expect((err as Error).message).toBe(message);
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
    (4, 1, 104, 40, 40, 504, 'REF-DDD', 999)`);

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
  it("applyReferral persists referredBy and credits BOTH parties (round-trip)", async () => {
    const caller = promotionsRouter.createCaller(ctxFor(plainUser));
    const res = await caller.applyReferral({
      customerId: 502,
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

    // Both referral ledger rows exist (referrer + referee).
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

    // Never-referred decoy untouched.
    const decoy = await loyaltyAccountById(3);
    expect(decoy.referredBy).toBeNull();
    expect(decoy.points).toBe(250);
  });

  it("applyReferral is a one-time claim: a repeat call fails closed with no double grant", async () => {
    const caller = promotionsRouter.createCaller(ctxFor(plainUser));
    await expectErrorMessage(
      caller.applyReferral({ customerId: 502, referralCode: "REF-AAA" }),
      "Customer has already been referred"
    );
    // No double grant: points identical to the post-success state.
    const referrer = await loyaltyAccountById(1);
    expect(referrer.points).toBe(1500);
    const referee = await loyaltyAccountById(2);
    expect(referee.points).toBe(500);
    expect(referee.referredBy).toBe(501);
  });

  it("applyReferral preserves an existing referrer (already-referred decoy)", async () => {
    const caller = promotionsRouter.createCaller(ctxFor(plainUser));
    await expectErrorMessage(
      caller.applyReferral({ customerId: 504, referralCode: "REF-AAA" }),
      "Customer has already been referred"
    );
    const decoy = await loyaltyAccountById(4);
    expect(decoy.referredBy).toBe(999); // original referrer preserved
    expect(decoy.points).toBe(40); // no bonus granted
    const referrer = await loyaltyAccountById(1);
    expect(referrer.points).toBe(1500); // referrer not credited either
  });

  it("applyReferral rejects self-referral before any write", async () => {
    const caller = promotionsRouter.createCaller(ctxFor(plainUser));
    await expectErrorMessage(
      caller.applyReferral({ customerId: 501, referralCode: "REF-AAA" }),
      "Cannot refer yourself"
    );
    const self = await loyaltyAccountById(1);
    expect(self.referredBy).toBeNull();
    expect(self.points).toBe(1500);
  });

  it("applyReferral rejects an unknown referral code", async () => {
    const caller = promotionsRouter.createCaller(ctxFor(plainUser));
    await expectErrorMessage(
      caller.applyReferral({ customerId: 503, referralCode: "REF-NOPE" }),
      "Invalid referral code"
    );
    const decoy = await loyaltyAccountById(3);
    expect(decoy.referredBy).toBeNull();
    expect(decoy.points).toBe(250);
  });

  it("applyReferral gates unauthenticated callers (UNAUTHORIZED)", async () => {
    await expectTrpcCode(
      promotionsRouter
        .createCaller(ctxFor(null))
        .applyReferral({ customerId: 503, referralCode: "REF-AAA" }),
      "UNAUTHORIZED"
    );
    const decoy = await loyaltyAccountById(3);
    expect(decoy.referredBy).toBeNull(); // nothing written
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
