/**
 * w32cContractDrift.integration.test.ts — W32-C (2026-11-27)
 * REAL-DB (PGlite) integration tests for the server procedures added by the
 * W32-C client↔server contract-drift closeout:
 *
 *   1. premiumTopUp.supervisorPendingTopUps / supervisorApproveTopUp
 *      (namespace-drift fix: server/routers.ts now registers the REAL
 *      premiumTopUp implementation from server/routers/floatTopUp.ts under
 *      the `premiumTopUp` namespace, matching main's wiring).
 *   2. insuranceServiceFleet.getStats (ported from main's
 *      server/routers/insuranceServiceFleet.ts — real pos_terminals status
 *      aggregate).
 *   3. chaosEngineeringConsole.getStats (contract ported from main; body is
 *      a documented adaptation — real CHAOS_% audit-log aggregates instead
 *      of main's health-check stub zeros).
 *   4. simOrchestrator.getConfig / getCarrierSummary (ported from main;
 *      main's ts-nocheck `simProbeLog.agentCode` corrected to the real
 *      `agentId` column — see router header note).
 *   5. analyticsQuery.getTransactionMetrics — DB fallback arm (real PGlite)
 *      PLUS the OpenSearch arm served by an in-process HTTP wire-protocol
 *      double (the production fetch path runs unmodified, exactly like the
 *      Permify wire double in vitest.setup.ts) proving the new real
 *      `totalCount` comes from hits.total and that `recentEntries` stays
 *      honestly ABSENT on the opensearch arm.
 *
 * Harness mirrors ./w31FloatStatsReplenishment.integration.test.ts: spawned
 * PGlite wire server, minimal DDL with schema-verbatim column names/types
 * for every column the queries touch, raw-SQL seeds, createCaller against
 * the real routers. No mocks on the procedures under test. Permify is the
 * vitest.setup.ts wire-protocol double (CHECK_RESULT_ALLOWED); Redis and
 * Kafka are the vitest.setup.ts module doubles. Agent sessions are REAL
 * jose JWTs minted with the same JWT_SECRET getAgentFromCookie verifies —
 * no middleware double.
 *
 * Seeded truth (hand-computed from the seeds below, NOT from the
 * implementation):
 *
 *   Agents:
 *     920 AGT-W32-SUP 'Sup One'     (the supervisor's own user row)
 *     921 AGT-W32-A1  'Agent One'   premiumReserve 1000.00, tier Gold
 *     922 AGT-W32-A2  'Agent Two'   premiumReserve    0.00, tier Bronze
 *     923 AGT-W32-A3  'Agent Three' (NOT assigned to supervisor 920)
 *   supervisor_agents: (920→921), (920→922)
 *   float_topup_requests:
 *     5001 agent 921,  60000.00, pending,  required=true
 *     5002 agent 922,  75000.00, pending,  required=true
 *     5003 agent 923,  99000.00, pending,  required=true  (decoy for the
 *                                                       supervisor scope;
 *                                                       visible to admin)
 *     5004 agent 921,   5000.00, pending,  required=false (decoy: not req.)
 *     5005 agent 921,  80000.00, approved, required=true  (decoy: status)
 *   Truth: supervisor 920 sees [5001, 5002]; admin sees [5001, 5002, 5003].
 *   Approve 5001 (supervisor) → supervisorApprovedBy '920' (root merge fix:
 *   numeric agents PK — see test body for the C3 dated note),
 *     notes append, FLOAT_TOPUP_SUPERVISOR_APPROVED audit row; approve 5003
 *     as supervisor → FORBIDDEN; approve 5003 as admin → success (override);
 *     approve 5005 → BAD_REQUEST (already approved); unknown id → NOT_FOUND.
 *
 *   pos_terminals: 2 active + 1 deleted-but-active + 1 inactive +
 *     1 maintenance + 1 unassigned + 1 decommissioned = 7 rows.
 *   Truth: total 7, active 3, inactive 1, maintenance 1, unassigned 1.
 *     (The byte-exact main port has NO deletedAt filter — the deleted row
 *     counts in total, matching main's getStats semantics.)
 *
 *   CHAOS_% audit rows: running@now, completed@now-1d, pending@now-2d,
 *     failed@now-10d; decoy USER_LOGIN(status running)@now.
 *   Truth: total 4, active 2 (running+pending), recent 3 (7d window),
 *     lastUpdated = newest CHAOS row.
 *
 *   sim_orchestrator_config: TERM-W32-1 (15000ms, relay w32, key w32-key-1,
 *     enabled) + TERM-W32-OFF (disabled, key w32-key-2).
 *   sim_probe_log for AGT-W32-SIM (trailing 24h):
 *     Phys1/MTN:    score 80 rssi 20 lat 100 sel true  reg 1 @now-1h
 *                   score 60 rssi 30 lat 200 sel false reg 5 @now-2h
 *     ESim1/Airtel: score 50 rssi 40 lat 300 sel false reg 0 @now-3h
 *   Decoys: Phys1/MTN score 10 @now-48h (window), AGT-OTHER score 99 @now
 *     (agent filter).
 *   Truth (score-desc): Phys1/MTN avg 70.0/25.0/150 sel 1/2 reg 100.0;
 *     ESim1/Airtel avg 50.0/40.0/300 sel 0/1 reg 0.0.
 *
 *   platform_billing_ledger (getTransactionMetrics DB arm, days=30):
 *     100.00 @now-1d, 200.00 @now-2d, 50.00 @now-3d → totalVolume 350,
 *     totalCount 3, avgAmount 350/3 ≈ 116.6667, recentEntries newest-first.
 *   Decoy: 99999.00 @now-40d (outside the window).
 */
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import net from "net";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { SignJWT } from "jose";
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
let osDouble: http.Server;
let osDoublePort: number;
let getDb: typeof import("../../server/db").getDb;
let getPool: typeof import("../../server/db").getPool;
let floatTopUpRouter: typeof import("../../server/routers/floatTopUp").premiumTopUpRouter;
let fleetRouter: typeof import("../../server/routers/insuranceServiceFleet").insuranceServiceFleetRouter;
let chaosRouter: typeof import("../../server/routers/chaosEngineeringConsole").chaosEngineeringConsoleRouter;
let simRouter: typeof import("../../server/routers/simOrchestrator").simOrchestratorRouter;
let analyticsRouter: typeof import("../../server/routers/analyticsQuery").analyticsQueryRouter;

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

function ctxFor(user: TrpcContext["user"], cookie?: string) {
  return {
    req: {
      headers: cookie ? { cookie } : {},
      socket: { remoteAddress: "127.0.0.1" },
    },
    res: {},
    user,
  } as unknown as TrpcContext;
}

const plainUser = {
  id: 950041,
  email: "reader@w32c.test",
  name: "Read Only",
  role: "user",
  keycloakSub: "k-w32c-user",
} as unknown as TrpcContext["user"];

const adminUser = {
  id: 950042,
  email: "admin@w32c.test",
  name: "Admin User",
  role: "admin",
  keycloakSub: "k-w32c-admin",
} as unknown as TrpcContext["user"];

/** Real jose JWT exactly as the agent-session cookie carries it — verified
 *  by the production getAgentFromCookie (no middleware double). */
async function mintAgentCookie(session: {
  sub: number;
  agentId: string;
  name: string;
  tier: string;
  role: string;
}): Promise<string> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
  const token = await new SignJWT({
    agentId: session.agentId,
    name: session.name,
    tier: session.tier,
    role: session.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(session.sub))
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
  return `agent_session=${token}`;
}

// Minimal DDL — schema-verbatim column names/types for every column the
// procedures under test read or write. FKs omitted (documented K-wave
// harness convention): the queries join by value, not by constraint.
const DDL = `
CREATE TABLE IF NOT EXISTS "agents" (
  "id" serial PRIMARY KEY,
  "agentId" varchar(32) NOT NULL,
  "name" varchar(128) NOT NULL,
  "phone" varchar(20) DEFAULT '' NOT NULL,
  "pinHash" varchar(128) DEFAULT '' NOT NULL,
  "location" varchar(128),
  "tier" varchar(32) DEFAULT 'Bronze' NOT NULL,
  "role" varchar(32) DEFAULT 'agent' NOT NULL,
  "premiumReserve" numeric(15,2) DEFAULT '0.00' NOT NULL,
  "isActive" boolean DEFAULT true NOT NULL,
  "deletedAt" timestamp,
  -- 2026-11-28 (C3 fix-cycle-1, verify-c3.md D8/D9): complete the ported
  -- minimal DDL — root's supervisor procedures resolve the caller via
  -- getAgentFromCookie → getAgentById, a FULL-ROW select() that enumerates
  -- every agents column (server/db.ts:402-412); any missing column errors
  -- the query, the cookie resolves to no session, and every supervisor call
  -- fails UNAUTHORIZED. All nullable/default placeholders — the 12-column
  -- seed insert is unaffected.
  "email" varchar(320),
  "terminalModel" varchar(64) DEFAULT 'PAX A920 MAX',
  "terminalSerial" varchar(64),
  "failedPinAttempts" integer DEFAULT 0 NOT NULL,
  "pinLockedUntil" timestamp,
  "floatLimit" numeric(15,2) DEFAULT '1000000.00' NOT NULL,
  "commissionBalance" numeric(15,2) DEFAULT '0.00' NOT NULL,
  "loyaltyPoints" integer DEFAULT 0 NOT NULL,
  "streak" integer DEFAULT 0 NOT NULL,
  "rank" integer DEFAULT 0,
  "floatLocked" boolean DEFAULT false NOT NULL,
  "terminalEnabled" boolean DEFAULT true NOT NULL,
  "terminalDisabledReason" text,
  "lastLoginAt" timestamp,
  "tenantId" integer,
  "creditScore" integer DEFAULT 0,
  "creditLimit" numeric(15,2) DEFAULT '0.00',
  "creditRating" varchar(16) DEFAULT 'N/A',
  "parentAgentId" integer,
  "hierarchyRole" varchar(32) DEFAULT 'agent',
  "hierarchyLevel" integer DEFAULT 3,
  "commissionSplitOverride" numeric(5,2),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "supervisor_agents" (
  "id" serial PRIMARY KEY,
  "supervisorId" integer,
  "supervisorUserId" integer,
  "agentId" integer NOT NULL,
  "assignedAt" timestamp DEFAULT now() NOT NULL,
  "removedAt" timestamp
);
CREATE TABLE IF NOT EXISTS "float_topup_requests" (
  "id" serial PRIMARY KEY,
  "agentId" integer NOT NULL,
  "requestedAmount" numeric(15,2) NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "approvedBy" varchar(64),
  "notes" text,
  "supervisorApprovalRequired" boolean DEFAULT false NOT NULL,
  "supervisorApprovedBy" varchar(64),
  "supervisorApprovedAt" timestamp,
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
CREATE TABLE IF NOT EXISTS "pos_terminals" (
  "id" serial PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "terminalId" varchar(64) NOT NULL UNIQUE,
  "status" varchar(32) DEFAULT 'active' NOT NULL,
  "deletedAt" timestamp
);
CREATE TABLE IF NOT EXISTS "sim_orchestrator_config" (
  "id" serial PRIMARY KEY,
  "terminalId" varchar(32) NOT NULL UNIQUE,
  "probeIntervalMs" integer DEFAULT 30000 NOT NULL,
  "relayEndpoint" varchar(256) DEFAULT 'https://api.insureportal.ng/api/trpc/simOrchestrator.ingestProbe' NOT NULL,
  "apiKey" varchar(128) DEFAULT 'insureportal-sim-orchestrator-default-key' NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "sim_probe_log" (
  "id" serial PRIMARY KEY,
  "agentId" varchar(32) NOT NULL,
  "terminalId" varchar(32) NOT NULL,
  "slot" varchar(8) NOT NULL,
  "carrier" varchar(32) NOT NULL,
  "mccMnc" integer NOT NULL,
  "rssi" integer NOT NULL,
  "regStatus" integer NOT NULL,
  "latencyMs" integer NOT NULL,
  "packetLossX10" integer NOT NULL,
  "score" integer NOT NULL,
  "selected" boolean DEFAULT false NOT NULL,
  "latE6" integer,
  "lonE6" integer,
  "fwVersion" varchar(16),
  "probedAt" timestamp NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "platform_billing_ledger" (
  "id" serial PRIMARY KEY,
  "transaction_id" integer NOT NULL,
  "transaction_ref" varchar(64) NOT NULL,
  "transaction_type" varchar(32) NOT NULL,
  "agent_id" integer NOT NULL,
  "policy_transaction_id" integer,
  "gross_amount" numeric(15,2) NOT NULL,
  "gross_fee" numeric(12,2) DEFAULT '0' NOT NULL,
  "agent_commission" numeric(12,2) DEFAULT '0' NOT NULL,
  "switch_fee" numeric(12,2) DEFAULT '0' NOT NULL,
  "aggregator_fee" numeric(12,2) DEFAULT '0' NOT NULL,
  "platform_net_fee" numeric(12,2) DEFAULT '0' NOT NULL,
  "billing_model" varchar(32) DEFAULT 'revenue_share' NOT NULL,
  "client_revenue" numeric(12,2) DEFAULT '0' NOT NULL,
  "platform_revenue" numeric(12,2) DEFAULT '0' NOT NULL,
  "revenue_share_pct" numeric(5,2),
  "currency" varchar(3) DEFAULT 'NGN' NOT NULL,
  "region" varchar(32),
  "carrier" varchar(32),
  "tigerbeetle_transfer_id" varchar(64),
  "kafka_offset" varchar(64),
  "platform_share" numeric(12,2),
  "client_share" numeric(12,2),
  "tenant_id" integer,
  "processed_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
`;

async function exec(sql: string, params?: unknown[]) {
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

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();
// Seeded newest CHAOS_% timestamp — captured during seed() for the
// lastUpdated equality assertion (drizzle reads timestamp-without-tz back
// as the same UTC wall-clock the seed wrote, so exact ISO equality holds).
let chaosNewestISO = "";

async function seed() {
  // ── Site 1: agents / supervisor assignments / float top-up requests ──────
  await exec(`INSERT INTO "agents" ("id", "agentId", "name", "premiumReserve", "tier") VALUES
    (920, 'AGT-W32-SUP', 'Sup One',     0.00,    'Bronze'),
    (921, 'AGT-W32-A1',  'Agent One',   1000.00, 'Gold'),
    (922, 'AGT-W32-A2',  'Agent Two',   0.00,    'Bronze'),
    (923, 'AGT-W32-A3',  'Agent Three', 0.00,    'Bronze'),
    -- 2026-11-28 (C3 fix-cycle-1, verify-c3.md D8/D9): root's G3 session check
    -- (agentAuth.ts:128-136) resolves the cookie via getAgentById and requires
    -- an ACTIVE, non-deleted agents row — without these rows the session is
    -- null and every supervisor call fails UNAUTHORIZED. 955 has deliberately
    -- NO supervisor_agents assignment; 999 is the admin override principal.
    (955, 'AGT-W32-LONE', 'Lone Sup',   0.00,    'Bronze'),
    (999, 'AGT-W32-ADM',  'Admin',      0.00,    'Bronze')`);
  await exec(`INSERT INTO "supervisor_agents" ("id", "supervisorUserId", "agentId") VALUES
    (1, 920, 921),
    (2, 920, 922)`);
  await exec(`INSERT INTO "float_topup_requests" ("id", "agentId", "requestedAmount", "status", "supervisorApprovalRequired") VALUES
    (5001, 921,  60000.00, 'pending',  true),
    (5002, 922,  75000.00, 'pending',  true),
    (5003, 923,  99000.00, 'pending',  true),
    (5004, 921,   5000.00, 'pending',  false),
    (5005, 921,  80000.00, 'approved', true)`);

  // ── Site 2: pos_terminals fleet ──────────────────────────────────────────
  await exec(`INSERT INTO "pos_terminals" ("id", "tenantId", "terminalId", "status", "deletedAt") VALUES
    (1, 1, 'T-W32-001', 'active',        NULL),
    (2, 1, 'T-W32-002', 'active',        NULL),
    (3, 1, 'T-W32-003', 'inactive',      NULL),
    (4, 1, 'T-W32-004', 'maintenance',   NULL),
    (5, 1, 'T-W32-005', 'unassigned',    NULL),
    (6, 1, 'T-W32-006', 'decommissioned', NULL),
    (7, 1, 'T-W32-007', 'active',        now())`);

  // ── Site 3: chaos experiment audit rows (metadata.status read-model) ─────
  const nowMs = Date.now();
  chaosNewestISO = iso(nowMs);
  await exec(`INSERT INTO "audit_log" ("action", "resource", "status", "metadata", "createdAt") VALUES
    ('CHAOS_EXPERIMENT_STARTED',  'chaos_engineering', 'success', '{"status":"running","experimentType":"pod_kill"}', '${chaosNewestISO}'),
    ('CHAOS_EXPERIMENT_FINISHED', 'chaos_engineering', 'success', '{"status":"completed","experimentType":"cpu_stress"}', '${iso(nowMs - DAY)}'),
    ('CHAOS_EXPERIMENT_QUEUED',   'chaos_engineering', 'warning', '{"status":"pending","experimentType":"error_injection"}', '${iso(nowMs - 2 * DAY)}'),
    ('CHAOS_EXPERIMENT_OLD',      'chaos_engineering', 'failure', '{"status":"failed","experimentType":"pod_kill"}', '${iso(nowMs - 10 * DAY)}'),
    ('USER_LOGIN',                'auth',              'success', '{"status":"running"}', '${iso(nowMs)}')`);

  // ── Site 4: SIM orchestrator config + probe log ──────────────────────────
  await exec(`INSERT INTO "sim_orchestrator_config" ("terminalId", "probeIntervalMs", "relayEndpoint", "apiKey", "enabled") VALUES
    ('TERM-W32-1',   15000, 'https://relay.w32.example/ingest', 'w32-key-1', true),
    ('TERM-W32-OFF',  60000, 'https://relay.w32.example/off',   'w32-key-2', false)`);
  const probe = (
    agentId: string,
    slot: string,
    carrier: string,
    score: number,
    rssi: number,
    latency: number,
    selected: boolean,
    reg: number,
    at: string
  ) =>
    `('${agentId}', 'TERM-W32-1', '${slot}', '${carrier}', 12345, ${rssi}, ${reg}, ${latency}, 0, ${score}, ${selected}, '${at}')`;
  await exec(
    `INSERT INTO "sim_probe_log" ("agentId", "terminalId", "slot", "carrier", "mccMnc", "rssi", "regStatus", "latencyMs", "packetLossX10", "score", "selected", "probedAt") VALUES ` +
      [
        probe("AGT-W32-SIM", "Phys1", "MTN", 80, 20, 100, true, 1, iso(nowMs - HOUR)),
        probe("AGT-W32-SIM", "Phys1", "MTN", 60, 30, 200, false, 5, iso(nowMs - 2 * HOUR)),
        probe("AGT-W32-SIM", "ESim1", "Airtel", 50, 40, 300, false, 0, iso(nowMs - 3 * HOUR)),
        // Decoys: outside the 24h window / different agent.
        probe("AGT-W32-SIM", "Phys1", "MTN", 10, 90, 999, false, 0, iso(nowMs - 48 * HOUR)),
        probe("AGT-OTHER", "Phys2", "MTN", 99, 10, 50, true, 1, iso(nowMs)),
      ].join(", ")
  );

  // ── Site 5: platform billing ledger (analytics DB fallback arm) ──────────
  const ledger = (id: number, amount: string, at: string) =>
    `(${id}, ${1000 + id}, 'W32-REF-${id}', 'Cash In', 921, ${amount}, '${at}')`;
  await exec(
    `INSERT INTO "platform_billing_ledger" ("id", "transaction_id", "transaction_ref", "transaction_type", "agent_id", "gross_amount", "created_at") VALUES ` +
      [
        ledger(1, "100.00", iso(nowMs - DAY)),
        ledger(2, "200.00", iso(nowMs - 2 * DAY)),
        ledger(3, "50.00", iso(nowMs - 3 * DAY)),
        // Decoy: outside the 30-day window.
        ledger(4, "99999.00", iso(nowMs - 40 * DAY)),
      ].join(", ")
  );
}

describe("W32-C: contract-drift server procedure ports (real PGlite DB + wire doubles)", () => {
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
    // Real secret for real jose mint/verify (getJwtSecret reads env per call).
    process.env.JWT_SECRET = "w32c-test-secret-do-not-use-in-prod";
    // Fail-closed default for the OpenSearch arm: an unreachable endpoint
    // forces the DB fallback unless a test points at the wire double.
    process.env.OPENSEARCH_ENDPOINT = "http://127.0.0.1:1";

    const dbMod = await import("../../server/db");
    getDb = dbMod.getDb;
    getPool = dbMod.getPool;
    // 2026-11-28 (C3 port adaptation): C2 consumed floatTopUp.ts into
    // server/routers/premiumTopUp.ts — import the merged module (same
    // premiumTopUpRouter export).
    ({ premiumTopUpRouter: floatTopUpRouter } = await import(
      "../../server/routers/premiumTopUp"
    ));
    ({ insuranceServiceFleetRouter: fleetRouter } = await import(
      "../../server/routers/insuranceServiceFleet"
    ));
    ({ chaosEngineeringConsoleRouter: chaosRouter } = await import(
      "../../server/routers/chaosEngineeringConsole"
    ));
    ({ simOrchestratorRouter: simRouter } = await import(
      "../../server/routers/simOrchestrator"
    ));
    ({ analyticsQueryRouter: analyticsRouter } = await import(
      "../../server/routers/analyticsQuery"
    ));
    const db = (await getDb())!;
    await db.execute(DDL as never);
    await seed();

    // OpenSearch wire-protocol double: answers POST /transactions/_search
    // with a canned aggregation response. The production fetch path
    // (queryOpenSearch → fetch → parse) runs unmodified — same harness
    // posture as the Permify double in vitest.setup.ts.
    osDouble = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/transactions/_search") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            hits: { total: { value: 20, relation: "eq" }, hits: [] },
            aggregations: {
              total_volume: { value: 5000 },
              avg_amount: { value: 250 },
              by_status: {
                buckets: [{ key: "success", doc_count: 20 }],
              },
              by_day: {
                buckets: [
                  {
                    key_as_string: "2026-11-26",
                    daily_volume: { value: 5000 },
                    doc_count: 20,
                  },
                ],
              },
            },
          })
        );
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
    });
    osDoublePort = await new Promise<number>((resolve, reject) => {
      osDouble.once("error", reject);
      osDouble.listen(0, "127.0.0.1", () => {
        const addr = osDouble.address();
        if (addr && typeof addr === "object") resolve(addr.port);
        else reject(new Error("os double bind failed"));
      });
    });
  }, 120_000);

  afterAll(async () => {
    try {
      const pool = await getPool?.();
      await pool?.end();
    } catch {
      // best-effort cleanup; teardown must not mask a test failure
    }
    if (osDouble) {
      await new Promise<void>(resolve => osDouble.close(() => resolve()));
    }
    child?.kill("SIGTERM");
  });

  // ══ 1. premiumTopUp supervisor procedures (namespace-drift fix) ══════════
  const supervisorCookie = () =>
    mintAgentCookie({
      sub: 920,
      agentId: "AGT-W32-SUP",
      name: "Sup One",
      tier: "Bronze",
      role: "supervisor",
    });
  const adminCookie = () =>
    mintAgentCookie({
      sub: 999,
      agentId: "AGT-W32-ADM",
      name: "Admin",
      tier: "Bronze",
      role: "admin",
    });

  it("supervisorPendingTopUps returns only required+pending rows for the supervisor's own agents", async () => {
    const res = await floatTopUpRouter
      .createCaller(ctxFor(plainUser, await supervisorCookie()))
      .supervisorPendingTopUps();
    const ids = res.map((r: any) => r.id).sort();
    expect(ids).toEqual([5001, 5002]);
    const r1 = res.find((r: any) => r.id === 5001)!;
    expect(r1.requestedAmount).toBe(60000);
    expect(r1.agentName).toBe("Agent One");
    expect(r1.agentUserId).toBe("AGT-W32-A1");
    expect(r1.agentFloat).toBe(1000);
    expect(r1.agentTier).toBe("Gold");
  });

  it("supervisorPendingTopUps for admin sees ALL required+pending rows (incl. unassigned-agent decoy)", async () => {
    const res = await floatTopUpRouter
      .createCaller(ctxFor(plainUser, await adminCookie()))
      .supervisorPendingTopUps();
    expect(res.map((r: any) => r.id).sort()).toEqual([5001, 5002, 5003]);
  });

  it("supervisorPendingTopUps: supervisor with no assignments returns [] (fail-closed scope)", async () => {
    const cookie = await mintAgentCookie({
      sub: 955,
      agentId: "AGT-W32-LONE",
      name: "Lone Sup",
      tier: "Bronze",
      role: "supervisor",
    });
    const res = await floatTopUpRouter
      .createCaller(ctxFor(plainUser, cookie))
      .supervisorPendingTopUps();
    expect(res).toEqual([]);
  });

  it("supervisor procedures reject missing session (UNAUTHORIZED), agent role (FORBIDDEN), and unauthenticated tRPC user (UNAUTHORIZED)", async () => {
    await expectTrpcCode(
      floatTopUpRouter
        .createCaller(ctxFor(plainUser))
        .supervisorPendingTopUps(),
      "UNAUTHORIZED"
    );
    const agentCookie = await mintAgentCookie({
      sub: 921,
      agentId: "AGT-W32-A1",
      name: "Agent One",
      tier: "Gold",
      role: "agent",
    });
    await expectTrpcCode(
      floatTopUpRouter
        .createCaller(ctxFor(plainUser, agentCookie))
        .supervisorPendingTopUps(),
      "FORBIDDEN"
    );
    await expectTrpcCode(
      floatTopUpRouter
        .createCaller(ctxFor(null, await supervisorCookie()))
        .supervisorPendingTopUps(),
      "UNAUTHORIZED"
    );
  });

  it("supervisorApproveTopUp approves 5001: row updated + audit row written", async () => {
    const res = await floatTopUpRouter
      .createCaller(ctxFor(plainUser, await supervisorCookie()))
      .supervisorApproveTopUp({ requestId: 5001, notes: "ok" });
    expect(res.success).toBe(true);

    const [row] = await queryRows(
      `SELECT "supervisorApprovedBy", "supervisorApprovedAt", "notes", "status" FROM "float_topup_requests" WHERE "id" = 5001`
    );
    // 2026-11-28 (C3 fix-cycle-1, verify-c3.md): root's deliberate merge fix
    // (premiumTopUp.ts:663-669) writes the numeric agents PK — agent CODE was
    // ip-side and could collide across tenants / not join back to agents.id.
    expect(row.supervisorApprovedBy).toBe("920");
    expect(row.supervisorApprovedAt).not.toBeNull();
    expect(String(row.notes)).toContain("Supervisor note: ok");
    // Documented flow semantics: the supervisor approval is recorded on the
    // request; the STATUS stays 'pending' until admin credits the float.
    expect(row.status).toBe("pending");

    const audit = await queryRows(
      `SELECT "action", "resourceId", "metadata" FROM "audit_log" WHERE "action" = 'FLOAT_TOPUP_SUPERVISOR_APPROVED'`
    );
    expect(audit.length).toBe(1);
    expect(audit[0].resourceId).toBe("5001");
    expect(Number(audit[0].metadata.amount)).toBe(60000);
    expect(Number(audit[0].metadata.targetAgentId)).toBe(921);
  });

  it("supervisorApproveTopUp: unassigned agent → FORBIDDEN; admin override → success", async () => {
    await expectTrpcCode(
      floatTopUpRouter
        .createCaller(ctxFor(plainUser, await supervisorCookie()))
        .supervisorApproveTopUp({ requestId: 5003 }),
      "FORBIDDEN"
    );
    const res = await floatTopUpRouter
      .createCaller(ctxFor(plainUser, await adminCookie()))
      .supervisorApproveTopUp({ requestId: 5003 });
    expect(res.success).toBe(true);
  });

  it("supervisorApproveTopUp: non-pending request → BAD_REQUEST; unknown id → NOT_FOUND", async () => {
    const cookie = await supervisorCookie();
    await expectTrpcCode(
      floatTopUpRouter
        .createCaller(ctxFor(plainUser, cookie))
        .supervisorApproveTopUp({ requestId: 5005 }),
      "BAD_REQUEST"
    );
    await expectTrpcCode(
      floatTopUpRouter
        .createCaller(ctxFor(plainUser, cookie))
        .supervisorApproveTopUp({ requestId: 999999 }),
      "NOT_FOUND"
    );
  });

  // ══ 2. insuranceServiceFleet.getStats (main port) ════════════════════════
  it("fleet getStats returns the hand-computed status aggregate", async () => {
    const res = await fleetRouter.createCaller(ctxFor(plainUser)).getStats();
    expect(res.total).toBe(7); // includes decommissioned + the deleted row
    expect(res.active).toBe(3);
    expect(res.inactive).toBe(1);
    expect(res.maintenance).toBe(1);
    expect(res.unassigned).toBe(1);
  });

  it("fleet getStats gates unauthenticated callers (UNAUTHORIZED)", async () => {
    await expectTrpcCode(
      fleetRouter.createCaller(ctxFor(null)).getStats(),
      "UNAUTHORIZED"
    );
  });

  // ══ 3. chaosEngineeringConsole.getStats (adapted real aggregates) ════════
  it("chaos getStats returns real CHAOS_% aggregates (decoy excluded)", async () => {
    // 2026-11-28 (C3 fix-cycle-1, FG-2): was intentionally red — root's
    // zeros-stub getStats was REPLACED by C1's PR #362 merge (main @1bed27ca):
    // real CHAOS_% aggregation over audit_log (total/active running+pending/
    // recent 7d window) on adminProcedure gating. This test now verifies the
    // merged contract.
    const res = await chaosRouter
      .createCaller(ctxFor(adminUser))
      .getStats();
    expect(res.total).toBe(4);
    expect(res.active).toBe(2); // running + pending
    expect(res.recent).toBe(3); // trailing-7d window excludes the 10d row
    // lastUpdated = the newest CHAOS_% row = the seeded newest timestamp.
    // (drizzle reads timestamp-without-tz back as the same UTC wall-clock
    // the seed wrote; a raw-SQL cross-check via the pg driver would be
    // TZ-shifted, so exact ISO equality against the seed is the honest
    // assertion.)
    expect(res.lastUpdated).toBe(chaosNewestISO);
  });

  it("chaos getStats: non-admin → FORBIDDEN; unauthenticated → UNAUTHORIZED", async () => {
    // 2026-11-28 (C3 fix-cycle-1, FG-2): was intentionally red — the merged
    // getStats sits on adminProcedure (server/routers/chaosEngineeringConsole.ts
    // :148), so these authz legs (non-admin FORBIDDEN, unauthenticated
    // UNAUTHORIZED) now pass against the merged contract.
    await expectTrpcCode(
      chaosRouter.createCaller(ctxFor(plainUser)).getStats(),
      "FORBIDDEN"
    );
    await expectTrpcCode(
      chaosRouter.createCaller(ctxFor(null)).getStats(),
      "UNAUTHORIZED"
    );
  });

  // ══ 4. simOrchestrator.getConfig / getCarrierSummary (main ports) ════════
  it("getConfig returns the seeded config for the right API key", async () => {
    const res = await simRouter
      .createCaller(ctxFor(plainUser))
      .getConfig({ terminalId: "TERM-W32-1", apiKey: "w32-key-1" });
    expect(res.probeIntervalMs).toBe(15000);
    expect(res.relayEndpoint).toBe("https://relay.w32.example/ingest");
    expect(res.enabled).toBe(true);
  });

  it("getConfig: wrong API key → UNAUTHORIZED; unknown terminal → defaults; disabled terminal reported", async () => {
    await expectTrpcCode(
      simRouter
        .createCaller(ctxFor(plainUser))
        .getConfig({ terminalId: "TERM-W32-1", apiKey: "wrong" }),
      "UNAUTHORIZED"
    );
    const defaults = await simRouter
      .createCaller(ctxFor(plainUser))
      .getConfig({ terminalId: "TERM-UNKNOWN", apiKey: "anything" });
    expect(defaults.probeIntervalMs).toBe(30000);
    expect(defaults.enabled).toBe(true);
    const disabled = await simRouter
      .createCaller(ctxFor(plainUser))
      .getConfig({ terminalId: "TERM-W32-OFF", apiKey: "w32-key-2" });
    expect(disabled.enabled).toBe(false);
  });

  it("getCarrierSummary returns the hand-computed per-carrier aggregates (decoys excluded)", async () => {
    // 2026-11-28 (C3 fix-cycle-1, FG-1): was intentionally red — C1's PR
    // #362 merge (main @1bed27ca) replaced root's broken SQL with the ported
    // W32-C implementation querying the real simProbeLog.agentId column
    // (server/routers/simOrchestrator.ts:128; input contract agentCode kept,
    // required-string so absent input fails validation — fail-closed, cannot
    // silently match everything). This test now verifies the merged contract.
    const res = await simRouter
      .createCaller(ctxFor(plainUser))
      .getCarrierSummary({ agentCode: "AGT-W32-SIM", hours: 24 });
    expect(res.length).toBe(2);
    // Ordered by avg score desc: Phys1/MTN (70.0) then ESim1/Airtel (50.0).
    const [mtn, airtel] = res;
    expect(mtn.slot).toBe("Phys1");
    expect(mtn.carrier).toBe("MTN");
    expect(Number(mtn.avgScore)).toBe(70.0);
    expect(Number(mtn.avgRssi)).toBe(25.0);
    expect(Number(mtn.avgLatencyMs)).toBe(150);
    expect(Number(mtn.selectedCount)).toBe(1);
    expect(Number(mtn.totalCount)).toBe(2);
    expect(Number(mtn.registeredPct)).toBe(100.0);
    expect(airtel.slot).toBe("ESim1");
    expect(airtel.carrier).toBe("Airtel");
    expect(Number(airtel.avgScore)).toBe(50.0);
    expect(Number(airtel.selectedCount)).toBe(0);
    expect(Number(airtel.totalCount)).toBe(1);
    expect(Number(airtel.registeredPct)).toBe(0.0);
  });

  it("getCarrierSummary: unauthenticated → UNAUTHORIZED", async () => {
    await expectTrpcCode(
      simRouter
        .createCaller(ctxFor(null))
        .getCarrierSummary({ agentCode: "AGT-W32-SIM", hours: 24 }),
      "UNAUTHORIZED"
    );
  });

  // ══ 5. analyticsQuery.getTransactionMetrics ══════════════════════════════
  it("DB fallback arm: real aggregates over platform_billing_ledger (decoy excluded)", async () => {
    const res = (await analyticsRouter
      .createCaller(ctxFor(plainUser))
      .getTransactionMetrics({ days: 30 })) as any;
    expect(res.source).toBe("database");
    expect(Number(res.totalCount)).toBe(3);
    expect(res.totalVolume).toBe(350);
    expect(res.avgAmount).toBeCloseTo(350 / 3, 4);
    expect(res.recentEntries.length).toBe(3);
    // Ordered by createdAt desc: the 100.00 row (now-1d) is newest.
    expect(String(res.recentEntries[0].grossAmount)).toContain("100");
  });

  it("OpenSearch arm: totalCount comes from real hits.total; recentEntries honestly ABSENT", async () => {
    // 2026-11-28 (C3 fix-cycle-1, FG-3): was intentionally red — C1's PR
    // #362 merge (main @1bed27ca) populates totalCount from hits.total
    // (track_total_hits:true; modern {value,relation} + legacy numeric shapes;
    // null — never a fabricated zero — when OpenSearch cannot report a count;
    // server/routers/analyticsQuery.ts:52-101). This test now verifies the
    // merged contract.
    process.env.OPENSEARCH_ENDPOINT = `http://127.0.0.1:${osDoublePort}`;
    try {
      const res = (await analyticsRouter
        .createCaller(ctxFor(plainUser))
        .getTransactionMetrics({ days: 30 })) as any;
      expect(res.source).toBe("opensearch");
      expect(res.totalVolume).toBe(5000);
      expect(res.avgAmount).toBe(250);
      expect(res.totalCount).toBe(20); // hits.total.value, track_total_hits
      expect(res.byStatus).toEqual([{ key: "success", doc_count: 20 }]);
      expect(res.timeSeries).toEqual([
        { date: "2026-11-26", volume: 5000, count: 20 },
      ]);
      // The ledger-shaped recentEntries is NOT fabricated on this arm.
      expect("recentEntries" in res).toBe(false);
    } finally {
      process.env.OPENSEARCH_ENDPOINT = "http://127.0.0.1:1";
    }
  });

  it("getTransactionMetrics: unauthenticated → UNAUTHORIZED", async () => {
    await expectTrpcCode(
      analyticsRouter
        .createCaller(ctxFor(null))
        .getTransactionMetrics({ days: 30 }),
      "UNAUTHORIZED"
    );
  });
});
