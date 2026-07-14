# Test Plan: 5 Production Readiness Gaps (PR #30)

**PR:** https://github.com/munisp/nextgen-insr/pull/30  
**Testing type:** Shell-only (Go microservices, no browser UI)  
**Recording:** None (no visual interactions)

## What Changed
PR #30 implements 5 production readiness gaps:
1. Cross-service integration tests (`tests/integration/`)
2. k6 load/stress tests (`tests/load/`)
3. TLS/mTLS cert generation + Go helper (`infra/tls/` + `shared/tls/`)
4. Vault secrets management + Go client (`infra/vault/` + `shared/vault/`)
5. E2E specialty service tests (`tests/e2e/`)
6. Master deployment script (`scripts/deploy/production_deploy.sh`)
7. Production runbook (`docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`)

## Environment
- PostgreSQL: localhost:5432/insureportal_test (ubuntu/testpass123), 70 tables
- Go: available
- openssl: 3.0.2 available
- k6: NOT installed (syntax validation only)
- vault: NOT installed (syntax validation only)
- CI: 54/54 green

---

## Test 1: Integration Test Compilation
**What:** Verify `tests/integration/insurance_workflow_test.go` compiles
**Steps:**
1. `cd tests/integration && go vet ./...`
**Pass criteria:** Exit code 0, zero errors
**Why adversarial:** A broken test file (wrong imports, type errors, missing functions) would produce non-zero exit code

## Test 2: Integration Test Runtime — Full CRUD Lifecycle
**What:** Start 3 core services, run integration test against them, verify real DB operations
**Steps:**
1. Start `agentic-underwriting` on PORT=9301
2. Start `claims-adjudication-engine` on PORT=9304
3. Start `instant-payout-service` on PORT=9305
4. Wait 5s for services to initialize
5. Verify health: `curl localhost:9301/health` → HTTP 200, body contains `"status":"ok"` or `"database":"connected"`
6. Run `go test -v -run TestFullInsuranceWorkflow -timeout 60s ./...` from `tests/integration/`
7. Check test output for:
   - "Step1_HealthChecks" contains "services healthy" with count ≥ 1
   - "Step2_CreateQuoteAndUnderwrite" contains "Quote created: ID=" with a numeric ID
   - "Step7_FileClaim" or "Step9_ProcessPayout" shows successful creation
   - "Step13_VerifyStats" shows stats with actual counts (not 0 for all)
**Pass criteria:** `go test` exits 0 AND at least health + create quote + create payout pass with real data
**Why adversarial:** Empty stub services would return 404/500 on CRUD endpoints; base64-corrupted data would show garbled IDs; broken route registration would return 404

## Test 3: TLS Certificate Generation + Validation
**What:** Run TLS setup script, verify real certs are generated and valid
**Steps:**
1. `cd infra/tls && bash setup_tls.sh generate`
2. Verify Root CA exists: `ls -la certs/ca/ca.crt certs/ca/ca.key` — both files > 0 bytes
3. Count server certs: `ls certs/server/*/server.crt | wc -l` — expect ≥ 20
4. Count client certs: `ls certs/client/*/client.crt | wc -l` — expect ≥ 20
5. Validate one cert against CA: `openssl verify -CAfile certs/ca/ca.crt certs/server/underwriting/server.crt` — expect "OK"
6. Check cert SAN: `openssl x509 -in certs/server/underwriting/server.crt -noout -text | grep -A5 "Subject Alternative Name"` — expect `underwriting.insureportal.ng`
7. Run `bash setup_tls.sh validate` — expect all certs valid
**Pass criteria:** 20+ server certs, 20+ client certs, all validate against Root CA, SANs contain correct domain names
**Why adversarial:** A broken script would generate 0 certs or certs that fail validation; wrong SANs would show generic names instead of service-specific FQDNs

## Test 4: Shared Vault Client Compilation
**What:** Verify `shared/vault/client.go` compiles and exports expected functions
**Steps:**
1. `cd shared && go vet ./vault/`
2. `grep -c 'func ' vault/client.go` — expect ≥ 3 functions (New, GetSecret, GetDatabaseURL)
**Pass criteria:** Exit code 0, ≥ 3 exported functions
**Why adversarial:** A stub file with no real logic would have < 3 functions; compilation errors mean the client can't be imported by services

## Test 5: Shared TLS Server Helper Compilation
**What:** Verify `shared/tls/server.go` compiles and exports expected functions
**Steps:**
1. `cd shared && go vet ./tls/`
2. `grep -c 'func ' tls/server.go` — expect ≥ 2 functions (NewTLSServer, ListenAndServe)
**Pass criteria:** Exit code 0, ≥ 2 exported functions
**Why adversarial:** Same as Test 4

## Test 6: E2E Specialty Test Compilation
**What:** Verify `tests/e2e/specialty_services_test.go` compiles
**Steps:**
1. `cd tests/e2e && go vet ./...`
**Pass criteria:** Exit code 0, zero errors
**Why adversarial:** Compilation failure means tests can never run in any environment

## Test 7: E2E Specialty Test — Domain Logic Verification
**What:** Start 1 specialty service (AI claims), run domain-specific test against it
**Steps:**
1. Find AI claims service: `find . -name main.go -path "*ai-claims*" -o -name main.go -path "*auto-adjud*"` 
2. Start the service on PORT=9320
3. Run `go test -v -run TestAIClaimsAutoAdjudication -timeout 30s ./...` from `tests/e2e/`
4. Check output for:
   - HealthCheck passes (HTTP 200)
   - HighRiskClaimRejected: result contains "decision" field
   - LowRiskClaimApproved: result contains "decision" field
**Pass criteria:** Test passes with domain-specific response data (decision field present in adjudication responses)
**Why adversarial:** A generic CRUD stub wouldn't have an `/api/v1/adjudicate` endpoint returning decision fields; it would 404

## Test 8: k6 Load Test Syntax Validation
**What:** Verify k6 script is valid JavaScript with correct structure
**Steps:**
1. `node -e "require('fs').readFileSync('tests/load/nationwide_load_test.js','utf8')"` — no parse error
2. Verify 3 scenarios exist: `grep -c 'executor:' tests/load/nationwide_load_test.js` — expect 3
3. Verify thresholds: `grep 'p(95)' tests/load/nationwide_load_test.js` — expect threshold definitions
**Pass criteria:** Valid JS, 3 scenarios defined, thresholds for P95/P99/error rate present
**Why adversarial:** An empty/broken JS file would fail parse; missing scenarios would show count < 3
**Limitation:** k6 not installed — cannot execute load test. Syntax validation only.

## Test 9: Vault Script Syntax Validation
**What:** Verify vault setup script has valid bash syntax and correct structure
**Steps:**
1. `bash -n infra/vault/setup_vault.sh` — syntax check
2. `grep -c 'vault kv put' infra/vault/setup_vault.sh` — expect ≥ 5 secret paths
3. `grep 'insureportal/global/database' infra/vault/setup_vault.sh` — expect DB secret path
4. `grep 'kubernetes' infra/vault/setup_vault.sh` — expect K8s auth config
**Pass criteria:** Valid bash syntax, ≥ 5 vault kv put commands, database + K8s auth sections present
**Limitation:** vault CLI not installed — cannot execute. Structure validation only.

## Test 10: Deploy Script Preflight Mode
**What:** Run deployment script in safe preflight mode
**Steps:**
1. `bash scripts/deploy/production_deploy.sh preflight 2>&1`
2. Check output for: tool checks (docker, kubectl, helm, etc.), no destructive operations
**Pass criteria:** Script runs without bash errors (exit code 0 or graceful "tool not found" messages), does NOT attempt actual deployments
**Why adversarial:** A broken script would crash with bash syntax errors; a dangerous script would attempt real deployments in preflight mode

## Test 11: Runner Script — Service Directory Validation
**What:** Verify integration test runner script correctly references all service directories
**Steps:**
1. `bash -n tests/integration/run_integration_tests.sh` — syntax check
2. Extract service dirs from script and verify each exists with main.go
3. `bash -n tests/e2e/run_e2e_tests.sh` — syntax check
**Pass criteria:** Both scripts have valid syntax, all referenced directories exist
**Why adversarial:** Wrong directory names would cause the runner to skip services silently

## Test 12: Runtime Data Integrity — No Base64 Corruption
**What:** Verify NUMERIC fields return actual numbers, not base64-encoded strings
**Steps:**
1. With underwriting service running (from Test 2), create a record with `premium_quoted: 75000.00`
2. GET the record back
3. Check response: `premium_quoted` field should be `75000` or `75000.00`, NOT `"NzUwMDA="` (base64)
**Pass criteria:** Numeric fields in GET response are actual numbers, not base64 strings
**Why adversarial:** The base64 bug (previously affecting 38 services) would show garbled string values for any NUMERIC column; this specifically verifies the fix works at runtime

---

## Summary of Limitations
- **k6 not installed:** Load test (Test 8) limited to syntax validation
- **vault not installed:** Vault script (Test 9) limited to syntax/structure validation
- **No staging/production environment:** All testing is local only
- **Cannot test all 75 services:** Will test 3-4 representative services, not all 75
