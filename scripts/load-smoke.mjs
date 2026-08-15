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
 *   LOAD_AUTH_TOKEN      optional JWT; when set, authenticated tRPC paths are
 *                        included in the target list
 *
 * Exit codes: 0 = all endpoints within error budget; 1 = threshold breached
 * or an endpoint was unreachable.
 *
 * NOTE: unauthenticated smoke only covers public paths. Latency numbers from
 * a PGlite-backed local server are a SMOKE baseline, not production capacity
 * evidence — see PERFORMANCE.md.
 */

const BASE = (process.env.LOAD_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const DURATION_S = Number(process.env.LOAD_DURATION_S ?? 10);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 10);
const MAX_ERROR_RATE = Number(process.env.LOAD_MAX_ERROR_RATE ?? 0.01);
const AUTH = process.env.LOAD_AUTH_TOKEN;

// tRPC v11 GET query format: /api/trpc/<proc>?input=<urlencoded json>
const trpcGet = (proc, input) =>
  `${BASE}/api/trpc/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;

const targets = [
  { name: "GET /api/health", url: `${BASE}/api/health` },
  { name: "trpc system.health", url: trpcGet("system.health", { timestamp: 0 }) },
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

async function hammer(target) {
  const lat = [];
  let errors = 0;
  let firstError = null;
  const deadline = Date.now() + DURATION_S * 1000;
  const headers = target.auth ? { authorization: `Bearer ${AUTH}` } : {};

  async function worker() {
    while (Date.now() < deadline) {
      const t0 = performance.now();
      try {
        const res = await fetch(target.url, { headers, signal: AbortSignal.timeout(10_000) });
        await res.arrayBuffer(); // drain
        if (res.status >= 500) {
          errors++;
          firstError ??= `HTTP ${res.status}`;
        }
      } catch (e) {
        errors++;
        firstError ??= String(e?.message ?? e);
      }
      lat.push(performance.now() - t0);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
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
    firstError,
  };
}

console.log(`load-smoke: target=${BASE} duration=${DURATION_S}s concurrency=${CONCURRENCY}`);
console.log(
  "endpoint".padEnd(40),
  "reqs".padStart(8),
  "err%".padStart(8),
  "RPS".padStart(8),
  "p50ms".padStart(9),
  "p95ms".padStart(9),
  "p99ms".padStart(9),
);

let failed = false;
for (const t of targets) {
  const r = await hammer(t);
  const errPct = Math.round(r.errorRate * 10000) / 100;
  console.log(
    r.name.padEnd(40),
    String(r.total).padStart(8),
    `${errPct}%`.padStart(8),
    String(r.rps).padStart(8),
    String(r.p50).padStart(9),
    String(r.p95).padStart(9),
    String(r.p99).padStart(9),
  );
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
