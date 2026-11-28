/**
 * w31FloatStatsReplenishment.integration.test.ts — W31-A (2026-11-28)
 * REAL-DB (PGlite) tests for the two W31-A work items on
 * server/routers/agentFloatForecasting.ts:
 *
 *   - getStats — ported from main's F-12 implementation (real aggregates
 *     over agents.premiumReserve + transactions), replacing the fabricated
 *     body (agentCount × hardcoded 50000 float, agentCount × 0.12 stockout
 *     risk, hardcoded avgAccuracy 0.85, demand from a hardcoded 200000/30).
 *     Portal deltas D8 (fail-closed db-unavailable) and D9 (real
 *     predictedDemand7d = sum of the ported forecaster's 7-day
 *     predictedNeed, null on INSUFFICIENT_DATA) are documented in the
 *     router. avgAccuracy is a documented STOP (no honest source) and is
 *     emitted as explicit null — never a fabricated score.
 *   - triggerReplenishment — ported from main's B17 implementation: real
 *     money movement (TigerBeetle double-entry sys-bank-reserve →
 *     float-<agentId> + authoritative agents.premiumReserve update +
 *     transactions audit row + audit_log entry), admin-gated, Redis-locked,
 *     fail-loud. Portal deltas D4 (tx enum vocabulary) / D5 (TB code 300) /
 *     D7 (audit agentId) documented in the router.
 *
 * Harness mirrors ./w29Analytics.integration.test.ts (K/W29-wave): spawned
 * PGlite wire server, minimal DDL with schema-verbatim column names/types
 * for every column the queries touch, raw-SQL seeds, createCaller against
 * the real router. No mocks on the procedure under test. The TigerBeetle
 * leg runs against the repo's protocol-faithful in-process ledger
 * (tests/integration/setup/miniTigerBeetle.ts — REAL double-entry
 * semantics; the same harness the root funds-flow suites use), started on
 * an ephemeral port and wired via TB_SIDECAR_URL BEFORE the router module
 * is imported (server/tbClient.ts reads ENV.tbSidecarUrl at module load).
 * Permify is the vitest.setup.ts wire-protocol double (CHECK_RESULT_ALLOWED)
 * so the adminProcedure chain runs unmodified; Redis (ioredis) is the
 * vitest.setup.ts module double.
 *
 * Seeded truth (hand-computed from the seeds below, NOT from the
 * implementation):
 *
 *   Agents:
 *     910 AGT-W31-A1 'Replen Agent One'  Lagos  premiumReserve  3000.00
 *     911 AGT-W31-A2 'Replen Agent Two'  Abuja  premiumReserve     0.00
 *     912 AGT-W31-A3 'Idle Agent Three'  NULL   premiumReserve  7000.00
 *                                                         (no transactions)
 *
 *   Forecast-window transactions (status 'success' unless noted):
 *     A1: 7 x Claim Payout 2000 on today..today-6  -> cashOut 14000
 *         1 x Premium Payment 5000 yesterday       -> cashIn   5000
 *     A2: 7 x Claim Payout 1000 on today..today-6  -> cashOut  7000
 *   Decoys (must NOT enter the forecast basis; DO count in
 *   totalTransactions):
 *     A1 Claim Payout 999999 failed      (status filter)
 *     A1 Transfer      888888 success    (type filter)
 *     A1 Claim Payout  50000 success 10d ago (window filter)
 *     A2 Premium Payment 777777 pending  (status filter)
 *
 *   getStats truth (before any replenishment):
 *     totalAgents 3, agentsMonitored 3
 *     totalFloat = 3000 + 0 + 7000 = 10000
 *     atRisk (premiumReserve <= 0) = 1 (A2) -> stockoutRisk = round(1/3*100) = 33
 *     totalTransactions = 8 + 7 + 4 = 19
 *     predictedDemand7d = A1 predictedNeed + A2 predictedNeed
 *       A1: net outflow 14000-5000 = 9000 over 7d -> predictedNeed 9000
 *       A2: net outflow 7000 over 7d             -> predictedNeed 7000
 *       = 16000
 *
 *   Replenishment truth:
 *     single(A1, 2500)  -> newBalance 5500, tx row 'Transfer'/2500/success,
 *                          audit FLOAT_REPLENISH, TB float-AGT-W31-A1 += 2500
 *     single(A1, 5_000_000) -> PRECONDITION_FAILED (5500 + 5M > 5M cap),
 *                          balance unchanged, no new rows
 *     auto('all-below-threshold', amount 50000 = UI artifact):
 *       A1 shortfall = 9000 - 5500 = 3500 -> newBalance 9000
 *       A2 shortfall = 7000 - 0    = 7000 -> newBalance 7000
 *       (forecasts are shortfall-desc: A2 replenished first)
 *       A3 untouched (no flow rows -> not in forecasts)
 *     Final ledger/PG balances: A1 9000, A2 7000, A3 7000.
 *     TB ledger cross-check: float-AGT-W31-A1 credited 2500+3500 = 6000
 *     total (its opening TB balance is 0 — the seeded PG premiumReserve
 *     predates the TB leg, so PG and TB balances are not asserted equal;
 *     only the TB-side DELTAS are).
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
let miniTb: Awaited<
  ReturnType<typeof import("../../tests/integration/setup/miniTigerBeetle").startMiniTigerBeetle>
>;
let agentFloatForecastingRouter: typeof import("../../server/routers/agentFloatForecasting").agentFloatForecastingRouter;
let getDb: typeof import("../../server/db").getDb;
let getPool: typeof import("../../server/db").getPool;
let tbGetAgentBalance: typeof import("../../server/tbClient").tbGetAgentBalance;

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
  email: "reader@w31.test",
  name: "Read Only",
  role: "user",
  keycloakSub: "k-w31-user",
} as unknown as TrpcContext["user"];

const adminUser = {
  id: 950032,
  email: "admin@w31.test",
  name: "Admin User",
  role: "admin",
  keycloakSub: "k-w31-admin",
} as unknown as TrpcContext["user"];

// Minimal DDL — schema-verbatim column names/types for every column the
// procedures under test read or write. FKs omitted (documented in the
// K-wave harness): the queries join by value, not by constraint.
const DDL = `
CREATE TABLE IF NOT EXISTS "agents" (
  "id" serial PRIMARY KEY,
  "agentId" varchar(32) NOT NULL,
  "name" varchar(128) NOT NULL,
  "location" varchar(128),
  "premiumReserve" numeric(15,2),
  -- 2026-11-28 (C3 fix-cycle-1, verify-c3.md D1): complete the ported minimal
  -- DDL — root's PIN-guard writes failedPinAttempts/pinLockedUntil.
  "failedPinAttempts" integer DEFAULT 0 NOT NULL,
  "pinLockedUntil" timestamp,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "transactions" (
  "id" serial PRIMARY KEY,
  "ref" varchar(32) NOT NULL,
  "idempotencyKey" varchar(64),
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
  "channel" varchar(16),
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
  "status" varchar(16) DEFAULT 'success',
  "metadata" json,
  "tenantId" integer,
  -- 2026-11-28 (C3 fix-cycle-1, verify-c3.md D1/D2/D5/D7): complete the ported
  -- minimal DDL — root's audit chain (auditChain.ts) writes prevHash/entryHash
  -- on every insert and the retention job sets redactedAt; without these
  -- columns every audit write fails and the replenishment money path breaks.
  "prevHash" varchar(64),
  "entryHash" varchar(64),
  "redactedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
`;

async function exec(sql: string) {
  const db = (await getDb())!;
  return db.execute(sql as never);
}

async function queryRows(sql: string): Promise<any[]> {
  const res = (await exec(sql)) as unknown as { rows: any[] };
  return res.rows;
}

async function expectTrpcCode(p: Promise<unknown>, code: string) {
  try {
    await p;
    throw new Error(`expected TRPCError ${code}, but call succeeded`);
  } catch (err) {
    expect((err as { code?: string }).code).toBe(code);
  }
}

const dayMs = 24 * 60 * 60 * 1000;

async function seed() {
  await exec(`INSERT INTO "agents" ("id", "agentId", "name", "location", "premiumReserve")
    VALUES (910, 'AGT-W31-A1', 'Replen Agent One', 'Lagos', 3000.00),
           (911, 'AGT-W31-A2', 'Replen Agent Two', 'Abuja', 0.00),
           (912, 'AGT-W31-A3', 'Idle Agent Three', NULL, 7000.00)`);

  // A1: 7 distinct trailing days of successful Claim Payout 2000 + one
  // successful Premium Payment 5000 (yesterday).
  for (let k = 0; k < 7; k++) {
    const at = new Date(Date.now() - k * dayMs).toISOString();
    await exec(
      `INSERT INTO "transactions" ("ref", "agentId", "type", "amount", "fee", "commission", "status", "createdAt")
       VALUES ('W31-A1-${k}-OUT', 910, 'Cash Out', 2000.00, 0, 0, 'success', '${at}')`
    );
  }
  await exec(
    `INSERT INTO "transactions" ("ref", "agentId", "type", "amount", "fee", "commission", "status", "createdAt")
     VALUES ('W31-A1-IN', 910, 'Cash In', 5000.00, 0, 0, 'success', now() - interval '1 day')`
  );
  // A2: 7 distinct trailing days of successful Claim Payout 1000, no cash-in.
  for (let k = 0; k < 7; k++) {
    const at = new Date(Date.now() - k * dayMs).toISOString();
    await exec(
      `INSERT INTO "transactions" ("ref", "agentId", "type", "amount", "fee", "commission", "status", "createdAt")
       VALUES ('W31-A2-${k}-OUT', 911, 'Cash Out', 1000.00, 0, 0, 'success', '${at}')`
    );
  }
  // Decoys: wrong status / wrong type / outside the window — must NOT
  // affect the forecast basis.
  await exec(`INSERT INTO "transactions" ("ref", "agentId", "type", "amount", "fee", "commission", "status", "createdAt") VALUES
    ('W31-DECOY-FAILED',   910, 'Cash Out',    999999.00, 0, 0, 'failed',  now()),
    ('W31-DECOY-TRANSFER', 910, 'Transfer',        888888.00, 0, 0, 'success', now()),
    ('W31-DECOY-OLD',      910, 'Cash Out',     50000.00, 0, 0, 'success', now() - interval '10 days'),
    ('W31-DECOY-PENDING',  911, 'Cash In', 777777.00, 0, 0, 'pending', now())`);
}

describe("W31-A: agentFloatForecasting getStats port + triggerReplenishment port (real PGlite DB + real mini-TB ledger)", () => {
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
    // Protocol-faithful in-process TB ledger (repo-root harness helper) on
    // an ephemeral port; MUST be set before the router module is imported
    // because server/tbClient.ts captures ENV.tbSidecarUrl at module load.
    const { startMiniTigerBeetle } = await import(
      "../../tests/integration/setup/miniTigerBeetle"
    );
    miniTb = await startMiniTigerBeetle(0);
    process.env.TB_SIDECAR_URL = miniTb.url;
    const dbMod = await import("../../server/db");
    getDb = dbMod.getDb;
    getPool = dbMod.getPool;
    ({ agentFloatForecastingRouter } = await import(
      "../../server/routers/agentFloatForecasting"
    ));
    ({ tbGetAgentBalance } = await import("../../server/tbClient"));
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
    await miniTb?.close().catch(() => {});
    child?.kill("SIGTERM");
  });

  // ── getStats (F-12 port) ────────────────────────────────────────────────
  it("getStats returns the hand-computed real aggregates", async () => {
    const res = await agentFloatForecastingRouter
      .createCaller(ctxFor(plainUser))
      .getStats();
    expect(res.totalAgents).toBe(3);
    expect(res.agentsMonitored).toBe(3);
    expect(res.totalFloat).toBe(10000); // 3000 + 0 + 7000
    expect(res.stockoutRisk).toBe(33); // round(1/3 * 100)
    expect(res.totalTransactions).toBe(19); // decoys included
    expect(res.predictedDemand7d).toBe(16000); // 9000 + 7000
    expect(typeof res.lastUpdated).toBe("string");
    // STOP field: avgAccuracy is emitted as explicit null (no honest
    // source — never a fabricated score).
    expect(res.avgAccuracy).toBeNull();
    expect("seasonalFactor" in res).toBe(false);
  });

  it("getStats.predictedDemand7d equals the getForecast fleet sum (same basis)", async () => {
    const caller = agentFloatForecastingRouter.createCaller(ctxFor(plainUser));
    const stats = await caller.getStats();
    const forecast = await caller.getForecast({ days: 7 });
    const sum = forecast.forecasts.reduce((acc, f) => acc + f.predictedNeed, 0);
    expect(stats.predictedDemand7d).toBe(sum);
    expect(forecast.forecasts.map(f => f.id).sort()).toEqual([
      "AGT-W31-A1",
      "AGT-W31-A2",
    ]);
  });

  it("getStats gates unauthenticated callers (UNAUTHORIZED)", async () => {
    await expectTrpcCode(
      agentFloatForecastingRouter.createCaller(ctxFor(null)).getStats(),
      "UNAUTHORIZED"
    );
  });

  // ── triggerReplenishment (B17 port) ─────────────────────────────────────
  it("triggerReplenishment gates unauthenticated callers (UNAUTHORIZED)", async () => {
    await expectTrpcCode(
      agentFloatForecastingRouter
        .createCaller(ctxFor(null))
        .triggerReplenishment({ agentId: "AGT-W31-A1", amount: 2500 }),
      "UNAUTHORIZED"
    );
  });

  it("triggerReplenishment rejects non-admin callers (FORBIDDEN)", async () => {
    await expectTrpcCode(
      agentFloatForecastingRouter
        .createCaller(ctxFor(plainUser))
        .triggerReplenishment({ agentId: "AGT-W31-A1", amount: 2500 }),
      "FORBIDDEN"
    );
  });

  it("triggerReplenishment fails NOT_FOUND for an unknown agent code", async () => {
    await expectTrpcCode(
      agentFloatForecastingRouter
        .createCaller(ctxFor(adminUser))
        .triggerReplenishment({ agentId: "AGT-NOPE", amount: 2500 }),
      "NOT_FOUND"
    );
  });

  it("single replenishment moves real money: PG balance + tx row + audit row + TB leg", async () => {
    const res = await agentFloatForecastingRouter
      .createCaller(ctxFor(adminUser))
      .triggerReplenishment({ agentId: "AGT-W31-A1", amount: 2500 });
    expect(res.mode).toBe("single");
    expect(res.replenished.length).toBe(1);
    const r = res.replenished[0];
    expect(r.agentId).toBe("AGT-W31-A1");
    expect(r.amountNGN).toBe(2500);
    expect(r.newBalanceNGN).toBe(5500); // 3000 + 2500
    expect(r.ref.startsWith("RPL-")).toBe(true);
    // Real mini-TB ledger: the transfer genuinely committed.
    expect(typeof r.tbTransferId).toBe("string");

    // PG balance is authoritative and updated.
    const [agent] = await queryRows(
      `SELECT "premiumReserve" FROM "agents" WHERE "id" = 910`
    );
    expect(Number(agent.premiumReserve)).toBe(5500);

    // Transaction audit row.
    // 2026-11-28 (C3 fix-cycle-1, verify-c3.md D4): root writes the enum label
    // directly — type 'Float Transfer Received', channel 'Internal' (C2's D4
    // reversal on merge, agentFloatForecasting.ts:506-514). ip's 'Transfer'/
    // 'App' + metadata.txTypeDetail was NOT merged; aligned to root's
    // contract, no assertion dropped (row, amount, status, source, tb legs
    // all still verified).
    const txRows = await queryRows(
      `SELECT "type", "amount", "status", "channel", "metadata" FROM "transactions" WHERE "ref" = '${r.ref}'`
    );
    expect(txRows.length).toBe(1);
    expect(txRows[0].type).toBe("Float Transfer Received");
    expect(Number(txRows[0].amount)).toBe(2500);
    expect(txRows[0].status).toBe("success");
    expect(txRows[0].channel).toBe("Internal");
    expect(txRows[0].metadata.source).toBe(
      "agentFloatForecasting.triggerReplenishment"
    );
    expect(txRows[0].metadata.tbSyncStatus).toBe("synced");
    expect(txRows[0].metadata.tbTransferId).toBe(r.tbTransferId);

    // audit_log entry.
    const auditRows = await queryRows(
      `SELECT "agentId", "resource", "resourceId", "status", "metadata" FROM "audit_log" WHERE "action" = 'FLOAT_REPLENISH' AND "resourceId" = '910'`
    );
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].agentId).toBe(910);
    expect(auditRows[0].resource).toBe("agent_float");
    expect(auditRows[0].status).toBe("success");
    expect(auditRows[0].metadata.amountNGN).toBe(2500);
    expect(auditRows[0].metadata.newBalance).toBe(5500);

    // Independent ledger-side verification of the TB double-entry.
    const tbBal = await tbGetAgentBalance("AGT-W31-A1");
    expect(tbBal).not.toBeNull();
    expect(tbBal!.balanceNGN).toBe(2500);
  });

  it("replenishment beyond the max float fails closed (PRECONDITION_FAILED) and moves nothing", async () => {
    await expectTrpcCode(
      agentFloatForecastingRouter
        .createCaller(ctxFor(adminUser))
        .triggerReplenishment({ agentId: "AGT-W31-A1", amount: 5_000_000 }),
      "PRECONDITION_FAILED" // 5500 + 5,000,000 > ₦5,000,000 cap
    );
    const [agent] = await queryRows(
      `SELECT "premiumReserve" FROM "agents" WHERE "id" = 910`
    );
    expect(Number(agent.premiumReserve)).toBe(5500); // unchanged
    const txRows = await queryRows(
      // D4 enum alignment (verify-c3.md): root writes 'Float Transfer Received'.
      `SELECT count(*)::int AS n FROM "transactions" WHERE "agentId" = 910 AND "type" = 'Float Transfer Received' AND "ref" LIKE 'RPL-%'`
    );
    expect(txRows[0].n).toBe(1); // only the successful 2500 top-up
    const tbBal = await tbGetAgentBalance("AGT-W31-A1");
    expect(tbBal!.balanceNGN).toBe(2500); // ledger unchanged
  });

  it("auto mode replenishes each agent by its OWN computed shortfall, never the blanket amount", async () => {
    const res = await agentFloatForecastingRouter
      .createCaller(ctxFor(adminUser))
      .triggerReplenishment({ agentId: "all-below-threshold", amount: 50000 });
    expect(res.mode).toBe("auto");
    expect(res.cappedAt).toBe(25);
    // Forecasts sort shortfall-desc: A2 (7000) then A1 (9000 - 5500 = 3500).
    expect(res.replenished.length).toBe(2);
    expect(res.replenished[0].agentId).toBe("AGT-W31-A2");
    expect(res.replenished[0].amountNGN).toBe(7000);
    expect(res.replenished[0].newBalanceNGN).toBe(7000);
    expect(res.replenished[1].agentId).toBe("AGT-W31-A1");
    expect(res.replenished[1].amountNGN).toBe(3500);
    expect(res.replenished[1].newBalanceNGN).toBe(9000);

    const rows = await queryRows(
      `SELECT "id", "premiumReserve" FROM "agents" WHERE "id" IN (910, 911, 912) ORDER BY "id"`
    );
    expect(Number(rows[0].premiumReserve)).toBe(9000); // A1: 5500 + 3500
    expect(Number(rows[1].premiumReserve)).toBe(7000); // A2: 0 + 7000
    expect(Number(rows[2].premiumReserve)).toBe(7000); // A3: untouched

    // TB ledger deltas: A1 credited 2500 + 3500 = 6000, A2 credited 7000.
    // (The TB ledger starts at 0 — the seeded PG premiumReserve predates
    // the TB leg — so TB holds only the replenishment deltas: 2500 + 3500
    // = 6000. An earlier draft of this assertion said 6500; that was a
    // hand-arithmetic slip, the code and PG truth (9000) are correct.)
    const tb1 = await tbGetAgentBalance("AGT-W31-A1");
    const tb2 = await tbGetAgentBalance("AGT-W31-A2");
    expect(tb1!.balanceNGN).toBe(6000);
    expect(tb2!.balanceNGN).toBe(7000);

    // Each replenishment wrote its own transactions + audit rows.
    const txRows = await queryRows(
      `SELECT count(*)::int AS n FROM "transactions" WHERE "ref" LIKE 'RPL-%'`
    );
    expect(txRows[0].n).toBe(3);
    const auditRows = await queryRows(
      `SELECT count(*)::int AS n FROM "audit_log" WHERE "action" = 'FLOAT_REPLENISH'`
    );
    expect(auditRows[0].n).toBe(3);
  });
});
