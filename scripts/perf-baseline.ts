/**
 * perf-baseline.ts — real-server performance baseline runner (finding F-09).
 *
 * Boots the REAL express/tRPC server exactly like the HTTP E2E suite —
 * createApp() on an ephemeral port, PGlite wire-protocol Postgres (or
 * POSTGRES_URL if provided), mini-Redis when REDIS_URL is unset — mints a
 * real kc_session admin cookie, then drives scripts/load-smoke.mjs over a
 * concurrency sweep and collects machine-readable results.
 *
 * Usage:
 *   pnpm exec tsx scripts/perf-baseline.ts
 *
 * Env knobs:
 *   PERF_CONCURRENCY     comma-separated sweep (default "10,50,100")
 *   PERF_DURATION_S      seconds per endpoint per level (default 6)
 *   PERF_OUT             JSON-lines results file (default
 *                        performance-benchmarks/baseline-results.jsonl)
 *   PGLITE_PORT          PGlite wire port when POSTGRES_URL unset (default
 *                        55529, distinct from the test suites)
 *   POSTGRES_URL         when set, used as-is instead of PGlite
 *   REDIS_URL            when set, used as-is instead of mini-Redis
 *
 * The script exits non-zero if any endpoint breaches the load-smoke error
 * budget (5xx/network errors) at any sweep level.
 *
 * HONESTY NOTE: PGlite is in-process WASM Postgres that serializes queries
 * through a single backend. Numbers recorded here are a SANDBOX
 * APPROXIMATION of the Node middleware/application path, not production
 * capacity evidence. See PERFORMANCE.md.
 */

// ── Environment MUST be set before any server module is imported ────────────
// (server/_core/env.ts throws at import time when required vars are missing).
process.env.NODE_ENV = "test";
process.env.TZ = "UTC";
process.env.JWT_SECRET ??= "perf-baseline-jwt-secret-9f27c1e4b8d34a06";
process.env.DEV_AUTH_BYPASS = "false";
process.env.PERMIFY_FAIL_OPEN = "true";
process.env.PERMIFY_URL = "http://127.0.0.1:9";
process.env.CBN_AML_URL = "http://127.0.0.1:9";
process.env.NFIU_API_URL = "http://127.0.0.1:9";
// A small pool: PGlite serializes at the query multiplexer anyway, but a
// single-connection pool would make the Node pool itself the bottleneck and
// measure pool queueing instead of the request path.
process.env.DB_POOL_MAX ??= "4";
process.env.DB_POOL_MIN ??= "0";
process.env.PGLITE_PORT ??= "55529";
process.env.PGLITE_MAX_CONNECTIONS ??= "10";
// Fire-and-forget sidecar clients: fail fast (no sidecars in the sandbox).
process.env.KAFKA_BROKERS = "127.0.0.1:9";
process.env.FLUVIO_HTTP_URL = "http://127.0.0.1:9";
process.env.PLATFORM_BASE_URL = "http://127.0.0.1:9";
process.env.TB_SIDECAR_URL = "http://127.0.0.1:9";
process.env.RUST_BRIDGE_URL = "http://127.0.0.1:9";
process.env.GO_LEDGER_URL = "http://127.0.0.1:9";
process.env.PYTHON_ML_URL = "http://127.0.0.1:9";
process.env.SECURITY_FAIL_OPEN = "true";
// Required at import time by server/_core/env.ts.
process.env.PLATFORM_API_KEY ??= "perf-platform-key-c41f9e2a";
process.env.PLATFORM_SERVICE_TOKEN ??= "perf-service-token-b87d30f1";
process.env.KEYCLOAK_URL ??= "https://auth.test.insureportal.io";
process.env.KEYCLOAK_REALM ??= "insureportal";
process.env.KEYCLOAK_CLIENT_ID ??= "insurance-portal";
process.env.KEYCLOAK_CLIENT_SECRET ??= "perf-keycloak-secret-55aa02d9";
process.env.MINIO_SECRET_KEY ??= "perf-minio-secret-6c2b91e0";
process.env.APISIX_ADMIN_KEY ??= "perf-apisix-key-a04d77c3";

import { spawn, type StdioOptions } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SWEEP = (process.env.PERF_CONCURRENCY ?? "10,50,100")
  .split(",")
  .map(s => Number(s.trim()))
  .filter(n => Number.isFinite(n) && n > 0);
const DURATION_S = Number(process.env.PERF_DURATION_S ?? 6);
const OUT_FILE =
  process.env.PERF_OUT ??
  path.join(repoRoot, "performance-benchmarks", "baseline-results.jsonl");

interface LoadResult {
  concurrency: number;
  durationS: number;
  spreadIPs: boolean;
  name: string;
  total: number;
  errors: number;
  errorRate: number;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  statusCounts: Record<string, number>;
  firstError: string | null;
}

// Resources are tracked at module scope so fatal exits can still tear them
// down (a leaked PGlite child holds PGLITE_PORT and breaks the next run).
let miniRedis: { url: string; close: () => Promise<void> } | null = null;
let dbTeardown: (() => Promise<void>) | null = null;
let appServer: Server | null = null;
let usingPglite = false;

async function teardownAll(): Promise<void> {
  if (appServer) {
    const srv = appServer;
    appServer = null;
    await new Promise<void>(resolve => srv.close(() => resolve()));
  }
  try {
    const { getPool } = await import("../server/db");
    const pool = await getPool();
    if (pool) await pool.end();
  } catch {
    /* best-effort */
  }
  try {
    const { getRedisClient } = await import("../server/lib/redisClient");
    getRedisClient().disconnect();
  } catch {
    /* best-effort */
  }
  if (dbTeardown) {
    const td = dbTeardown;
    dbTeardown = null;
    await td().catch(() => {});
  }
  if (miniRedis) {
    const mr = miniRedis;
    miniRedis = null;
    await mr.close().catch(() => {});
  }
}

/** Run one load-smoke pass in a child process (async — see warm-up note). */
function runLoadSmoke(opts: {
  baseUrl: string;
  durationS: number;
  concurrency: number;
  cookie: string;
  jsonOut?: string;
  stdio: StdioOptions;
}): Promise<number> {
  return new Promise(resolve => {
    const child = spawn(
      process.execPath,
      [path.join(repoRoot, "scripts", "load-smoke.mjs")],
      {
        env: {
          ...process.env,
          LOAD_BASE_URL: opts.baseUrl,
          LOAD_DURATION_S: String(opts.durationS),
          LOAD_CONCURRENCY: String(opts.concurrency),
          LOAD_AUTH_COOKIE: opts.cookie,
          LOAD_SPREAD_IPS: "1",
          ...(opts.jsonOut ? { LOAD_JSON_OUT: opts.jsonOut } : {}),
        },
        stdio: opts.stdio,
      },
    );
    child.on("exit", c => resolve(c ?? 1));
  });
}

async function main(): Promise<void> {
  // ── Redis (mini RESP server when REDIS_URL is not provided) ───────────────
  if (!process.env.REDIS_URL) {
    const { startMiniRedis } = await import("../tests/e2e/setup/miniRedis");
    miniRedis = await startMiniRedis();
    process.env.REDIS_URL = miniRedis.url;
    console.log(`[perf] mini-Redis at ${miniRedis.url}`);
  }

  // ── Postgres: PGlite child + schema push (shared with integration/e2e) ────
  usingPglite = !process.env.POSTGRES_URL;
  const dbGlobalSetup = (await import("../tests/integration/setup/globalSetup")).default;
  dbTeardown = await dbGlobalSetup();

  // ── Boot the real app on an ephemeral port ────────────────────────────────
  const { createApp } = await import("../server/_core/index");
  const { server: srv } = await createApp();
  appServer = srv;
  await new Promise<void>((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (srv.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[perf] server listening on ${baseUrl}`);

  // ── Mint a real kc_session admin cookie (same shape as Keycloak login) ────
  const { sessionCookieFor, e2eAdmin } = await import("../tests/e2e/helpers/http");
  const cookie = await sessionCookieFor(e2eAdmin);

  // ── Warm-up: one light pass so lazy init isn't in the numbers ────────────
  // NOTE: must be ASYNC — the server runs in THIS process, so a synchronous
  // exec would block the event loop and starve the server itself.
  await runLoadSmoke({
    baseUrl,
    durationS: 3,
    concurrency: 4,
    cookie,
    stdio: ["ignore", "ignore", "inherit"],
  });
  console.log("[perf] warm-up done");

  // ── Concurrency sweep ─────────────────────────────────────────────────────
  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  rmSync(OUT_FILE, { force: true });

  const environment = {
    node: process.version,
    platform: `${os.type()} ${os.machine()}`,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
    db: usingPglite ? "pglite(in-process wasm)" : "postgres(external POSTGRES_URL)",
    dbPoolMax: process.env.DB_POOL_MAX,
    measuredAt: new Date().toISOString(),
  };
  writeFileSync(OUT_FILE, JSON.stringify({ meta: environment }) + "\n");

  let failed = false;
  for (const concurrency of SWEEP) {
    console.log(`\n[perf] ── concurrency=${concurrency} duration=${DURATION_S}s ──`);
    const code = await runLoadSmoke({
      baseUrl,
      durationS: DURATION_S,
      concurrency,
      cookie,
      jsonOut: OUT_FILE,
      stdio: ["ignore", "inherit", "inherit"],
    });
    if (code !== 0) failed = true;
  }

  // ── Summary table ─────────────────────────────────────────────────────────
  const lines = readFileSync(OUT_FILE, "utf8").trim().split("\n");
  const results: LoadResult[] = lines
    .map(l => JSON.parse(l))
    .filter(r => r && r.name);
  console.log("\n[perf] ══ BASELINE SUMMARY ══");
  console.log(
    "conc".padStart(5),
    "endpoint".padEnd(40),
    "reqs".padStart(8),
    "RPS".padStart(8),
    "p50ms".padStart(9),
    "p95ms".padStart(9),
    "p99ms".padStart(9),
    "err%".padStart(8),
  );
  for (const r of results) {
    console.log(
      String(r.concurrency).padStart(5),
      r.name.padEnd(40),
      String(r.total).padStart(8),
      String(r.rps).padStart(8),
      String(r.p50).padStart(9),
      String(r.p95).padStart(9),
      String(r.p99).padStart(9),
      `${Math.round(r.errorRate * 10000) / 100}%`.padStart(8),
    );
  }
  console.log(`[perf] results written to ${OUT_FILE}`);

  // ── Teardown ──────────────────────────────────────────────────────────────
  await teardownAll();

  if (failed) {
    console.error("[perf] FAILED — error budget breached at some level");
    process.exit(1);
  }
  console.log("[perf] DONE");
  process.exit(0);
}

main().catch(async err => {
  console.error("[perf] fatal:", err);
  await teardownAll();
  process.exit(1);
});
