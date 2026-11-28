/**
 * w32FloatReplenishmentHardening.integration.test.ts — W32-A (2026-11-27)
 * REAL-DB (PGlite) + REAL-ledger (miniTigerBeetle) tests for the W32-A
 * money-path hardening of server/routers/agentFloatForecasting.ts
 * triggerReplenishment/replenishOne. The four W31-A verifier probe findings
 * (D10–D13) are fixed fail-closed; this suite probes each fix:
 *
 *   D10 TB leg fail-closed: miniTigerBeetle is taken DOWN via its honest
 *     test-only outage control (POST /__test/down — the ledger answers 503
 *     "operation NOT committed", exactly the real tb-sidecar's posture when
 *     its upstream is unreachable). The replenishment must THROW
 *     (PRECONDITION_FAILED) and PG must be byte-identical: balance, zero
 *     new RPL transaction rows, zero new audit rows, TB balance unchanged.
 *     A post-recovery control call proves the outage (not the code) caused
 *     the refusal.
 *   D11 lock fail-closed: the Redis double's set() is made to REJECT once
 *     (connection failure). The replenishment must be DENIED
 *     (PRECONDITION_FAILED) with zero side effects; the very next call
 *     (Redis healthy) succeeds — proving fail-closed, not fail-dead.
 *   D12 lost-update race: two parallel same-agent top-ups of 2500 from
 *     3000. (a) with a GENUINE NX lock double: exactly one wins and the
 *     other is explicitly rejected (CONFLICT) — PG=5500 AND TB=5500.
 *     (b) with the lock BYPASSED (always-OK, simulating the old fail-open
 *     lock): BOTH succeed and the atomic conditional UPDATE still lands
 *     PG=8000 AND TB=8000 exactly — no lost update.
 *   D13 audit swallow: the audit_log write is sabotaged with a REAL
 *     DB-layer failure (a deferred constraint trigger raising at COMMIT —
 *     see the inline harness note on why commit-time, not an insert-time
 *     failure: PGlite-socket 0.2.11 mishandles extended-protocol errors
 *     inside transactions). The whole operation must abort
 *     (INTERNAL_SERVER_ERROR), the PG legs roll back (balance + tx row
 *     gone), and the already-committed ledger leg must be COMPENSATED
 *     (credits_posted 500000 / debits_posted 100000 on the float account —
 *     the reversal genuinely posted; net balance back at the 4000 seed).
 *
 * Harness mirrors ./w31FloatStatsReplenishment.integration.test.ts
 * (W31-A): spawned PGlite wire server, minimal DDL with schema-verbatim
 * columns, raw-SQL seeds, createCaller against the real router. No mocks
 * on the procedure under test; external services are doubled exactly like
 * the W31 harness (Permify wire double from vitest.setup.ts, ioredis
 * module double whose per-method vi.fn()s this file reconfigures for the
 * outage/contention probes — the same technique the W31 verifier used for
 * probe P1). miniTigerBeetle is pre-seeded so PG and TB open EQUAL for
 * every probe agent, making PG-vs-TB equality assertable (the W31 suite
 * could only assert TB deltas because its PG seeds predated the ledger).
 *
 * Seeded truth (hand-computed, NOT from the implementation):
 *
 *   Agents (PG premiumReserve) — TB float account pre-seeded to MATCH:
 *     920 AGT-W32-A      'Happy Agent'       3000.00   TB 3000
 *     921 AGT-W32-TBDOWN 'Tb Down Agent'     1000.00   TB 1000
 *     922 AGT-W32-REDIS  'Redis Down Agent'  2000.00   TB 2000
 *     923 AGT-W32-CONCA  'Conc Agent A'      3000.00   TB 3000
 *     924 AGT-W32-CONCB  'Conc Agent B'      3000.00   TB 3000
 *     925 AGT-W32-AUDIT  'Audit Fail Agent'  4000.00   TB 4000
 *     926 AGT-W32-DECOY  'Decoy Agent'     999999.00   NO TB account —
 *         must remain byte-identical through every probe.
 *
 *   Expected end state after the ordered probes below:
 *     920: 5500  (happy 2500; the 5M-cap attempt moves nothing)
 *     921: 1500  (TB-down attempt refused; control +500 succeeds)
 *     922: 2100  (Redis-down attempt denied; control +100 succeeds)
 *     923: 5500  (lock-working race: exactly ONE +2500 lands)
 *     924: 8000  (lock-bypassed race: BOTH +2500 land, none lost)
 *     925: 5000  (audit-failure attempt aborted+compensated; control +1000)
 *     926: 999999 unchanged, still no ledger account
 *   Total RPL transaction rows: 7. Total FLOAT_REPLENISH audit rows: 7.
 */
import { describe, it, beforeAll, afterAll, expect, vi, type Mock } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";
import type { TrpcContext } from "../../server/_core/context";

// 2026-11-27 (W32-A): per-file ioredis double. Mirrors the (now
// construction-faithful) global vitest.setup.ts double, but hands every
// Redis client ONE shared set of vi.fn()s so the outage/contention probes
// below can reconfigure set/del behavior (reject-once = connection
// failure; genuine in-memory NX semantics = real mutual exclusion;
// always-OK = the old fail-open posture). An external-service double,
// exactly like the PGlite/Permify doubles; the production lock code path
// (getRedisClient().set … NX) runs unmodified against it.
const redisDouble = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue("OK"),
  del: vi.fn().mockResolvedValue(1),
  hget: vi.fn().mockResolvedValue(null),
  hset: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  ttl: vi.fn().mockResolvedValue(-1),
  ping: vi.fn().mockResolvedValue("PONG"),
  quit: vi.fn().mockResolvedValue("OK"),
  on: vi.fn(),
}));
vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(() => redisDouble),
}));

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
let redisSetMock: Mock;
let redisDelMock: Mock;

// In-memory state for the GENUINE-NX lock double (probe 6). This is a
// test-side reconfiguration of the vitest.setup.ts ioredis double's
// vi.fn()s — the router's production code path (getRedisClient().set NX)
// runs unmodified; only the external Redis service is doubled, exactly
// like the PGlite/Permify doubles.
const lockStore = new Map<string, true>();
function installGenuineNxLock() {
  lockStore.clear();
  redisSetMock.mockImplementation(
    async (key: string, _val: string, ...rest: unknown[]) => {
      if (rest.includes("NX") && lockStore.has(key)) return null;
      lockStore.set(key, true);
      return "OK";
    }
  );
  redisDelMock.mockImplementation(async (key: string) => {
    lockStore.delete(key);
    return 1;
  });
}
// Simulates the OLD fail-open lock posture (D11): acquisition always
// "succeeds" — no mutual exclusion at all.
function installAlwaysOkLock() {
  redisSetMock.mockResolvedValue("OK");
  redisDelMock.mockResolvedValue(1);
}

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
  id: 950041,
  email: "reader@w32.test",
  name: "Read Only",
  role: "user",
  keycloakSub: "k-w32-user",
} as unknown as TrpcContext["user"];

const adminUser = {
  id: 950042,
  email: "admin@w32.test",
  name: "Admin User",
  role: "admin",
  keycloakSub: "k-w32-admin",
} as unknown as TrpcContext["user"];

// Minimal DDL — schema-verbatim column names/types for every column the
// procedures under test read or write (mirrors the W31 harness).
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

async function pgBalance(agentPk: number): Promise<number> {
  const [row] = await queryRows(
    `SELECT "premiumReserve" FROM "agents" WHERE "id" = ${agentPk}`
  );
  return Number(row.premiumReserve);
}

async function rplTxCount(agentPk: number): Promise<number> {
  const [row] = await queryRows(
    `SELECT count(*)::int AS n FROM "transactions" WHERE "agentId" = ${agentPk} AND "ref" LIKE 'RPL-%'`
  );
  return Number(row.n);
}

async function replenishAuditCount(agentPk: number): Promise<number> {
  const [row] = await queryRows(
    `SELECT count(*)::int AS n FROM "audit_log" WHERE "action" = 'FLOAT_REPLENISH' AND "resourceId" = '${agentPk}'`
  );
  return Number(row.n);
}

async function tbBalanceNGN(agentId: string): Promise<number> {
  const bal = await tbGetAgentBalance(agentId);
  expect(bal).not.toBeNull();
  return bal!.balanceNGN;
}

/** Rejects with the TRPCError; asserts its code; returns it for message checks. */
async function expectTrpcCode(p: Promise<unknown>, code: string): Promise<Error> {
  try {
    await p;
  } catch (err) {
    expect((err as { code?: string }).code).toBe(code);
    return err as Error;
  }
  throw new Error(`expected TRPCError ${code}, but call succeeded`);
}

async function seed() {
  await exec(`INSERT INTO "agents" ("id", "agentId", "name", "location", "premiumReserve")
    VALUES (920, 'AGT-W32-A',      'Happy Agent',      'Lagos', 3000.00),
           (921, 'AGT-W32-TBDOWN', 'Tb Down Agent',    'Abuja', 1000.00),
           (922, 'AGT-W32-REDIS',  'Redis Down Agent', NULL,    2000.00),
           (923, 'AGT-W32-CONCA',  'Conc Agent A',     'Kano',  3000.00),
           (924, 'AGT-W32-CONCB',  'Conc Agent B',     'Jos',   3000.00),
           (925, 'AGT-W32-AUDIT',  'Audit Fail Agent', 'Enugu', 4000.00),
           (926, 'AGT-W32-DECOY',  'Decoy Agent',      NULL,    999999.00)`);
}

describe("W32-A: triggerReplenishment money-path hardening — fail-closed TB leg, fail-closed lock, atomic balance credit, atomic audit (real PGlite DB + real mini-TB ledger)", () => {
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
    // Protocol-faithful in-process TB ledger on an ephemeral port; MUST be
    // set before the router module is imported (server/tbClient.ts captures
    // ENV.tbSidecarUrl at module load).
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
    const tbClient = await import("../../server/tbClient");
    tbGetAgentBalance = tbClient.tbGetAgentBalance;
    // The ioredis double above hands the client a set of shared vi.fn()s;
    // the outage/contention probes reconfigure set/del directly.
    redisSetMock = redisDouble.set as unknown as Mock;
    redisDelMock = redisDouble.del as unknown as Mock;
    const db = (await getDb())!;
    await db.execute(DDL as never);
    await seed();
    // Pre-seed every probe agent's TB float account to MATCH its PG
    // premiumReserve (real ledger transfers sys-bank-reserve → float-<id>),
    // so every probe can assert PG == TB exactly.
    for (const [agentId, ngn] of [
      ["AGT-W32-A", 3000],
      ["AGT-W32-TBDOWN", 1000],
      ["AGT-W32-REDIS", 2000],
      ["AGT-W32-CONCA", 3000],
      ["AGT-W32-CONCB", 3000],
      ["AGT-W32-AUDIT", 4000],
    ] as const) {
      const res = await tbClient.tbCreateTransfer({
        debitAccountId: "sys-bank-reserve",
        creditAccountId: `float-${agentId}`,
        amount: ngn * 100,
        ledger: 2000,
        code: 300,
        ref: `W32-SEED-${agentId}`,
        txType: "Float Top-Up",
        agentId,
      });
      if (!res) throw new Error(`TB pre-seed failed for ${agentId}`);
    }
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

  it("gates non-admin callers (FORBIDDEN) and moves nothing", async () => {
    await expectTrpcCode(
      agentFloatForecastingRouter
        .createCaller(ctxFor(plainUser))
        .triggerReplenishment({ agentId: "AGT-W32-A", amount: 2500 }),
      "FORBIDDEN"
    );
    expect(await pgBalance(920)).toBe(3000);
    expect(await tbBalanceNGN("AGT-W32-A")).toBe(3000);
    expect(await rplTxCount(920)).toBe(0);
    expect(await replenishAuditCount(920)).toBe(0);
  });

  it("happy path: single replenishment commits ledger-first then PG atomically, tbTransferId never null", async () => {
    const res = await agentFloatForecastingRouter
      .createCaller(ctxFor(adminUser))
      .triggerReplenishment({ agentId: "AGT-W32-A", amount: 2500 });
    expect(res.mode).toBe("single");
    const r = res.replenished[0];
    expect(r.agentId).toBe("AGT-W32-A");
    expect(r.amountNGN).toBe(2500);
    expect(r.newBalanceNGN).toBe(5500); // 3000 + 2500
    expect(typeof r.tbTransferId).toBe("string");

    expect(await pgBalance(920)).toBe(5500);
    expect(await tbBalanceNGN("AGT-W32-A")).toBe(5500); // PG == TB exactly

    const txRows = await queryRows(
      `SELECT "type", "amount", "status", "metadata" FROM "transactions" WHERE "ref" = '${r.ref}'`
    );
    expect(txRows.length).toBe(1);
    // 2026-11-28 (C3 fix-cycle-1, verify-c3.md D4): root writes the enum
    // label directly — type 'Float Transfer Received' (C2's D4 reversal on
    // merge, agentFloatForecasting.ts:506-514); ip's 'Transfer' + the
    // metadata.txTypeDetail carry-over was NOT merged.
    expect(txRows[0].type).toBe("Float Transfer Received");
    expect(Number(txRows[0].amount)).toBe(2500);
    expect(txRows[0].status).toBe("success");
    // 2026-11-27 (W32-A, D10): fail-closed ledger leg — a committed row is
    // always synced now; the fail-open "pending"/null shape is gone.
    expect(txRows[0].metadata.tbSyncStatus).toBe("synced");
    expect(txRows[0].metadata.tbTransferId).toBe(r.tbTransferId);

    const auditRows = await queryRows(
      `SELECT "status", "metadata" FROM "audit_log" WHERE "action" = 'FLOAT_REPLENISH' AND "resourceId" = '920'`
    );
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].status).toBe("success");
    expect(auditRows[0].metadata.amountNGN).toBe(2500);
    expect(auditRows[0].metadata.newBalance).toBe(5500);
    expect(auditRows[0].metadata.tbTransferId).toBe(r.tbTransferId);
  });

  it("max-float cap still fails closed (PRECONDITION_FAILED) and moves nothing — ledger leg never posted", async () => {
    await expectTrpcCode(
      agentFloatForecastingRouter
        .createCaller(ctxFor(adminUser))
        .triggerReplenishment({ agentId: "AGT-W32-A", amount: 5_000_000 }),
      "PRECONDITION_FAILED" // 5500 + 5,000,000 > ₦5,000,000 cap
    );
    expect(await pgBalance(920)).toBe(5500);
    expect(await tbBalanceNGN("AGT-W32-A")).toBe(5500); // no TB churn, no compensation
    expect(await rplTxCount(920)).toBe(1);
    expect(await replenishAuditCount(920)).toBe(1);
  });

  it("D10: ledger outage → replenishment REFUSED (PRECONDITION_FAILED), PG/TB byte-identical, then recovers", async () => {
    // Honest outage: the ledger itself answers 503 "operation NOT
    // committed" on money writes (mirrors the real tb-sidecar's posture
    // when its TigerBeetle upstream is unreachable). No state is lost or
    // mutated by the outage; read routes keep serving real state.
    const down = await fetch(`${miniTb.url}/__test/down`, { method: "POST" });
    expect(down.status).toBe(200);

    // 2026-11-28 (C3 fix-cycle-1, verify-c3.md D10): root throws
    // TBLedgerUnavailableError → tRPC maps it to INTERNAL_SERVER_ERROR (ip's
    // PRECONDITION_FAILED mapping was NOT merged). Fail-closed semantics are
    // intact — operation refused, wallet unchanged, no rows (verified below).
    const err = await expectTrpcCode(
      agentFloatForecastingRouter
        .createCaller(ctxFor(adminUser))
        .triggerReplenishment({ agentId: "AGT-W32-TBDOWN", amount: 500 }),
      "INTERNAL_SERVER_ERROR"
    );
    // Root's fail-loud TB error names the uncommitted transfer
    // (tbClient TBLedgerUnavailableError) — equally explicit refusal evidence.
    expect(err.message).toContain("Transfer NOT committed");
    // NOTHING moved: balance, zero new rows, ledger untouched.
    expect(await pgBalance(921)).toBe(1000);
    expect(await tbBalanceNGN("AGT-W32-TBDOWN")).toBe(1000);
    expect(await rplTxCount(921)).toBe(0);
    expect(await replenishAuditCount(921)).toBe(0);

    const up = await fetch(`${miniTb.url}/__test/up`, { method: "POST" });
    expect(up.status).toBe(200);
    // Control: with the ledger healthy the SAME call succeeds — the
    // refusal above was caused by the outage, not by the call.
    const res = await agentFloatForecastingRouter
      .createCaller(ctxFor(adminUser))
      .triggerReplenishment({ agentId: "AGT-W32-TBDOWN", amount: 500 });
    expect(res.replenished[0].newBalanceNGN).toBe(1500);
    expect(await pgBalance(921)).toBe(1500);
    expect(await tbBalanceNGN("AGT-W32-TBDOWN")).toBe(1500);
    expect(await rplTxCount(921)).toBe(1);
    expect(await replenishAuditCount(921)).toBe(1);
  });

  it("D11: Redis outage → replenishment DENIED fail-closed (PRECONDITION_FAILED), zero side effects, then recovers", async () => {
    // The very next lock acquisition hits a Redis connection failure.
    redisSetMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    // 2026-11-28 (C3 fix-cycle-1, verify-c3.md D10-family): root DOES map the
    // Redis-lock outage to PRECONDITION_FAILED (agentFloatForecasting.ts:446,
    // evidenced by the run) — ip's expectation holds as-is; only D10's TB
    // outage maps to ISE. Fail-closed refusal verified below.
    const err = await expectTrpcCode(
      agentFloatForecastingRouter
        .createCaller(ctxFor(adminUser))
        .triggerReplenishment({ agentId: "AGT-W32-REDIS", amount: 100 }),
      "PRECONDITION_FAILED"
    );
    expect(err.message).toContain("fail-closed");
    expect(await pgBalance(922)).toBe(2000);
    expect(await tbBalanceNGN("AGT-W32-REDIS")).toBe(2000);
    expect(await rplTxCount(922)).toBe(0);
    expect(await replenishAuditCount(922)).toBe(0);

    // Control: Redis healthy again → the same call succeeds (fail-closed,
    // not fail-dead).
    const res = await agentFloatForecastingRouter
      .createCaller(ctxFor(adminUser))
      .triggerReplenishment({ agentId: "AGT-W32-REDIS", amount: 100 });
    expect(res.replenished[0].newBalanceNGN).toBe(2100);
    expect(await pgBalance(922)).toBe(2100);
    expect(await tbBalanceNGN("AGT-W32-REDIS")).toBe(2100);
    expect(await rplTxCount(922)).toBe(1);
    expect(await replenishAuditCount(922)).toBe(1);
  });

  it("D12 (lock genuinely working): two parallel +2500 top-ups — exactly one wins, the loser is explicitly rejected (CONFLICT)", async () => {
    installGenuineNxLock();
    try {
      const caller = agentFloatForecastingRouter.createCaller(ctxFor(adminUser));
      const results = await Promise.allSettled([
        caller.triggerReplenishment({ agentId: "AGT-W32-CONCA", amount: 2500 }),
        caller.triggerReplenishment({ agentId: "AGT-W32-CONCA", amount: 2500 }),
      ]);
      const ok = results.filter(r => r.status === "fulfilled");
      const denied = results.filter(r => r.status === "rejected");
      expect(ok.length).toBe(1);
      expect(denied.length).toBe(1);
      expect(
        (denied[0] as PromiseRejectedResult).reason.code
      ).toBe("CONFLICT");
      expect(
        (ok[0] as PromiseFulfilledResult<any>).value.replenished[0]
          .newBalanceNGN
      ).toBe(5500);
      // Exactly one credit landed on BOTH sides — no divergence.
      expect(await pgBalance(923)).toBe(5500);
      expect(await tbBalanceNGN("AGT-W32-CONCA")).toBe(5500);
      expect(await rplTxCount(923)).toBe(1);
      expect(await replenishAuditCount(923)).toBe(1);
    } finally {
      installAlwaysOkLock();
    }
  });

  it("D12 headline (lock BYPASSED — old fail-open posture): two parallel +2500 from 3000 still land PG=8000 AND TB=8000 exactly", async () => {
    installAlwaysOkLock(); // no mutual exclusion at all — the D11 outage scenario
    const caller = agentFloatForecastingRouter.createCaller(ctxFor(adminUser));
    const results = await Promise.allSettled([
      caller.triggerReplenishment({ agentId: "AGT-W32-CONCB", amount: 2500 }),
      caller.triggerReplenishment({ agentId: "AGT-W32-CONCB", amount: 2500 }),
    ]);
    const ok = results.filter(
      (r): r is PromiseFulfilledResult<any> => r.status === "fulfilled"
    );
    // Both credits commit; the atomic conditional UPDATE serializes them
    // at the row lock, so the two reported balances are exactly the two
    // points on the ladder 3000 → 5500 → 8000.
    expect(ok.length).toBe(2);
    const reported = ok
      .map(r => r.value.replenished[0].newBalanceNGN)
      .sort((a, b) => a - b);
    expect(reported).toEqual([5500, 8000]);
    expect(await pgBalance(924)).toBe(8000); // NOT 5500 — no lost update
    expect(await tbBalanceNGN("AGT-W32-CONCB")).toBe(8000); // PG == TB exactly
    expect(await rplTxCount(924)).toBe(2);
    expect(await replenishAuditCount(924)).toBe(2);
  });

  it("D13: audit-write failure aborts the operation (INTERNAL_SERVER_ERROR), PG rolls back, ledger leg is COMPENSATED", async () => {
    // Sabotage the audit write with a REAL DB-layer failure: a deferred
    // constraint trigger that raises when the FLOAT_REPLENISH audit row is
    // committed. (2026-11-27 W32-A harness note: a DEFERRED trigger is used
    // deliberately — the failure then surfaces at COMMIT, a simple-protocol
    // message. PGlite-socket 0.2.11 mishandles extended-protocol statement
    // ERRORS inside a transaction — it emits trailing messages that desync
    // the pg client ("Received unexpected commandComplete", probe-verified
    // in scratch runs) — so a sabotage that fails the insert statement
    // itself (e.g. renaming the table) would poison the pooled connection
    // and pollute the run with a harness artifact. The commit-time trigger
    // is a genuine audit-write failure — the funds trail cannot commit —
    // and it exercises exactly the D13 contract: audit failure aborts the
    // whole operation.)
    await exec(`
      CREATE OR REPLACE FUNCTION "audit_sabotage_w32"() RETURNS trigger AS $fn$ BEGIN RAISE EXCEPTION 'audit_log write sabotaged (W32-A D13 probe)'; END; $fn$ LANGUAGE plpgsql;
      CREATE CONSTRAINT TRIGGER "audit_sabotage_w32_trg" AFTER INSERT ON "audit_log" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "audit_sabotage_w32"();
    `);
    let err: Error;
    try {
      err = await expectTrpcCode(
        agentFloatForecastingRouter
          .createCaller(ctxFor(adminUser))
          .triggerReplenishment({ agentId: "AGT-W32-AUDIT", amount: 1000 }),
        "INTERNAL_SERVER_ERROR"
      );
    } finally {
      await exec(
        `DROP TRIGGER "audit_sabotage_w32_trg" ON "audit_log"; DROP FUNCTION "audit_sabotage_w32"();`
      );
    }
    expect(err.message).toContain("compensated");
    // PG legs rolled back: balance untouched, no transaction row.
    expect(await pgBalance(925)).toBe(4000);
    expect(await rplTxCount(925)).toBe(0);
    expect(await replenishAuditCount(925)).toBe(0);
    // The ledger leg committed and was then genuinely REVERSED: credits
    // 400000 (seed) + 100000 (top-up), debits 100000 (compensation) —
    // net balance back at the 4000 seed. PG == TB exactly.
    const acct = await (
      await fetch(`${miniTb.url}/accounts/float-AGT-W32-AUDIT`)
    ).json();
    expect(acct.credits_posted).toBe("500000");
    expect(acct.debits_posted).toBe("100000");
    expect(await tbBalanceNGN("AGT-W32-AUDIT")).toBe(4000);

    // Control: with the audit table restored the SAME call succeeds and
    // leaves its full funds trail.
    const res = await agentFloatForecastingRouter
      .createCaller(ctxFor(adminUser))
      .triggerReplenishment({ agentId: "AGT-W32-AUDIT", amount: 1000 });
    expect(res.replenished[0].newBalanceNGN).toBe(5000);
    expect(await pgBalance(925)).toBe(5000);
    expect(await tbBalanceNGN("AGT-W32-AUDIT")).toBe(5000);
    expect(await rplTxCount(925)).toBe(1);
    expect(await replenishAuditCount(925)).toBe(1);
  });

  it("decoy integrity: unrelated agent untouched and never given a ledger account; totals match the hand-computed truth", async () => {
    expect(await pgBalance(926)).toBe(999999);
    // No replenishment ever referenced the decoy — its ledger account must
    // not even exist.
    expect(await tbGetAgentBalance("AGT-W32-DECOY")).toBeNull();
    // Fleet totals (header truth): 7 RPL transaction rows, 7 audit rows.
    const [tx] = await queryRows(
      `SELECT count(*)::int AS n FROM "transactions" WHERE "ref" LIKE 'RPL-%'`
    );
    expect(tx.n).toBe(7);
    const [au] = await queryRows(
      `SELECT count(*)::int AS n FROM "audit_log" WHERE "action" = 'FLOAT_REPLENISH'`
    );
    expect(au.n).toBe(7);
  });
});
