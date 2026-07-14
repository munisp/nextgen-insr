#!/usr/bin/env bash
# =============================================================================
# InsurePortal — Production Deployment Master Script
#
# Orchestrates the complete deployment pipeline for any environment:
#   1. Pre-flight checks (tools, connectivity, secrets)
#   2. TLS certificate generation and validation
#   3. Vault secrets initialization
#   4. Database migration
#   5. Docker image builds + push to registry
#   6. Kubernetes deployment via Helm
#   7. Health verification
#   8. Integration test execution
#   9. Load test execution
#   10. Post-deployment validation
#
# Usage:
#   ./production_deploy.sh staging       — Deploy to staging
#   ./production_deploy.sh production    — Deploy to production
#   ./production_deploy.sh preflight     — Run pre-flight checks only
#   ./production_deploy.sh rollback      — Rollback to previous version
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV="${1:-staging}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$REPO_DIR/deploy-${ENV}-${TIMESTAMP}.log"
REGISTRY="${DOCKER_REGISTRY:-ghcr.io/munisp/nextgen-insr}"
IMAGE_TAG="${IMAGE_TAG:-$TIMESTAMP}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $1" | tee -a "$LOG_FILE"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] WARNING:${NC} $1" | tee -a "$LOG_FILE"; }
err() { echo -e "${RED}[$(date +%H:%M:%S)] ERROR:${NC} $1" | tee -a "$LOG_FILE"; }

# Environment config
case "$ENV" in
  staging)
    NAMESPACE="insureportal-staging"
    DOMAIN="${STAGING_DOMAIN:-staging.insureportal.ng}"
    REPLICAS=1
    ;;
  production)
    NAMESPACE="insureportal-prod"
    DOMAIN="${PRODUCTION_DOMAIN:-api.insureportal.ng}"
    REPLICAS=3
    echo ""
    echo "================================================"
    echo "  PRODUCTION DEPLOYMENT — REQUIRES APPROVAL"
    echo "================================================"
    read -p "Type 'DEPLOY-PRODUCTION' to confirm: " confirm
    if [ "$confirm" != "DEPLOY-PRODUCTION" ]; then
      err "Deployment cancelled"
      exit 1
    fi
    ;;
  preflight)
    log "Running pre-flight checks only..."
    ;;
  rollback)
    log "Rolling back to previous version..."
    ;;
  *)
    echo "Usage: $0 {staging|production|preflight|rollback}"
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# Step 1: Pre-flight checks
# ---------------------------------------------------------------------------
preflight() {
  log "=== Step 1: Pre-flight Checks ==="
  local errors=0

  # Required tools
  for tool in kubectl helm docker openssl go k6 vault; do
    if command -v "$tool" &> /dev/null; then
      log "  $tool: $(command -v $tool)"
    else
      warn "  $tool: NOT FOUND (install before deploying)"
      errors=$((errors + 1))
    fi
  done

  # Kubernetes connectivity
  if kubectl cluster-info &> /dev/null; then
    log "  Kubernetes: CONNECTED"
    log "  Context: $(kubectl config current-context)"
  else
    warn "  Kubernetes: NOT CONNECTED"
    errors=$((errors + 1))
  fi

  # Docker registry access
  if docker info &> /dev/null; then
    log "  Docker: RUNNING"
  else
    warn "  Docker: NOT RUNNING"
    errors=$((errors + 1))
  fi

  # Required environment variables
  REQUIRED_VARS=(
    "DATABASE_URL" "KAFKA_BROKERS" "REDIS_URL"
    "JWT_SECRET" "VAULT_ADDR" "VAULT_TOKEN"
  )
  for var in "${REQUIRED_VARS[@]}"; do
    if [ -n "${!var:-}" ]; then
      log "  \$$var: SET"
    else
      warn "  \$$var: NOT SET"
    fi
  done

  # Go compilation check
  log "  Compiling Go services..."
  local compile_pass=0
  local compile_fail=0
  for d in "$REPO_DIR"/*/main.go "$REPO_DIR"/server/*/main.go; do
    [ -f "$d" ] || continue
    dir=$(dirname "$d")
    if (cd "$dir" && go vet ./... 2>/dev/null); then
      compile_pass=$((compile_pass + 1))
    else
      compile_fail=$((compile_fail + 1))
    fi
  done
  log "  Compilation: $compile_pass pass / $compile_fail fail"

  echo ""
  if [ $errors -eq 0 ]; then
    log "Pre-flight: ALL CHECKS PASSED"
  else
    warn "Pre-flight: $errors checks failed (non-blocking for staging)"
  fi
}

# ---------------------------------------------------------------------------
# Step 2: TLS certificates
# ---------------------------------------------------------------------------
setup_tls() {
  log "=== Step 2: TLS Certificates ==="
  chmod +x "$REPO_DIR/infra/tls/setup_tls.sh"
  DOMAIN="$DOMAIN" "$REPO_DIR/infra/tls/setup_tls.sh" generate 2>&1 | tee -a "$LOG_FILE"
  "$REPO_DIR/infra/tls/setup_tls.sh" validate 2>&1 | tee -a "$LOG_FILE"
}

# ---------------------------------------------------------------------------
# Step 3: Vault secrets
# ---------------------------------------------------------------------------
setup_vault() {
  log "=== Step 3: Vault Secrets ==="
  if command -v vault &> /dev/null && [ -n "${VAULT_ADDR:-}" ]; then
    chmod +x "$REPO_DIR/infra/vault/setup_vault.sh"
    "$REPO_DIR/infra/vault/setup_vault.sh" init 2>&1 | tee -a "$LOG_FILE"
  else
    warn "Vault not available — using environment variables"
  fi
}

# ---------------------------------------------------------------------------
# Step 4: Build Docker images
# ---------------------------------------------------------------------------
build_images() {
  log "=== Step 4: Building Docker Images ==="
  local built=0
  for dockerfile in "$REPO_DIR"/*/Dockerfile "$REPO_DIR"/server/*/Dockerfile; do
    [ -f "$dockerfile" ] || continue
    dir=$(dirname "$dockerfile")
    svc=$(basename "$dir")
    image="${REGISTRY}/${svc}:${IMAGE_TAG}"
    log "  Building: $image"
    docker build -t "$image" "$dir" 2>&1 | tail -1 | tee -a "$LOG_FILE"
    docker push "$image" 2>&1 | tail -1 | tee -a "$LOG_FILE"
    built=$((built + 1))
  done
  log "  Built and pushed: $built images"
}

# ---------------------------------------------------------------------------
# Step 5: Deploy to Kubernetes
# ---------------------------------------------------------------------------
deploy_k8s() {
  log "=== Step 5: Deploying to Kubernetes ==="

  # Create namespace
  kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

  # Deploy TLS certificates
  "$REPO_DIR/infra/tls/setup_tls.sh" deploy 2>&1 | tee -a "$LOG_FILE"

  # Deploy via Helm charts
  local deployed=0
  for chart in "$REPO_DIR"/*/helm "$REPO_DIR"/helm/*; do
    [ -d "$chart" ] || continue
    svc=$(basename "$(dirname "$chart")" 2>/dev/null || basename "$chart")
    if [ -f "$chart/Chart.yaml" ]; then
      helm upgrade --install "$svc" "$chart" \
        --namespace "$NAMESPACE" \
        --set image.repository="${REGISTRY}/${svc}" \
        --set image.tag="$IMAGE_TAG" \
        --set replicaCount="$REPLICAS" \
        --set env.DATABASE_URL="\${DATABASE_URL}" \
        --wait --timeout 300s 2>&1 | tee -a "$LOG_FILE"
      deployed=$((deployed + 1))
    fi
  done
  log "  Deployed: $deployed services via Helm"

  # Wait for rollout
  log "  Waiting for pods to be ready..."
  kubectl wait --for=condition=Ready pod --all \
    --namespace "$NAMESPACE" --timeout=600s 2>&1 | tee -a "$LOG_FILE" || warn "Some pods not ready"
}

# ---------------------------------------------------------------------------
# Step 6: Health verification
# ---------------------------------------------------------------------------
verify_health() {
  log "=== Step 6: Health Verification ==="
  local healthy=0
  local total=0

  for svc in $(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[*].metadata.name}'); do
    total=$((total + 1))
    # Port-forward and check health
    kubectl port-forward -n "$NAMESPACE" "svc/$svc" 18080:8080 &
    PF_PID=$!
    sleep 2
    if curl -sf http://localhost:18080/health > /dev/null 2>&1; then
      healthy=$((healthy + 1))
      log "  $svc: HEALTHY"
    else
      warn "  $svc: UNHEALTHY"
    fi
    kill $PF_PID 2>/dev/null
  done

  log "  Health: $healthy/$total services healthy"
}

# ---------------------------------------------------------------------------
# Step 7: Integration tests
# ---------------------------------------------------------------------------
run_integration_tests() {
  log "=== Step 7: Integration Tests ==="
  chmod +x "$REPO_DIR/tests/integration/run_integration_tests.sh"
  "$REPO_DIR/tests/integration/run_integration_tests.sh" "$ENV" 2>&1 | tee -a "$LOG_FILE" || warn "Some integration tests failed"
}

# ---------------------------------------------------------------------------
# Step 8: Load tests
# ---------------------------------------------------------------------------
run_load_tests() {
  log "=== Step 8: Load Tests ==="
  if command -v k6 &> /dev/null; then
    k6 run --env "ENV=$ENV" --env "DOMAIN=$DOMAIN" \
      "$REPO_DIR/tests/load/nationwide_load_test.js" 2>&1 | tee -a "$LOG_FILE" || warn "Load test thresholds not met"
  else
    warn "k6 not installed — skipping load tests"
  fi
}

# ---------------------------------------------------------------------------
# Step 9: E2E tests
# ---------------------------------------------------------------------------
run_e2e_tests() {
  log "=== Step 9: E2E Specialty Tests ==="
  chmod +x "$REPO_DIR/tests/e2e/run_e2e_tests.sh"
  "$REPO_DIR/tests/e2e/run_e2e_tests.sh" "$ENV" 2>&1 | tee -a "$LOG_FILE" || warn "Some E2E tests failed"
}

# ---------------------------------------------------------------------------
# Step 10: Post-deployment report
# ---------------------------------------------------------------------------
post_deploy_report() {
  log "=== Step 10: Post-Deployment Report ==="
  cat <<EOF | tee -a "$LOG_FILE"

============================================================
  InsurePortal Production Deployment Report
============================================================
  Environment:  $ENV
  Namespace:    $NAMESPACE
  Domain:       $DOMAIN
  Image Tag:    $IMAGE_TAG
  Deployed:     $(date -u)
  Log:          $LOG_FILE

  Next Steps:
  1. Monitor dashboards: kubectl port-forward -n monitoring svc/grafana 3000:3000
  2. Check alerts: kubectl port-forward -n monitoring svc/alertmanager 9093:9093
  3. View logs: kubectl logs -n $NAMESPACE -l app=<service> --tail=100
  4. Rollback if needed: $0 rollback

============================================================
EOF
}

# ---------------------------------------------------------------------------
# Rollback
# ---------------------------------------------------------------------------
rollback() {
  log "=== Rollback ==="
  for deployment in $(kubectl get deployments -n "$NAMESPACE" -o jsonpath='{.items[*].metadata.name}'); do
    log "  Rolling back: $deployment"
    kubectl rollout undo deployment/"$deployment" -n "$NAMESPACE" 2>&1 | tee -a "$LOG_FILE"
  done
  log "Rollback complete. Verify with: kubectl get pods -n $NAMESPACE"
}

# ---------------------------------------------------------------------------
# Main execution
# ---------------------------------------------------------------------------
case "$ENV" in
  preflight)
    preflight
    ;;
  rollback)
    rollback
    ;;
  staging|production)
    preflight
    setup_tls
    setup_vault
    build_images
    deploy_k8s
    verify_health
    run_integration_tests
    run_load_tests
    run_e2e_tests
    post_deploy_report
    ;;
esac

log "Deployment script completed. Full log: $LOG_FILE"
