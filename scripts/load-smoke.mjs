#!/usr/bin/env node
/**
 * load-smoke.mjs — minimal load/latency smoke for InsurePortal (finding F-09).
 *
 * Dependency-free (Node >= 20 built-in fetch). Hammers the locally booted
 * server and reports per-endpoint RPS and p50/p95/p99 latency.
 *
 * Usage:
 *   LOAD_BASE_URL=http://127.0.0.1:3000 node scripts/load-smoke.mjs
 *
 * Env knobs:
 *   LOAD_BASE_URL        target server (default http://127.0.0.1:3000)
 *   LOAD_DURATION_S      seconds per endpoint (default 10)
 *   LOAD_CONCURRENCY     parallel workers per endpoint (default 10)
 *   LOAD_MAX_ERROR_RATE  fail threshold, 0..1 (default 0.01)
 *   LOAD_AUTH_TOKEN      optional JWT (Authorization: Bearer); when set,
 *                        authenticated tRPC paths are included
 *   LOAD_AUTH_COOKIE     optional session cookie (e.g. "kc_session=<jwt>").
 *                        The server's browser-session auth reads the
 *                        kc_session cookie (server/_core/context.ts), so this
 *                        is the working credential for authenticated paths.
 *                        Takes precedence over LOAD_AUTH_TOKEN.
 *   LOAD_SPREAD_IPS      when "1", each request carries a random
 *                        X-Forwarded-For from a large simulated client pool
 *                        (app sets "trust proxy": 1, exactly like production
 *                        behind the gateway). Rationale: the server enforces
 *                        per-client-IP protections (DDoS throttle, per-IP
 *                        rate buckets); a load test from ONE IP mostly
 *                        measures those protections tripping, not the
 *                        application. A large client pool mirrors the
 *                        production case the limits are tuned for (many
 *                        clients, each well under its budget). The limiters
 *                        still execute on every request; status-class counts
 *                        keep any 429/503s visible.
 *   LOAD_JSON_OUT        optional path; per-endpoint results are appended as
 *                        JSON lines for machine collection (perf baseline).
 *
 * Exit codes: 0 = all endpoints within error budget; 1 = threshold breached
 * or an endpoint was unreachable.
 *
 * Error budget: only 5xx / network failures count as errors. Expected 4xx
 * (401 on the unauthenticated target, 429 when a per-IP rate bucket fills)
 * are reported per status class, not treated as server failures.
 *
 * NOTE: unauthenticated smoke only covers public paths. Latency numbers from
 * a PGlite-backed local server are a SMOKE baseline, not production capacity
 * evidence — see PERFORMANCE.md.
 */

import { appendFileSync } from "node:fs";

const BASE = (process.env.LOAD_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const DURATION_S = Number(process.env.LOAD_DURATION_S ?? 10);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 10);
const MAX_ERROR_RATE = Number(process.env.LOAD_MAX_ERROR_RATE ?? 0.01);
const AUTH_TOKEN = process.env.LOAD_AUTH_TOKEN;
const AUTH_COOKIE = process.env.LOAD_AUTH_COOKIE;
const SPREAD_IPS = process.env.LOAD_SPREAD_IPS === "1";
const JSON_OUT = process.env.LOAD_JSON_OUT;
const AUTH = AUTH_COOKIE ?? AUTH_TOKEN;

// tRPC v11 GET query format: /api/trpc/<proc>?input=<urlencoded json>
const trpcGet = (proc, input) =>
  `${BASE}/api/trpc/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;

const targets = [
  { name: "GET /api/health", url: `${BASE}/api/health` },
  { name: "trpc system.health", url: trpcGet("system.health", { timestamp: 0 }) },
  // Unauthenticated 401 fast-reject path: protected procedure without a
  // session cookie. Measures the auth-middleware rejection cost; 401 is the
  // expected status here, not an error.
  { name: "trpc disputeRefund.list (anon→401)", url: trpcGet("disputeRefund.list", {}), expectStatus: 401 },
];

if (AUTH) {
  // Authenticated critical paths (dashboard reads). Mutating paths (quote /
  // claim submission / refund creation) are intentionally excluded from the
  // smoke: they write rows and call external rails; see PERFORMANCE.md §3.
  targets.push(
    { name: "trpc disputeRefund.getSummary (auth)", url: trpcGet("disputeRefund.getSummary", null), auth: true },
    { name: "trpc disputeRefund.list (auth)", url: trpcGet("disputeRefund.list", {}), auth: true },
  );
}

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function authHeaders() {
  if (AUTH_COOKIE) return { cookie: AUTH_COOKIE };
  if (AUTH_TOKEN) return { authorization: `Bearer ${AUTH_TOKEN}` };
  return {};
}

/** Random IP from a ~65k-address simulated client pool (see header note). */
function simulatedClientIp() {
  return `10.${(Math.random() * 254) | 0}.${(Math.random() * 254) | 0}.${1 + ((Math.random() * 254) | 0)}`;
}

async function hammer(target) {
  const lat = [];
  let errors = 0;
  let firstError = null;
  const statusCounts = {}; // "2xx" | "3xx" | "401" | "403" | "429" | "4xx" | "5xx" | "net"
  const deadline = Date.now() + DURATION_S * 1000;
  const headers = target.auth ? authHeaders() : {};

  async function worker() {
    while (Date.now() < deadline) {
      const t0 = performance.now();
      const wHeaders = SPREAD_IPS
        ? { ...headers, "x-forwarded-for": simulatedClientIp() }
        : headers;
      try {
        const res = await fetch(target.url, { headers: wHeaders, signal: AbortSignal.timeout(10_000) });
        await res.arrayBuffer(); // drain
        const cls =
          res.status === 401 || res.status === 403 || res.status === 429
            ? String(res.status)
            : `${Math.floor(res.status / 100)}xx`;
        statusCounts[cls] = (statusCounts[cls] ?? 0) + 1;
        if (res.status >= 500) {
          errors++;
          firstError ??= `HTTP ${res.status}`;
        }
      } catch (e) {
        statusCounts.net = (statusCounts.net ?? 0) + 1;
        errors++;
        firstError ??= String(e?.message ?? e);
      }
      lat.push(performance.now() - t0);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  lat.sort((a, b) => a - b);
  const total = lat.length;
  const rps = total / DURATION_S;
  return {
    name: target.name,
    total,
    errors,
    errorRate: total ? errors / total : 1,
    rps: Math.round(rps * 10) / 10,
    p50: Math.round(percentile(lat, 50) * 100) / 100,
    p95: Math.round(percentile(lat, 95) * 100) / 100,
    p99: Math.round(percentile(lat, 99) * 100) / 100,
    statusCounts,
    firstError,
  };
}

console.log(`load-smoke: target=${BASE} duration=${DURATION_S}s concurrency=${CONCURRENCY} spreadIPs=${SPREAD_IPS}`);
console.log(
  "endpoint".padEnd(40),
  "reqs".padStart(8),
  "err%".padStart(8),
  "RPS".padStart(8),
  "p50ms".padStart(9),
  "p95ms".padStart(9),
  "p99ms".padStart(9),
  "  status-classes",
);

let failed = false;
for (const t of targets) {
  const r = await hammer(t);
  const errPct = Math.round(r.errorRate * 10000) / 100;
  const classes = Object.entries(r.statusCounts)
    .sort()
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");
  console.log(
    r.name.padEnd(40),
    String(r.total).padStart(8),
    `${errPct}%`.padStart(8),
    String(r.rps).padStart(8),
    String(r.p50).padStart(9),
    String(r.p95).padStart(9),
    String(r.p99).padStart(9),
    ` ${classes}`,
  );
  if (JSON_OUT) {
    appendFileSync(
      JSON_OUT,
      JSON.stringify({ concurrency: CONCURRENCY, durationS: DURATION_S, spreadIPs: SPREAD_IPS, ...r }) + "\n",
    );
  }
  if (r.total === 0 || r.errorRate > MAX_ERROR_RATE) {
    failed = true;
    console.error(`  ✗ ${r.name}: error rate ${errPct}% exceeds budget ${MAX_ERROR_RATE * 100}% (first error: ${r.firstError ?? "none"})`);
  }
}

if (failed) {
  console.error("load-smoke: FAILED — see above");
  process.exit(1);
}
console.log("load-smoke: PASSED");
