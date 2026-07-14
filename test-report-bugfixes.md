# Test Report: Underwriting Column Fix + Port Hardcoding Fix

**PR:** [#30](https://github.com/munisp/nextgen-insr/pull/30)  
**Commit:** `c80fa16`  
**CI:** 54/54 green  
**Date:** 2026-06-08  

## Summary
Tested 2 bug fixes: underwriting column mismatch (HTTP 500 → 200) and port hardcoding in 7 services. All shell-based testing against PostgreSQL localhost.

## Results: 5/5 PASSED

### Test 1: Underwriting handleList — PASSED
- **Before fix:** `GET /api/v1/decisions` returned HTTP 500 (`column "premium_modifier" does not exist`)
- **After fix:** HTTP 200 with correct JSON
- Health check on PORT=9301: HTTP 200
- POST `/api/v1/decisions/create` with test data: HTTP 201, ID=8
- **GET `/api/v1/decisions` (handleList): HTTP 200** — response contains `premium_quoted`, `risk_score`, `risk_class` keys. Does NOT contain `premium_modifier` or `auto_decided`.
- **GET `/api/v1/decision?id=8` (handleGetByID): HTTP 200** — same correct columns
- `premium_quoted` = `"25000"` (not base64 `"MjUwMDA="`), `risk_score` = `"42.5"` (not base64)

### Test 2a: claims-adjudication-engine PORT override — PASSED
- Started with `PORT=:9401`
- `curl localhost:9401/health` → HTTP 200
- `curl localhost:8091/health` → connection refused (old hardcoded port not used)

### Test 2b: ai-claims-auto-adjudication PORT override — PASSED
- Started with `PORT=:9402`
- `curl localhost:9402/health` → HTTP 200
- `curl localhost:8120/health` → connection refused (old hardcoded port not used)

### Test 2c: underwriting-engine PORT override — PASSED
- Started with `PORT=:9403`
- `curl localhost:9403/health` → HTTP 200
- `curl localhost:8096/health` → connection refused (old hardcoded port not used)

### Test 3: Default port fallback — PASSED
- Started claims-adjudication-engine WITHOUT PORT env var
- `curl localhost:8091/health` → HTTP 200 (default fallback works)

## Escalations
None — all tests passed as expected.

## Evidence
All testing was shell-based (Go microservices + curl). Key outputs:

**handleList response (was HTTP 500, now HTTP 200):**
```json
{"data":[{"application_id":"TEST-001","created_at":"2026-06-08T21:51:14.420249Z","decision":"approved","id":8,"premium_quoted":"25000","risk_class":"standard","risk_score":"42.5"}],"limit":20,"page":1,"total":3}
```

**Port override proof (claims-adjudication-engine):**
```
PORT=:9401 → "Claims Adjudication Engine starting on :9401" → curl :9401/health = 200, curl :8091/health = refused
```
