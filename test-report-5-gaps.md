# Test Report: 5 Production Readiness Gaps (PR #30)

**PR:** https://github.com/munisp/nextgen-insr/pull/30  
**CI:** 54/54 green  
**Date:** 2026-06-08  
**Session:** https://app.devin.ai/sessions/0475192a778b45cea30202f85ad52b63  
**Testing type:** Shell-only (Go microservices)

---

## Summary

Executed 12 tests covering all 5 production readiness gap implementations. **10 passed, 1 partial pass, 1 bug found during testing.**

**Escalations:**
1. **BUG: Underwriting `handleList` queries non-existent columns** — `/api/v1/decisions` returns HTTP 500 with `column "premium_modifier" does not exist`. The `handleList` SELECT references `premium_modifier` and `auto_decided` columns that aren't in the actual `underwriting_decisions` table. The CREATE TABLE in main.go defines a different schema than what exists in the database (CREATE TABLE IF NOT EXISTS means the new schema never gets applied over the existing table). This likely affects the `handleGetByID` endpoint as well.
2. **Port hardcoding mismatch** — Multiple services (claims=8091, communication=8093, reinsurance=8095, underwriting=8096, policy=8097, premium=8098, AI claims=8120) hardcode their port and ignore the `PORT` env var. The runner script (`run_integration_tests.sh`) tries to start services with `PORT=$PORT go run main.go`, but services with hardcoded ports will bind to their own port, not the runner's assigned port. The runner then sets env vars pointing to the wrong port.

---

## Test Results

| # | Test | Result | Evidence |
|---|------|--------|----------|
| 1 | Integration test compilation (`go vet`) | **PASSED** | Exit code 0, zero errors |
| 2 | Integration test runtime — CRUD lifecycle | **PARTIAL** | 3/10 services tested. Quote created (ID=6), claim adjudicated (decision=pending_review, risk_score=40, confidence=0.75), payout processed (ID=6). Test exits 1 because Step4 fatals when policy-lifecycle not running. |
| 3 | TLS cert generation + validation | **PASSED** | 20 server certs + 20 client certs generated. All 40 validate against Root CA. SANs include `underwriting.insureportal.ng` + K8s DNS + localhost. CA valid 10yr, server certs valid 1yr. |
| 4 | Shared vault client compilation | **PASSED** | `go vet ./vault/` — exit code 0 |
| 5 | Shared TLS server helper compilation | **PASSED** | `go vet ./tls/` — exit code 0 |
| 6 | E2E specialty test compilation | **PASSED** | `go vet ./...` — exit code 0 |
| 7 | E2E specialty test runtime — AI claims | **PASSED** | HealthCheck PASS, HighRiskClaimRejected PASS, LowRiskClaimApproved PASS (0.007s) |
| 8 | k6 load test syntax validation | **PASSED** | Valid JS, 3 scenarios (steady_state, spike_test, soak_test), thresholds: P95<2s, P99<5s, error<5% |
| 9 | Vault script syntax + structure | **PASSED** | Valid bash, 11 `vault kv put` commands, database + K8s auth sections present |
| 10 | Deploy script preflight | **PASSED** | 76/76 Go services compiled. Correctly reports missing tools (kubectl, helm, k6, vault) as warnings. No destructive ops. |
| 11 | Runner script directory validation | **PASSED** | Both scripts valid bash. All 10 service directories exist with main.go. |
| 12 | Runtime data integrity — base64 check | **PASSED** | Payout service returns `"amount":"420000.00"` (numeric string), NOT base64 `"NDIwMDAwLjAw"`. Base64 fix confirmed working. |

---

## Detailed Findings

### Bug: Underwriting handleList Column Mismatch

**File:** `agentic-underwriting/main.go:253`  
**Severity:** High — list/get endpoints are broken

The `handleList` function queries:
```sql
SELECT id, application_id, risk_score, decision, premium_modifier, auto_decided, created_at
FROM underwriting_decisions
```

But the actual table schema (verified via `\d underwriting_decisions`):
```
id             | integer
application_id | text
decision       | text
premium_quoted | numeric
risk_score     | numeric
risk_class     | text
created_at     | timestamp
```

Columns `premium_modifier` and `auto_decided` do not exist. The `CREATE TABLE IF NOT EXISTS` in the same main.go defines a different schema (with `premium_modifier NUMERIC(5,4)`, `auto_decided BOOLEAN`) but this never runs because the table already exists from prior migrations.

**Impact:** GET `/api/v1/decisions` and `/api/v1/decision?id=X` return HTTP 500 with raw PostgreSQL error. Creates work fine because `handleCreate` uses the correct columns.

### Finding: Port Hardcoding

| Service | Hardcoded Port | Runner Expects |
|---------|---------------|----------------|
| claims-adjudication-engine | 8091 | 9304 |
| communication-service | 8093 | 9306 |
| reinsurance-management | 8095 | 9308 |
| underwriting-engine | 8096 | N/A (different dir) |
| policy-lifecycle-service | 8097 | 9302 |
| premium-collection-service | 8098 | 9303 |
| ai-claims-auto-adjudication | 8120 | 9320 |

Services using `os.Getenv("PORT")` (configurable): agentic-underwriting, instant-payout, audit-trail, naicom-compliance, fraud-detection-go.

The runner script tries `PORT=$PORT go run main.go` but services with hardcoded ports ignore the PORT env var entirely.

### Limitation: k6 and Vault not installed locally

- k6 load test validated for syntax only — cannot execute load scenarios
- Vault script validated for structure only — cannot test secret operations
- Both would need to be installed for full validation

---

## What Was Verified Working

1. **TLS/mTLS infrastructure** — Full cert hierarchy generates and validates correctly (Root CA 4096-bit → 20 server + 20 client certs with proper SANs)
2. **Integration test framework** — Compiles, connects to live services, executes real CRUD with PostgreSQL-backed storage
3. **E2E specialty tests** — AI claims adjudication runs domain logic (risk scoring, high/low risk decisions) with real HTTP calls
4. **Deployment script** — Preflight mode correctly checks for tools, compiles all 76 services, reports missing env vars
5. **Base64 fix** — NUMERIC fields return actual values, not base64 garbage
6. **Shared libraries** — Both vault/client.go and tls/server.go compile cleanly
7. **All runner scripts** — Valid bash syntax, correct service directory references
