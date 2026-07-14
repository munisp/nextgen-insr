# Test Plan: Graceful Shutdown + KEDA Scaling + ReadinessProbes

## What Changed
- **Go (14 services):** Added `signal.Notify(SIGTERM/SIGINT)` → `srv.Shutdown(ctx)` with 30s drain timeout
- **Python (7 FastAPI services):** Added `lifespan` context manager with signal handlers + DB cleanup
- **Rust (5 actix/axum services):** Added `shutdown_timeout(30)` + `tokio::signal::ctrl_c()` drain
- **K8s:** `readinessProbe` added to 9 deployments in `new-services.yaml`
- **KEDA:** 9 `ScaledObject` manifests (5 Kafka + 4 HTTP)

## Testing Approach
All changes are backend/infrastructure — no browser UI involved. Testing via shell commands only (no recording needed).

---

## Test 1: Node.js monolith graceful shutdown on SIGTERM

**Why adversarial:** If the shutdown handler is broken, SIGTERM would kill the process instantly (exit code 137/SIGTERM) without printing the graceful shutdown log messages. A working implementation prints specific log lines and exits with code 0.

**Steps:**
1. Start server in background: `cd customer-portal-full && node server.cjs &`
2. Wait for `InsurePortal running at http://localhost:5002`
3. Verify `/health` returns `{ status: 'healthy' }` (HTTP 200)
4. Send `SIGTERM` to the server PID
5. Capture stdout/stderr

**Pass criteria:**
- Output contains `SIGTERM received — shutting down gracefully...`
- Output contains `HTTP server closed`
- Process exits with code 0 (not 137)
- After shutdown, `curl localhost:5002/health` returns connection refused

## Test 2: Node.js monolith serves requests until shutdown completes

**Why adversarial:** A broken shutdown could stop accepting requests immediately on SIGTERM. The correct behavior is: stop accepting NEW connections but finish in-flight ones.

**Steps:**
1. Start server, verify health
2. Send SIGTERM
3. Immediately (within 100ms) try to hit `/health` — it may or may not succeed depending on timing, but the server should NOT crash with an unhandled error

**Pass criteria:**
- Server does not crash with unhandled exception
- Shutdown logs appear in correct order

## Test 3: Test suites pass (regression)

**Why adversarial:** Our changes touched server.cjs imports/shutdown code. If we broke anything, the 31-assertion test suite will catch it.

**Steps:**
1. `cd customer-portal-full && npm test`

**Pass criteria:**
- All 31 assertions in `server.test.cjs` pass
- All 12 steps in `e2e-smoke.test.cjs` pass
- Exit code 0

## Test 4: Python service syntax validation (all 7 modified services)

**Why adversarial:** The lifespan context manager uses `asynccontextmanager` and signal handlers. A syntax error or import error would cause `py_compile` to fail. If lifespan parameter is wrong, FastAPI will raise at import time.

**Steps:**
1. Run `python3 -c "import py_compile; py_compile.compile('FILE', doraise=True)"` for each of the 7 modified Python services

**Pass criteria:**
- All 7 compile without errors: ifrs17-engine, mlops-governance, data-lakehouse, ai-underwriting-engine, lakehouse-analytics, actuarial-platform, predictive-analytics
- Each returns exit code 0

## Test 5: K8s manifest YAML validation

**Why adversarial:** A malformed YAML (bad indentation, wrong field names) would cause `kubectl apply` to fail. We can validate syntax without a cluster.

**Steps:**
1. `python3 -c "import yaml; yaml.safe_load_all(open('k8s/services/new-services.yaml'))"` — validates YAML syntax
2. Count `readinessProbe` occurrences — must be exactly 10 (1 existing + 9 added)
3. Count `livenessProbe` occurrences — must be exactly 10 (all deployments)
4. Validate KEDA manifests: parse both keda-kafka-scalers.yaml and keda-http-scalers.yaml

**Pass criteria:**
- YAML parses without error
- `readinessProbe` count = 10
- `livenessProbe` count = 10
- KEDA manifests parse without error
- KEDA kafka file has 5 ScaledObject resources
- KEDA http file has 4 ScaledObject resources

## Test 6: Go service compilation check (modified services)

**Why adversarial:** Adding `os/signal`, `syscall`, `context` imports and the shutdown goroutine could cause compile errors if imports are wrong or variable names conflict. `go vet` catches these.

**Steps:**
1. Run `go vet ./...` in each of the 5 modified Go service directories that we changed in this session (kyc-enforcement-go, goaml-integration-go, aml-case-manager-go, health-checker, circuit-breaker)

**Pass criteria:**
- All 5 pass `go vet` with exit code 0
- No unused import errors
- No undefined variable errors

## Test 7: KEDA ScaledObject structure validation

**Why adversarial:** KEDA requires specific fields (`scaleTargetRef.name`, `triggers[].type`, `triggers[].metadata`). Missing or wrong fields cause silent failures in production.

**Steps:**
1. Parse each ScaledObject in keda-kafka-scalers.yaml
2. Verify each has: `scaleTargetRef.name`, `pollingInterval`, `cooldownPeriod`, `minReplicaCount`, `maxReplicaCount`, `triggers[0].type == "kafka"`, `triggers[0].metadata.bootstrapServers`, `triggers[0].metadata.consumerGroup`, `triggers[0].metadata.topic`, `triggers[0].metadata.lagThreshold`
3. Parse each ScaledObject in keda-http-scalers.yaml
4. Verify each has: same structure but `triggers[0].type == "prometheus"`, `triggers[0].metadata.serverAddress`, `triggers[0].metadata.query`, `triggers[0].metadata.threshold`

**Pass criteria:**
- All 5 Kafka ScaledObjects have required fields
- All 4 HTTP ScaledObjects have required fields
- No ScaledObject has minReplicaCount > maxReplicaCount
