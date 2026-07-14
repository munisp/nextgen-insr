# Test Plan: Underwriting Column Fix + Port Hardcoding Fix

## What Changed
1. **agentic-underwriting/main.go**: SELECT queries in `handleList` (line 253) and `handleGetByID` (line 309) changed from querying non-existent columns (`premium_modifier`, `auto_decided`) to actual DB columns (`premium_quoted`, `risk_score`, `risk_class`). CREATE TABLE schema also aligned.
2. **7 services**: Port assignment changed from `port := ":XXXX"` to `port := os.Getenv("PORT"); if port == "" { port = ":XXXX" }` in claims-adjudication-engine, communication-service, reinsurance-service, underwriting-engine, policy-lifecycle-service, premium-collection-service, ai-claims-auto-adjudication.

## Test 1: Underwriting handleList returns HTTP 200 with correct columns (was HTTP 500)

**Why adversarial**: Before the fix, this exact request returned HTTP 500 with `column "premium_modifier" does not exist`. If the fix is broken, the same error will appear.

### Steps:
1. Start agentic-underwriting with `PORT=:9301`
2. Wait for health check: `curl http://localhost:9301/health` → expect `200`
3. Create a test record: `curl -X POST http://localhost:9301/api/v1/decisions/create -d '{"application_id":"TEST-001","decision":"approved","premium_quoted":25000,"risk_score":42.5,"risk_class":"standard"}'` → expect `201` with `{"id":N,"status":"created"}`
4. **Critical assertion — handleList**: `curl http://localhost:9301/api/v1/decisions` → expect HTTP `200` with JSON containing `"data"` array where each item has keys: `id`, `application_id`, `decision`, `premium_quoted`, `risk_score`, `risk_class`, `created_at`. Must NOT contain `premium_modifier` or `auto_decided`. Must NOT return HTTP 500.
5. **Critical assertion — handleGetByID**: `curl http://localhost:9301/api/v1/decision?id=N` (using ID from step 3) → expect HTTP `200` with JSON containing the same correct columns. Must NOT return HTTP 500.
6. Verify `premium_quoted` value is `"25000"` (string from []byte scan), NOT base64-encoded.
7. Verify `risk_score` value is `"42.5"` (string), NOT base64-encoded.

### Pass criteria:
- handleList returns HTTP 200 (not 500)
- Response JSON keys include `premium_quoted`, `risk_score`, `risk_class`
- Response JSON keys do NOT include `premium_modifier` or `auto_decided`
- Numeric values are human-readable strings, not base64

### Fail criteria:
- HTTP 500 with "column does not exist" error
- Response contains `premium_modifier` or `auto_decided` keys
- Numeric values are base64-encoded (e.g. `"MjUwMDA="`)

---

## Test 2: Port hardcoding fix — services respect PORT env var

**Why adversarial**: Before the fix, setting `PORT=:9999` had no effect — the service would bind to its hardcoded port (e.g. 8091). If the fix is broken, curl to port 9999 will fail with "connection refused" while the hardcoded port responds.

### Steps (test 3 representative services from the 7 fixed):

#### 2a: claims-adjudication-engine (default :8091)
1. Start with `PORT=:9401`: `PORT=:9401 go run claims-adjudication-engine/main.go &`
2. `curl http://localhost:9401/health` → expect HTTP 200
3. `curl http://localhost:8091/health` → expect "connection refused" (proves it's NOT on old port)

#### 2b: ai-claims-auto-adjudication (default :8120)
1. Start with `PORT=:9402`: `PORT=:9402 go run ai-claims-auto-adjudication/main.go &`
2. `curl http://localhost:9402/health` → expect HTTP 200
3. `curl http://localhost:8120/health` → expect "connection refused"

#### 2c: underwriting-engine (default :8096)
1. Start with `PORT=:9403`: `PORT=:9403 go run underwriting-engine/main.go &`
2. `curl http://localhost:9403/health` → expect HTTP 200
3. `curl http://localhost:8096/health` → expect "connection refused"

### Pass criteria (each sub-test):
- Custom PORT responds with HTTP 200 on /health
- Old hardcoded port returns "connection refused"

### Fail criteria:
- Custom PORT returns "connection refused" (service ignored PORT env var)
- Old hardcoded port returns HTTP 200 (service still using hardcoded port)

---

## Test 3: Default port fallback (no PORT env var set)

**Why adversarial**: The fix must not break services that don't set PORT. If the fallback is broken, the service won't start at all.

1. Start claims-adjudication-engine WITHOUT PORT env var: `go run claims-adjudication-engine/main.go &`
2. `curl http://localhost:8091/health` → expect HTTP 200 (default port works)

### Pass: HTTP 200 on default port
### Fail: Service crashes or binds to wrong port
