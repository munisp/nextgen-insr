# Performance Budgets & Load Evidence — InsurePortal Platform

Remediates audit finding **F-09** (no performance budgets, no load evidence).

> **All budgets below are PROPOSED — pending owner approval.** They are
> starting targets derived from the path's business criticality, not from
> measurements. §4 records what measurement evidence exists today.

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
pool load generator with per-endpoint RPS and p50/p95/p99 reporting. Exits
non-zero if any endpoint breaches `LOAD_MAX_ERROR_RATE` (default 1%).

```bash
# Against any running server:
LOAD_BASE_URL=http://127.0.0.1:3000 node scripts/load-smoke.mjs

# Include authenticated critical paths (dashboard reads, refund summary):
LOAD_AUTH_TOKEN=<jwt> LOAD_BASE_URL=http://127.0.0.1:3000 node scripts/load-smoke.mjs

# Tune: LOAD_DURATION_S (default 10), LOAD_CONCURRENCY (default 10)
```

Booting a full local server follows the integration-test pattern
(`tests/integration/setup/`): PGlite + pglite-socket as `DATABASE_URL`,
schema via `drizzle-kit push --force`, then `tsx server/_core/index.ts` with
the env set mirrored from `vitest.integration.config.ts`.

The script is **CI-ready**: given a booted server and `LOAD_BASE_URL`, it runs
without any `pnpm install`.

## 3. Why mutating paths are not in the default smoke

Quote/claim/refund *creation* endpoints write rows and enforce velocity rules
(5 refunds/30 days/customer — see `disputeRefund` velocity test). Naïvely
load-testing them produces fraudulent-looking data and trips the very controls
the platform is audited on. Budgets for those paths are enforced via a
dedicated load environment with flagged test tenants (PROPOSED — needs owner
approval), not the default smoke. The default smoke covers health, public
tRPC queries, and (with `LOAD_AUTH_TOKEN`) read-only dashboard/refund paths.

## 4. Baseline evidence — honest status

| Evidence | Status |
|---|---|
| Harness validation (stub HTTP server, 2026-08-15, sandbox) | **Executed**: 2 endpoints, ~1.8k–3.1k RPS, 0% errors, exit 0; unreachable-target negative case exits 1. Validates the *harness mechanics only* — these numbers say nothing about the application. |
| Real-server baseline | **PENDING (blocked)**: the full server does not boot at revision `d94d847` — `server/routers/transactions.ts:140` declares a duplicate parameter name (`agentId`), which is a hard `SyntaxError` under the Node ESM loader (tsx). Observed in the authoring sandbox. Tracked as CLAIM-010 in `claims/claims.yaml`. Once fixed, run §2 commands and replace this row with measured p50/p99/RPS. |
| Production-capacity evidence | **PENDING**: PGlite numbers, when available, are smoke baselines, not production capacity. A load test against staging Postgres remains to be scheduled (owner action). |

## 5. CI recommendation (not yet enabled)

Add a `load-smoke` job that boots the server against the postgres:16 service
(same env pattern as `integration.yml`) and runs `scripts/load-smoke.mjs`.
Marked as a **recommendation** because it is blocked by CLAIM-010 and would
fail today; enable it in the same PR that fixes the boot defect.
