#!/usr/bin/env bash
# =============================================================================
# Cross-Service Integration Test Runner
# Tests the full insurance workflow: quote→underwrite→bind→claim→payout
#
# Usage:
#   LOCAL:      ./run_integration_tests.sh local
#   STAGING:    ./run_integration_tests.sh staging
#   PRODUCTION: ./run_integration_tests.sh production
# =============================================================================
set -euo pipefail

ENV="${1:-local}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$REPO_DIR/tests/integration/results"
mkdir -p "$LOG_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/integration_${ENV}_${TIMESTAMP}.log"

echo "=== Insurance Platform Integration Tests ===" | tee "$LOG_FILE"
echo "Environment: $ENV" | tee -a "$LOG_FILE"
echo "Started: $(date -u)" | tee -a "$LOG_FILE"

# ---------------------------------------------------------------------------
# Environment-specific configuration
# ---------------------------------------------------------------------------
case "$ENV" in
  local)
    export DATABASE_URL="${DATABASE_URL:-postgres://ubuntu:testpass123@localhost:5432/insureportal_test?sslmode=disable}"
    BASE_PORT=9301
    SERVICES=(
      "agentic-underwriting:UNDERWRITING_URL"
      "policy-lifecycle-service:POLICY_LIFECYCLE_URL"
      "premium-collection-service:PREMIUM_COLLECTION_URL"
      "claims-adjudication-engine:CLAIMS_URL"
      "instant-payout-service:PAYOUT_URL"
      "communication-service:COMMUNICATION_URL"
      "audit-trail-system:AUDIT_URL"
      "reinsurance-management:REINSURANCE_URL"
      "naicom-compliance-module:NAICOM_URL"
      "fraud-detection-go:FRAUD_URL"
    )
    PIDS=()

    echo "Starting services locally..." | tee -a "$LOG_FILE"
    PORT=$BASE_PORT
    for svc_entry in "${SERVICES[@]}"; do
      SVC="${svc_entry%%:*}"
      ENV_VAR="${svc_entry##*:}"
      SVC_DIR="$REPO_DIR/$SVC"
      if [ ! -f "$SVC_DIR/main.go" ]; then
        echo "  SKIP: $SVC (no main.go)" | tee -a "$LOG_FILE"
        PORT=$((PORT + 1))
        continue
      fi
      export "$ENV_VAR=http://localhost:$PORT"
      echo "  Starting $SVC on port $PORT..." | tee -a "$LOG_FILE"
      cd "$SVC_DIR"
      PORT=$PORT DATABASE_URL="$DATABASE_URL" go run main.go &
      PIDS+=($!)
      PORT=$((PORT + 1))
    done
    sleep 5
    ;;

  staging)
    # In staging, services run in Kubernetes with known service names
    NAMESPACE="${K8S_NAMESPACE:-insureportal-staging}"
    DOMAIN="${STAGING_DOMAIN:-staging.insureportal.ng}"
    export UNDERWRITING_URL="https://underwriting.$DOMAIN"
    export POLICY_LIFECYCLE_URL="https://policy.$DOMAIN"
    export PREMIUM_COLLECTION_URL="https://premium.$DOMAIN"
    export CLAIMS_URL="https://claims.$DOMAIN"
    export PAYOUT_URL="https://payout.$DOMAIN"
    export COMMUNICATION_URL="https://communication.$DOMAIN"
    export AUDIT_URL="https://audit.$DOMAIN"
    export REINSURANCE_URL="https://reinsurance.$DOMAIN"
    export NAICOM_URL="https://naicom.$DOMAIN"
    export FRAUD_URL="https://fraud.$DOMAIN"
    echo "Using staging URLs at $DOMAIN" | tee -a "$LOG_FILE"
    ;;

  production)
    DOMAIN="${PRODUCTION_DOMAIN:-api.insureportal.ng}"
    export UNDERWRITING_URL="https://underwriting.$DOMAIN"
    export POLICY_LIFECYCLE_URL="https://policy.$DOMAIN"
    export PREMIUM_COLLECTION_URL="https://premium.$DOMAIN"
    export CLAIMS_URL="https://claims.$DOMAIN"
    export PAYOUT_URL="https://payout.$DOMAIN"
    export COMMUNICATION_URL="https://communication.$DOMAIN"
    export AUDIT_URL="https://audit.$DOMAIN"
    export REINSURANCE_URL="https://reinsurance.$DOMAIN"
    export NAICOM_URL="https://naicom.$DOMAIN"
    export FRAUD_URL="https://fraud.$DOMAIN"
    echo "Using production URLs at $DOMAIN" | tee -a "$LOG_FILE"
    echo "WARNING: Running against production!" | tee -a "$LOG_FILE"
    ;;

  *)
    echo "Usage: $0 {local|staging|production}"
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# Run Go integration tests
# ---------------------------------------------------------------------------
echo "" | tee -a "$LOG_FILE"
echo "Running Go integration tests..." | tee -a "$LOG_FILE"
cd "$SCRIPT_DIR"

# Create go.mod if not exists
if [ ! -f go.mod ]; then
  go mod init integration_tests
  go mod tidy 2>/dev/null || true
fi

go test -v -timeout 120s -run TestFullInsuranceWorkflow ./... 2>&1 | tee -a "$LOG_FILE"
TEST_EXIT=${PIPESTATUS[0]}

go test -v -timeout 60s -run TestGroupLifeWorkflow ./... 2>&1 | tee -a "$LOG_FILE" || true
go test -v -timeout 60s -run TestBancassuranceWorkflow ./... 2>&1 | tee -a "$LOG_FILE" || true

# ---------------------------------------------------------------------------
# Cleanup (local only)
# ---------------------------------------------------------------------------
if [ "$ENV" = "local" ] && [ ${#PIDS[@]} -gt 0 ]; then
  echo "" | tee -a "$LOG_FILE"
  echo "Stopping local services..." | tee -a "$LOG_FILE"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "" | tee -a "$LOG_FILE"
echo "============================================================" | tee -a "$LOG_FILE"
echo "Integration test results: $LOG_FILE" | tee -a "$LOG_FILE"
echo "Exit code: $TEST_EXIT" | tee -a "$LOG_FILE"
echo "Finished: $(date -u)" | tee -a "$LOG_FILE"

exit $TEST_EXIT
