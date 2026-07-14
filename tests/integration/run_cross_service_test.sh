#!/bin/bash
# Cross-Service Integration Test Runner
# Proves: quote → underwrite → bind → claim → payout works end-to-end
# Usage: ./run_cross_service_test.sh

set -e

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_URL="${DATABASE_URL:-postgres:///middleware_test_db?host=/var/run/postgresql}"
PIDS=()

cleanup() {
    echo "Cleaning up..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null
}
trap cleanup EXIT

echo "=== Cross-Service Integration Test ==="
echo "Building 10 services..."

SERVICES=(
    "agentic-underwriting:9301"
    "policy-lifecycle-service:9302"
    "premium-collection-service:9303"
    "claims-adjudication-engine:9304"
    "instant-payout-service:9305"
    "communication-service:9306"
    "audit-trail-system:9307"
    "reinsurance-management:9308"
    "naicom-compliance-module:9309"
    "fraud-detection-go:9310"
)

# Build all services
for entry in "${SERVICES[@]}"; do
    svc="${entry%%:*}"
    echo "  Building $svc..."
    (cd "$REPO_ROOT/$svc" && go build -o "/tmp/inttest-$svc" .) || {
        echo "FAIL: $svc build failed"
        exit 1
    }
done
echo "All 10 built successfully."

# Start all services
echo "Starting services..."
for entry in "${SERVICES[@]}"; do
    svc="${entry%%:*}"
    port="${entry##*:}"
    DATABASE_URL="$DB_URL" DEV_AUTH_BYPASS=true PORT="$port" "/tmp/inttest-$svc" > "/tmp/inttest-$svc.log" 2>&1 &
    PIDS+=($!)
done

# Wait for health
echo "Waiting for services to be ready..."
sleep 3

HEALTHY=0
for entry in "${SERVICES[@]}"; do
    svc="${entry%%:*}"
    port="${entry##*:}"
    if curl -sf "http://localhost:$port/health" > /dev/null 2>&1; then
        HEALTHY=$((HEALTHY + 1))
    else
        echo "  WARNING: $svc (port $port) not healthy"
    fi
done
echo "$HEALTHY/10 services healthy."

if [ "$HEALTHY" -lt 5 ]; then
    echo "FAIL: Not enough services healthy to run integration test"
    exit 1
fi

# Run the Go integration test
echo ""
echo "=== Running Integration Test ==="
cd "$REPO_ROOT/tests/integration"
export UNDERWRITING_URL="http://localhost:9301"
export POLICY_LIFECYCLE_URL="http://localhost:9302"
export PREMIUM_COLLECTION_URL="http://localhost:9303"
export CLAIMS_URL="http://localhost:9304"
export PAYOUT_URL="http://localhost:9305"
export COMMUNICATION_URL="http://localhost:9306"
export AUDIT_URL="http://localhost:9307"
export REINSURANCE_URL="http://localhost:9308"
export NAICOM_URL="http://localhost:9309"
export FRAUD_URL="http://localhost:9310"

go test -v -run TestFullInsuranceWorkflow -timeout 60s ./...

echo ""
echo "=== PASS: Cross-service integration test complete ==="
echo "Workflow verified: quote → underwrite → bind → collect premium → claim → adjudicate → payout"
