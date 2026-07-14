#!/usr/bin/env bash
# =============================================================================
# E2E Specialty Service Test Runner
# Tests all 18 specialty/innovation services with domain-specific logic
#
# Usage:
#   LOCAL:      ./run_e2e_tests.sh local
#   STAGING:    ./run_e2e_tests.sh staging
#   PRODUCTION: ./run_e2e_tests.sh production
# =============================================================================
set -euo pipefail

ENV="${1:-local}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$REPO_DIR/tests/e2e/results"
mkdir -p "$LOG_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/e2e_${ENV}_${TIMESTAMP}.log"

echo "=== InsurePortal E2E Specialty Service Tests ===" | tee "$LOG_FILE"
echo "Environment: $ENV" | tee -a "$LOG_FILE"
echo "Started: $(date -u)" | tee -a "$LOG_FILE"

SPECIALTY_SERVICES=(
  "ai-claims-auto-adjudication:AI_CLAIMS_URL:9320"
  "parametric-insurance-engine:PARAMETRIC_URL:9321"
  "fraud-network-graph:FRAUD_GRAPH_URL:9322"
  "predictive-churn-engine:CHURN_URL:9323"
  "digital-twin-risk-modeler:DIGITAL_TWIN_URL:9324"
  "insurance-as-a-service:IAAS_URL:9325"
  "takaful-module:TAKAFUL_URL:9326"
  "microinsurance-engine:MICROINSURANCE_URL:9327"
  "ussd-gateway:USSD_URL:9328"
  "usage-based-insurance:UBI_URL:9329"
  "enhanced-kyc-kyb:KYC_URL:9330"
  "ndpr-compliance:NDPR_URL:9331"
  "multi-tenant-platform:MULTI_TENANT_URL:9332"
  "agent-network-platform:AGENT_URL:9333"
  "broker-api-service:BROKER_URL:9334"
  "gamification-service:GAMIFICATION_URL:9335"
  "mobile-money-service:MOBILE_MONEY_URL:9336"
  "pan-african-ekyc:PAN_EKYC_URL:9337"
)

PIDS=()

case "$ENV" in
  local)
    export DATABASE_URL="${DATABASE_URL:-postgres://ubuntu:testpass123@localhost:5432/insureportal_test?sslmode=disable}"
    echo "Starting ${#SPECIALTY_SERVICES[@]} specialty services..." | tee -a "$LOG_FILE"
    for entry in "${SPECIALTY_SERVICES[@]}"; do
      IFS=: read -r SVC ENV_VAR PORT <<< "$entry"
      SVC_DIR="$REPO_DIR/$SVC"
      if [ ! -f "$SVC_DIR/main.go" ]; then
        echo "  SKIP: $SVC (no main.go)" | tee -a "$LOG_FILE"
        continue
      fi
      export "$ENV_VAR=http://localhost:$PORT"
      echo "  Starting $SVC on port $PORT" | tee -a "$LOG_FILE"
      cd "$SVC_DIR"
      PORT=$PORT DATABASE_URL="$DATABASE_URL" go run main.go &
      PIDS+=($!)
    done
    sleep 5
    ;;

  staging|production)
    DOMAIN="${STAGING_DOMAIN:-staging.insureportal.ng}"
    [ "$ENV" = "production" ] && DOMAIN="${PRODUCTION_DOMAIN:-api.insureportal.ng}"
    for entry in "${SPECIALTY_SERVICES[@]}"; do
      IFS=: read -r SVC ENV_VAR PORT <<< "$entry"
      export "$ENV_VAR=https://${SVC}.${DOMAIN}"
    done
    echo "Using $ENV URLs at $DOMAIN" | tee -a "$LOG_FILE"
    ;;
esac

# Run tests
echo "" | tee -a "$LOG_FILE"
echo "Running E2E tests..." | tee -a "$LOG_FILE"
cd "$SCRIPT_DIR"

if [ ! -f go.mod ]; then
  go mod init e2e_tests
  go mod tidy 2>/dev/null || true
fi

go test -v -timeout 300s ./... 2>&1 | tee -a "$LOG_FILE"
TEST_EXIT=${PIPESTATUS[0]}

# Cleanup
if [ "$ENV" = "local" ] && [ ${#PIDS[@]} -gt 0 ]; then
  echo "Stopping services..." | tee -a "$LOG_FILE"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
fi

echo "" | tee -a "$LOG_FILE"
echo "Results: $LOG_FILE" | tee -a "$LOG_FILE"
echo "Exit: $TEST_EXIT" | tee -a "$LOG_FILE"
exit $TEST_EXIT
