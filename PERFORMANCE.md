# Performance Budgets & Load Evidence — InsurePortal Platform

Remediates audit finding **F-09** (no performance budgets, no load evidence).

> **Budgets in §1 remain PROPOSED — pending owner approval.** §4 now contains
> the FIRST MEASURED real-server baseline (2026-08-16). The measured numbers
> are a **sandbox approximation** (2 vCPU container, PGlite in-process WASM
> Postgres), recorded so regressions can be detected and budgets can be set
> from evidence. They are **not** production capacity proof — see §4 caveats.

---

## 1. Critical paths and proposed budgets

Budgets are per-request server-side latency at the stated concurrency, measured
against a production-shaped Postgres (not PGlite — see §4 caveat).

| Path | tRPC / HTTP route | Class | p50 | p99 | Throughput | Error budget |
|---|---|---|---|---|---|---|
| Quote generation | `insurancePolicyQuoteManager.*` (reads product/rating tables) | read-compute | PROPOSED ≤ 300 ms | PROPOSED ≤ 1200 ms | PROPOSED ≥ 50 RPS | ≤ 0.1% 5xx |
| Claim submission | claim intake mutation (writes `claims` row) | write | PROPOSED ≤ 500 ms | PROPOSED ≤ 2000 ms | PROPOSED ≥ 20 RPS | ≤ 0.1% 5xx |
| Refund creation | `disputeRefund.initiateRefund` (writes `refunds` row, status `pending`; no rail call) | write | PROPOSED ≤ 500 ms | PROPOSED ≤ 2000 ms | PROPOSED ≥ 10 RPS | ≤ 0.1% 5xx |
| Dashboard reads | `analyticsDashboard.*`, `disputeRefund.getSummary` | read | PROPOSED ≤ 400 ms | PROPOSED ≤ 1500 ms | PROPOSED ≥ 100 RPS | ≤ 0.1% 5xx |
| Health/readiness | `GET /api/health`, `trpc system.health` | infra | PROPOSED ≤ 50 ms | PROPOSED ≤ 200 ms | PROPOSED ≥ 500 RPS | ≤ 0.1% 5xx |

Notes:
- Refund creation must never call payment rails synchronously (the integration
  tests assert rows persist as `pending` — latency budget assumes no external
  call on the request path).
- Claim submission with document upload is excluded; uploads go through object
  storage presigning and have a separate (future) budget.

## 2. Measurement tooling

`scripts/load-smoke.mjs` — dependency-free (Node ≥ 20 `fetch`), concurrency-
pool load generator with per-endpoint RPS and p50/p95/p99 reporting and
per-status-class counts (2xx/401/403/429/5xx/network). Exits non-zero if any
endpoint breaches `LOAD_MAX_ERROR_RATE` (default 1%; only 5xx/network count).

```bash
# Against any running server:
LOAD_BASE_URL=http://127.0.0.1:3000 node scripts/load-smoke.mjs

# Include authenticated critical paths (dashboard reads, refund summary).
# Session auth is cookie-based (kc_session, server/_core/context.ts) — use
# LOAD_AUTH_COOKIE. (LOAD_AUTH_TOKEN sends a Bearer header, which the
# browser-session context does not consume.)
LOAD_AUTH_COOKIE="kc_session=<jwt>" LOAD_BASE_URL=http://127.0.0.1:3000 node scripts/load-smoke.mjs

# Tune: LOAD_DURATION_S (default 10), LOAD_CONCURRENCY (default 10)
```

`scripts/perf-baseline.ts` — one-command real-server baseline. Boots the REAL
express/tRPC server exactly like the HTTP E2E suite (PGlite wire-protocol
Postgres + `drizzle-kit push --force` when `POSTGRES_URL` is unset, mini-Redis
when `REDIS_URL` is unset), mints a real `kc_session` admin cookie, warms up,
then sweeps `scripts/load-smoke.mjs` over a concurrency ladder and writes
JSON-lines results to `performance-benchmarks/baseline-results.jsonl`:

```bash
pnpm exec tsx scripts/perf-baseline.ts
# Tune: PERF_CONCURRENCY="10,50,100" PERF_DURATION_S=6 PERF_OUT=<path>
```

Both scripts are **CI-ready**: given a booted server and `LOAD_BASE_URL`,
`load-smoke.mjs` runs without any `pnpm install`.

### Simulated client pool (LOAD_SPREAD_IPS=1, used by perf-baseline)

The server enforces per-client-IP protections (DDoS throttle: >50 requests /
10s / IP → 503; per-IP rate buckets; `trust proxy: 1` as behind the production
gateway). A load test from a single IP mostly measures those protections
tripping — verified in an early run where fixed-IP workers at ~250 req/10s/IP
were correctly throttled with 503s. The harness therefore sends each request
with a random `X-Forwarded-For` from a ~65k-address pool, mirroring the
production case the limits are tuned for (many clients, each well under its
budget). The limiter middleware still executes on every request, and any
429/503 responses would appear in the status-class counts.

## 3. Why mutating paths are not in the default smoke

Quote/claim/refund *creation* endpoints write rows and enforce velocity rules
(5 refunds/30 days/customer — see `disputeRefund` velocity test). Naïvely
load-testing them produces fraudulent-looking data and trips the very controls
the platform is audited on. Budgets for those paths are enforced via a
dedicated load environment with flagged test tenants (PROPOSED — needs owner
approval), not the default smoke. The default smoke covers health, public
tRPC queries, an unauthenticated 401 fast-reject path, and (with
`LOAD_AUTH_COOKIE`) read-only dashboard/refund paths.

## 4. Baseline evidence — honest status

| Evidence | Status |
|---|---|
| Harness validation (stub HTTP server, 2026-08-15, sandbox) | **Executed**: 2 endpoints, ~1.8k–3.1k RPS, 0% errors, exit 0; unreachable-target negative case exits 1. Validates the *harness mechanics only* — these numbers say nothing about the application. |
| Real-server baseline | **FIRST MEASURED BASELINE recorded 2026-08-16** — table below. Sandbox approximation, not production capacity. |
| Production-capacity evidence | **PENDING**: a load test against staging Postgres remains to be scheduled (owner action). |

### 4.1 FIRST MEASURED BASELINE (2026-08-16)

**Environment** (recorded in `performance-benchmarks/baseline-results.jsonl`):

| Property | Value |
|---|---|
| Server | REAL `createApp()` (full middleware chain: helmet → rate limits → security hardening → orchestrator → financial-attack prevention → tRPC adapter → Keycloak session auth) |
| Node | v20.20.2, Linux x86_64 |
| Hardware | shared CI sandbox container: **2 vCPU** (Xeon Platinum), **4 GB RAM** |
| Database | **PGlite 0.5 (in-process WASM Postgres)** via pglite-socket, schema from `drizzle-kit push --force`, pool max 4 |
| Redis | in-process mini-Redis (test double implementing the RESP subset the rate-limit stores use) |
| Sidecars | absent (Kafka/Fluvio/TB/Rust/Go/Python endpoints pointed at a dead port; security orchestrator in documented fail-open mode) |
| Method | `scripts/perf-baseline.ts` — 3s warm-up, then 6s per endpoint per level, simulated client pool (§2), error budget 1% (5xx/network) |
| Revision | `main` post-#131 (boot defect fixed; server boots cleanly) |

**Measured results** (0% 5xx/network errors at every level; the anon target's
100% `401` class is the expected rejection, asserted by class counts):

| Concurrency | Endpoint | Reqs | RPS | p50 ms | p95 ms | p99 ms | err% |
|---|---|---|---|---|---|---|---|
| 10 | GET /api/health | 764 | 127.3 | 73.1 | 91.0 | 237.2 | 0% |
| 10 | trpc system.health | 1089 | 181.5 | 49.5 | 101.7 | 189.2 | 0% |
| 10 | trpc disputeRefund.list (anon→401) | 1423 | 237.2 | 39.5 | 63.4 | 118.8 | 0% |
| 10 | trpc disputeRefund.getSummary (auth) | 696 | 116.0 | 78.1 | 143.0 | 314.0 | 0% |
| 10 | trpc disputeRefund.list (auth) | 808 | 134.7 | 66.1 | 119.2 | 337.6 | 0% |
| 50 | GET /api/health | 821 | 136.8 | 367.9 | 419.4 | 516.0 | 0% |
| 50 | trpc system.health | 1311 | 218.5 | 206.8 | 368.3 | 768.2 | 0% |
| 50 | trpc disputeRefund.list (anon→401) | 1461 | 243.5 | 186.1 | 402.2 | 606.5 | 0% |
| 50 | trpc disputeRefund.getSummary (auth) | 794 | 132.3 | 363.1 | 620.7 | 711.2 | 0% |
| 50 | trpc disputeRefund.list (auth) | 871 | 145.2 | 311.2 | 583.4 | 670.8 | 0% |
| 100 | GET /api/health | 828 | 138.0 | 745.6 | 872.3 | 976.9 | 0% |
| 100 | trpc system.health | 1399 | 233.2 | 395.7 | 654.1 | 749.0 | 0% |
| 100 | trpc disputeRefund.list (anon→401) | 1373 | 228.8 | 373.1 | 841.7 | 1028.3 | 0% |
| 100 | trpc disputeRefund.getSummary (auth) | 859 | 143.2 | 709.4 | 1072.5 | 1093.3 | 0% |
| 100 | trpc disputeRefund.list (auth) | 874 | 145.7 | 631.7 | 1002.8 | 1047.6 | 0% |

**How to read these numbers (caveats):**

- **Sandbox approximation, not production capacity.** 2 shared vCPUs and an
  in-process WASM database bound throughput at ~130–240 RPS aggregate and
  inflate tail latency; p50 grows roughly linearly with concurrency (CPU
  saturation), which is expected on 2 cores and says little about a
  production-sized deployment.
- **PGlite ≠ Postgres.** PGlite executes queries serially inside the Node
  process (no network hop, no real planner/parallelism). It approximates the
  Node middleware/application path; it cannot validate query plans, index
  usage, or real-Postgres contention. Re-run against staging Postgres before
  treating any number here as a budget verdict.
- **No pathological latency observed.** Worst p99 is 1093 ms
  (`disputeRefund.getSummary` at concurrency 100) — sandbox CPU saturation,
  not a >5s pathology, so no N+1/index hotfix was triggered by this baseline.
  `getSummary` is the slowest path per-request (5 aggregate COUNT/SUM queries
  per call); a candidate for a future rollup/cache if real-Postgres
  measurements confirm it matters.
- **Reproduce:** `pnpm exec tsx scripts/perf-baseline.ts` (numbers WILL vary
  run-to-run on a shared sandbox; treat ±30% as noise, look for order-of-
  magnitude regressions).

## 5. CI recommendation (load smoke — not yet enabled)

Add a `load-smoke` job that boots the server against the postgres:16 service
(same env pattern as `integration.yml`) and runs `scripts/load-smoke.mjs`
with `LOAD_AUTH_COOKIE` minted the way `scripts/perf-baseline.ts` does it.
Marked as a **recommendation**: the API contract suite (tests/contract) is
already wired into CI (`integration.yml`, `contract` job) and guards the
response shapes these latencies attach to; scheduled load trending is a
follow-up owner decision (nightly, not per-PR, to avoid flake-driven
blocks on shared runners).
