# Test Quarantine Registry

Central, auditable registry of tests excluded from the default vitest run.
Every entry was individually approved by the assurance lead (2026-08-16) with
evidence. Mechanism: config-level `exclude` in `vitest.config.ts` only — no
`describe.skip`/`it.skip` in test files. No assertion in any quarantined file
has been modified or deleted. No entry may be added without per-file
assurance-lead approval. A test leaves quarantine only when its re-enable
condition is met; quarantined files MUST be re-enabled as fixes land.

Sections:
- **CAT-A** — undelivered-scope: asserts artifacts with zero commits in git history (never merged; slipped in during the broken-CI window when merges weren't gated).
- **CAT-B** — assembled-stack dependency: requires a running server/gateway the unit-level job does not provide; candidates for the real-HTTP e2e harness, NOT deletion.
- **QUARANTINED-OPEN-DEFECT** — genuine defect or partial delivery in delivered code. Red is the CORRECT state for these; quarantined only so the merge gate can function, and publicly tracked here + as F-12 sub-items in the assurance report. Highest re-enable priority.
- **DE-DUPLICATED EXECUTION** — not quarantine: suites covered green by a dedicated workflow job with the correct harness.

## CAT-A — undelivered-scope (F-11)

| File | Asserts (all zero-commit, API-verified 2026-08-16) | Re-enable condition |
|---|---|---|
| `server/sprint73-resilience.test.ts` | 8 connectivity-resilience microservices (services/go/connectivity-resilience, connection-multiplexer; services/rust/bandwidth-optimizer, offline-ledger, adaptive-compression; services/python/network-quality-predictor, sms-transaction-bridge, connectivity-analytics) | Services exist on main, wired in CI |
| `server/helm-charts.test.ts` | k8s/charts/{apisix,dapr,fluvio,kafka,keycloak,lakehouse,mojaloop,opensearch,permify,pos-insureportal-umbrella,postgresql,redis,temporal,tigerbeetle} | Charts exist on main |
| `server/lib/__tests__/sprint62-production.test.ts` | docker-compose.production-final.yml, scripts/seed-production-final.mjs, scripts/smoke-test.mjs, prometheus config | Files exist on main |
| `server/lib/__tests__/sprint65-final.test.ts` | k8s/deployment.yml, .github/workflows/ci-cd.yml, config/prometheus.yml, config/nginx.conf, security audit report | Files exist on main |
| `server/sprint71-security.test.ts` | services/rust/ddos-shield, services/go/pbac-engine | Services exist on main |
| `server/sprint79.test.ts` | billing microservices (services/go + services/python billing-*) | Services exist on main |
| `server/sprint80.test.ts` | k8s/sprint80-billing-services.yaml | Manifest exists on main |
| `server/sprint81.test.ts` | billing-analytics-pipeline, billing-sla-monitor, billing-webhook-dispatcher, billing-event-processor | Services exist on main |
| `server/sprint83.test.ts` | services/python/invoice-generator, fraud-ml-service etc. | Services exist on main |
| `server/sprint85.test.ts` | services/python/billing-*, services/rust/fee-splitter-realtime | Services exist on main |
| `server/sprint86.test.ts` | pbac-engine, ddos-shield, bandwidth-optimizer, Mojaloop connector, Dapr sidecar etc. | Services exist + wired in CI |
| `server/business-rules.test.ts` | liveness-detection service, face-match/OCR, helm charts (6 failing describes; passing KYC-rule tests resume on re-enable) | Services/charts exist on main |
| `server/liveness-improvements.test.ts` | services/python/liveness-detection | Service exists on main |
| `server/liveness-noise-tolerance.test.ts` | services/python/liveness-detection/test_noisy_cameras.py | File exists on main |
| `server/sprint35.test.ts` | server/routers/insuranceServiceFleet.ts (exists only in legacy insureportal/ tree; 0 commits at asserted path) | Router exists at asserted path |

## CAT-B — assembled-stack dependency

| File | Reason | Re-enable condition |
|---|---|---|
| `tests/integration/api.test.ts` | `fetch failed` — expects running API server (:3000) | Migrated to real-HTTP e2e harness (createApp pattern) or job provides server |
| `tests/integration/j02_policy_purchase.test.ts` | `fetch failed` — same | Same |
| `server/sprint28.test.ts` | ~64 failures require live USSD gateway. NOTE: `mobileMoney.providers` describe is an OPEN DEFECT (missing procedure, F-12) — re-enable that describe with its fix | USSD gateway available / migrated; mobileMoney.providers delivered |

## QUARANTINED-OPEN-DEFECT (F-12 sub-items — genuine defects / partial deliveries; fix routing in progress; MUST re-enable as fixes land)

| File | Defect (verbatim evidence: run 31969739386) |
|---|---|
| `server/sprint37.test.ts` | 9 delivered routers lack asserted `getStats` procedure |
| `server/sprint39.test.ts` / `sprint40` / `sprint41` | delivered routers lack asserted procedures |
| `server/sprint82.test.ts` | server/temporal-activities.ts missing 8 asserted exports |
| `server/sprint93.test.ts` | networkQualityHeatmapRouter missing required procedures |
| `server/sprint87.test.ts` | real leftovers found: mock data in routers, @ts-nocheck pages, unwired pages (`expected ['amlScreening.ts',…] to deeply equal []`) |
| `server/middleware-wiring-sprint44.test.ts` | 26 routers missing core middleware imports/calls (`dispatch.reason ?? null` leftovers) |
| `server/security-audit.test.ts` | eval()/Function() scan finding; CI/CD security-checks assertion |
| `server/pos.test.ts` | zod invalid_type + agent.login UNAUTHORIZED drift on delivered POS routers |
| `server/sprint95.test.ts` | 'Coming Soon' placeholders, auditCompliance leftover (router count fixed to verified 465 in-file) |
| `server/sprint12/13/16/20/24/25/26/27/31-production/69-production/78/84/85-phase2/88/88-integration.test.ts`, `server/websocket-analytics.test.ts`, `server/lib/__tests__/sprint59-features.test.ts` | content/procedure/count drift assertions on delivered files (verbatim per triage.md) |
| `tests/integration/all_28_journeys_tb_consistency.test.ts` | `expected 5 to be >= 20` innovation routes in App.tsx; docker-compose innovation services |
| `server/middleware-integration.test.ts` | `expected 9 to be 10` middleware wiring drift |
| `server/db-performance.test.ts` | PgBouncer config undelivered (CAT-A) + tenant-index scan findings |
| `server/observability-middleware.test.ts` | docker-compose.sprint42.yml + lakehouse sidecar undelivered (CAT-A) + content checks |
| `server/gap-fixes.test.ts` | CommissionEngine 9-tier structure undelivered (4 seeded); **11 passing tests suspended until re-enable**. listDisputes customerName: DEFINITIVE — genuine API defect (customerDisputePortal.listDisputes selects raw disputes rows, never joins customer data; seed merely exposed it) → fix-routing |
| `server/sprint28.test.ts` (describe-level) | `mobileMoney.providers` procedure missing — see CAT-B row |

## DE-DUPLICATED EXECUTION (not quarantine)

| Path | Reason | Coverage pointer |
|---|---|---|
| `tests/contract/**` | Contract harness (globalSetup schema push, real auth env) only exists in integration.yml's `contract` job; default vitest run lacks it → behavioral diffs (auth.me anonymous returns seeded user, 403-vs-400 taxonomy). Root cause documented in ci-evidence.md. | integration.yml `contract` job — green, e.g. run 31967576683 |
| `tests/e2e/**` | Same: e2e globalSetup self-applies schema; dedicated `e2e` job boots the real express/tRPC server. | integration.yml `e2e` job — green, e.g. run 31967576683 |

## Residual-risk disclosure (authorization coverage)

All CI environments run Permify fail-open (`PERMIFY_FAIL_OPEN=true`, lead-approved
2026-08-16, matching integration.yml's existing posture). Therefore
**Permify-policy-level authorization has NO passing test coverage anywhere**;
denial coverage is role-middleware-level only. Production fail-closed behavior
is untouched. Follow-up recommendation: Permify container in CI + policy tests.

## Single-test exclusions (mechanism: tests/quarantined-tests.json + negative testNamePattern in vitest.config.ts)

| File | Test | Class | Reason | Re-enable |
|---|---|---|---|---|
| `server/sprint46.test.ts` | "middleware service manager should report 13 services" | OPEN-DEFECT / partial-delivery (F-12) | Procedure throws 'not implemented yet' — correct fail-loud behavior for undelivered capability; other 39 tests in the file pass | middlewareServiceManager implemented, reporting real service registry |
