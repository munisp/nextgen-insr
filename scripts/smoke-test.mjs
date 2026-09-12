#!/usr/bin/env node
/**
 * smoke-test.mjs — Post-deploy smoke assertions for the production-final
 * stack (Sprint 62 F19 / item A9).
 *
 * Performs REAL HTTP requests against a running InsurePortal deployment and
 * asserts on status codes, headers, and payload shape. Every failure is
 * reported and the process exits non-zero — no result is fabricated.
 *
 * Checks:
 *   1. GET  /api/health        → 200, JSON body with a `status` field
 *                                (real dependency-aware health route in
 *                                server/_core/index.ts — checks db/redis/...)
 *   2. GET  /api/metrics       → 200, Prometheus text (contains process_/nodejs_)
 *   3. POST /api/trpc          → tRPC endpoint responds (any of 200/400/401 —
 *                                the batch endpoint answers unauthenticated
 *                                requests with a tRPC error envelope, not HTML)
 *   4. GET  /                  → 200, HTML shell served
 *   5. Security headers        → X-Content-Type-Options present (via gateway,
 *                                when BASE_URL points at nginx)
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 node scripts/smoke-test.mjs
 *   BASE_URL=http://localhost       node scripts/smoke-test.mjs   # via nginx
 *
 * Exit codes: 0 = all checks passed; 1 = one or more checks failed or the
 * target was unreachable.
 */

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);

const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.error(`  FAIL  ${name} — ${err.message}`);
  }
}

async function req(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${BASE_URL}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log(`Smoke-testing ${BASE_URL} (timeout ${TIMEOUT_MS}ms per request)\n`);

  // 1. Real dependency-aware health endpoint (server/_core/index.ts:
  //    app.get("/api/health") — runs live db/redis/minio/kafka/TB checks)
  await check("GET /api/health returns 200 with structured status", async () => {
    const res = await req("/api/health");
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body && typeof body === "object" && "status" in body,
      "health body missing `status` field");
  });

  // 2. Prometheus metrics endpoint
  await check("GET /api/metrics exposes Prometheus text format", async () => {
    const res = await req("/api/metrics");
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const text = await res.text();
    assert(/process_cpu_|nodejs_|http_request/.test(text),
      "metrics payload does not look like Prometheus text format");
  });

  // 3. tRPC endpoint answers with a tRPC-shaped response (not a 404/HTML page).
  //    Unauthenticated batch call: server must respond with a tRPC error
  //    envelope ({error:{json:{...}}}) or a 401 — either proves the router is
  //    mounted and serving.
  await check("POST /api/trpc is served by the tRPC router", async () => {
    const res = await req("/api/trpc/system.health", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: null }),
    });
    const ct = res.headers.get("content-type") ?? "";
    assert(ct.includes("application/json"),
      `expected JSON from tRPC router, got content-type "${ct}" (status ${res.status})`);
    const body = await res.json();
    const isTrpcEnvelope =
      (body && ("result" in body || "error" in body)) ||
      (Array.isArray(body) && body.some((e) => e && ("result" in e || "error" in e)));
    assert(isTrpcEnvelope, "response is not a tRPC envelope");
  });

  // 4. Web shell served
  await check("GET / serves the client shell", async () => {
    const res = await req("/");
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const ct = res.headers.get("content-type") ?? "";
    assert(ct.includes("text/html"), `expected text/html, got "${ct}"`);
  });

  // 5. Security headers (present when traffic passes through config/nginx.conf)
  await check("security headers present on responses", async () => {
    const res = await req("/api/health");
    const xcto = res.headers.get("x-content-type-options");
    assert(xcto === "nosniff",
      `X-Content-Type-Options missing or wrong (got "${xcto}") — is BASE_URL behind the production nginx?`);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.error(`SMOKE TEST FAILED: ${failed.map((f) => f.name).join("; ")}`);
    process.exit(1);
  }
  console.log("SMOKE TEST PASSED");
}

main().catch((err) => {
  console.error(`SMOKE TEST ERROR: target unreachable — ${err.message}`);
  process.exit(1);
});
