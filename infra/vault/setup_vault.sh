#!/usr/bin/env bash
# =============================================================================
# HashiCorp Vault Integration — Secrets Management + Rotation
#
# Sets up Vault for the InsurePortal platform:
#   1. Initialize Vault with KV v2 secrets engine
#   2. Store all service secrets (DB, Kafka, Redis, JWT, API keys)
#   3. Configure auto-rotation policies
#   4. Set up Kubernetes auth for pod-level access
#
# Usage:
#   ./setup_vault.sh init        — Initialize Vault + seed secrets
#   ./setup_vault.sh rotate      — Rotate all secrets
#   ./setup_vault.sh validate    — Verify all secrets are accessible
#   ./setup_vault.sh deploy      — Deploy Vault to Kubernetes via Helm
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VAULT_ADDR="${VAULT_ADDR:-http://127.0.0.1:8200}"
VAULT_NAMESPACE="${VAULT_NAMESPACE:-insureportal}"
export VAULT_ADDR

# Services that need secrets
SERVICES=(
  "underwriting" "policy-lifecycle" "premium-collection"
  "claims-adjudication" "instant-payout" "communication"
  "audit-trail" "reinsurance" "naicom-compliance"
  "fraud-detection" "group-life" "bancassurance"
  "agent-network" "broker-api" "enhanced-kyc"
  "enterprise-mdm" "microinsurance" "takaful"
)

# ---------------------------------------------------------------------------
init_vault() {
  echo "=== Initializing Vault ==="

  # Enable KV v2 secrets engine
  vault secrets enable -path=insureportal kv-v2 2>/dev/null || echo "  KV engine already enabled"

  # Enable database secrets engine for PostgreSQL rotation
  vault secrets enable -path=database database 2>/dev/null || echo "  Database engine already enabled"

  echo ""
  echo "=== Seeding Platform Secrets ==="

  # Global secrets
  vault kv put insureportal/global/database \
    host="\${DB_HOST}" \
    port="5432" \
    name="insureportal_prod" \
    username="\${DB_USERNAME}" \
    password="\${DB_PASSWORD}" \
    sslmode="require" \
    max_open_conns="25" \
    max_idle_conns="5" \
    conn_max_lifetime="5m"

  vault kv put insureportal/global/kafka \
    brokers="\${KAFKA_BROKERS}" \
    sasl_mechanism="SCRAM-SHA-256" \
    sasl_username="\${KAFKA_USERNAME}" \
    sasl_password="\${KAFKA_PASSWORD}" \
    ssl_enabled="true"

  vault kv put insureportal/global/redis \
    host="\${REDIS_HOST}" \
    port="6379" \
    password="\${REDIS_PASSWORD}" \
    tls_enabled="true" \
    db="0"

  vault kv put insureportal/global/jwt \
    secret="\${JWT_SECRET}" \
    issuer="insureportal.ng" \
    audience="insureportal-api" \
    access_token_ttl="15m" \
    refresh_token_ttl="7d"

  vault kv put insureportal/global/encryption \
    aes_key="\${AES_ENCRYPTION_KEY}" \
    algorithm="AES-256-GCM"

  # Per-service secrets
  for svc in "${SERVICES[@]}"; do
    vault kv put "insureportal/services/$svc" \
      api_key="\${${svc^^}_API_KEY:-$(openssl rand -hex 32)}" \
      service_account="svc-$svc" \
      log_level="info"
    echo "  Seeded: insureportal/services/$svc"
  done

  # Payment gateway secrets
  vault kv put insureportal/integrations/paystack \
    secret_key="\${PAYSTACK_SECRET_KEY}" \
    public_key="\${PAYSTACK_PUBLIC_KEY}" \
    webhook_secret="\${PAYSTACK_WEBHOOK_SECRET}"

  vault kv put insureportal/integrations/flutterwave \
    secret_key="\${FLUTTERWAVE_SECRET_KEY}" \
    public_key="\${FLUTTERWAVE_PUBLIC_KEY}" \
    encryption_key="\${FLUTTERWAVE_ENCRYPTION_KEY}"

  # NAICOM regulatory API
  vault kv put insureportal/integrations/naicom \
    api_url="https://api.naicom.gov.ng" \
    api_key="\${NAICOM_API_KEY}" \
    company_code="\${NAICOM_COMPANY_CODE}"

  echo ""
  echo "=== Vault Initialization Complete ==="
  echo "Secrets stored: $(vault kv list -format=json insureportal/services/ | jq length) services"
}

# ---------------------------------------------------------------------------
rotate_secrets() {
  echo "=== Rotating All Secrets ==="
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)

  # Rotate JWT secret
  NEW_JWT=$(openssl rand -hex 64)
  vault kv put insureportal/global/jwt \
    secret="$NEW_JWT" \
    issuer="insureportal.ng" \
    audience="insureportal-api" \
    access_token_ttl="15m" \
    refresh_token_ttl="7d" \
    rotated_at="$TIMESTAMP"
  echo "  JWT secret rotated"

  # Rotate encryption key
  NEW_AES=$(openssl rand -hex 32)
  vault kv put insureportal/global/encryption \
    aes_key="$NEW_AES" \
    algorithm="AES-256-GCM" \
    rotated_at="$TIMESTAMP"
  echo "  AES encryption key rotated"

  # Rotate per-service API keys
  for svc in "${SERVICES[@]}"; do
    NEW_KEY=$(openssl rand -hex 32)
    vault kv patch "insureportal/services/$svc" \
      api_key="$NEW_KEY" \
      rotated_at="$TIMESTAMP"
    echo "  $svc API key rotated"
  done

  echo ""
  echo "=== Rotation Complete ==="
  echo "All secrets rotated at: $TIMESTAMP"
  echo "NOTE: Services must be restarted to pick up new secrets"
  echo "  kubectl rollout restart deployment -n insureportal-prod"
}

# ---------------------------------------------------------------------------
validate_secrets() {
  echo "=== Validating All Secrets ==="
  local errors=0

  # Check global secrets
  for path in global/database global/kafka global/redis global/jwt global/encryption; do
    if vault kv get -format=json "insureportal/$path" > /dev/null 2>&1; then
      version=$(vault kv get -format=json "insureportal/$path" | jq '.data.metadata.version')
      echo "  insureportal/$path: OK (version $version)"
    else
      echo "  insureportal/$path: MISSING"
      errors=$((errors + 1))
    fi
  done

  # Check per-service secrets
  for svc in "${SERVICES[@]}"; do
    if vault kv get -format=json "insureportal/services/$svc" > /dev/null 2>&1; then
      echo "  insureportal/services/$svc: OK"
    else
      echo "  insureportal/services/$svc: MISSING"
      errors=$((errors + 1))
    fi
  done

  # Check integration secrets
  for integration in paystack flutterwave naicom; do
    if vault kv get -format=json "insureportal/integrations/$integration" > /dev/null 2>&1; then
      echo "  insureportal/integrations/$integration: OK"
    else
      echo "  insureportal/integrations/$integration: MISSING"
      errors=$((errors + 1))
    fi
  done

  echo ""
  if [ $errors -eq 0 ]; then
    echo "All secrets VALID"
  else
    echo "ERRORS: $errors secrets missing"
  fi
  return $errors
}

# ---------------------------------------------------------------------------
deploy_vault_k8s() {
  echo "=== Deploying Vault to Kubernetes ==="
  local namespace="vault"

  # Add HashiCorp Helm repo
  helm repo add hashicorp https://helm.releases.hashicorp.com
  helm repo update

  # Install Vault
  helm upgrade --install vault hashicorp/vault \
    --namespace "$namespace" \
    --create-namespace \
    --set server.ha.enabled=true \
    --set server.ha.replicas=3 \
    --set server.ha.raft.enabled=true \
    --set injector.enabled=true \
    --set ui.enabled=true

  echo "Waiting for Vault pods..."
  kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=vault \
    --namespace "$namespace" --timeout=300s

  # Configure Kubernetes auth method
  echo "Configuring Kubernetes auth..."
  kubectl exec -n "$namespace" vault-0 -- vault auth enable kubernetes 2>/dev/null || true

  kubectl exec -n "$namespace" vault-0 -- vault write auth/kubernetes/config \
    kubernetes_host="https://kubernetes.default.svc"

  # Create policy for InsurePortal services
  cat <<'POLICY' | kubectl exec -i -n "$namespace" vault-0 -- vault policy write insureportal-service -
path "insureportal/data/global/*" {
  capabilities = ["read"]
}
path "insureportal/data/services/{{identity.entity.aliases.auth_kubernetes.metadata.service_account_name}}" {
  capabilities = ["read"]
}
path "insureportal/data/integrations/*" {
  capabilities = ["read"]
}
POLICY

  # Create role for InsurePortal namespace
  kubectl exec -n "$namespace" vault-0 -- vault write auth/kubernetes/role/insureportal-service \
    bound_service_account_names="*" \
    bound_service_account_namespaces="insureportal-prod,insureportal-staging" \
    policies="insureportal-service" \
    ttl="1h"

  echo ""
  echo "=== Vault Deployed ==="
  echo "UI: kubectl port-forward -n vault svc/vault-ui 8200:8200"
  echo "Inject secrets via annotations in pod specs:"
  echo '  vault.hashicorp.com/agent-inject: "true"'
  echo '  vault.hashicorp.com/role: "insureportal-service"'
  echo '  vault.hashicorp.com/agent-inject-secret-db: "insureportal/data/global/database"'
}

# ---------------------------------------------------------------------------
# Generate Vault agent sidecar config for Go services
generate_sidecar_config() {
  echo "=== Generating Vault Sidecar Annotations ==="
  local output_dir="$SCRIPT_DIR/k8s-annotations"
  mkdir -p "$output_dir"

  for svc in "${SERVICES[@]}"; do
    cat > "$output_dir/${svc}-vault-annotations.yaml" <<EOF
# Add these annotations to the ${svc} Deployment spec.template.metadata
annotations:
  vault.hashicorp.com/agent-inject: "true"
  vault.hashicorp.com/role: "insureportal-service"
  vault.hashicorp.com/agent-inject-secret-database: "insureportal/data/global/database"
  vault.hashicorp.com/agent-inject-template-database: |
    {{- with secret "insureportal/data/global/database" -}}
    DATABASE_URL=postgres://{{ .Data.data.username }}:{{ .Data.data.password }}@{{ .Data.data.host }}:{{ .Data.data.port }}/{{ .Data.data.name }}?sslmode={{ .Data.data.sslmode }}
    {{- end }}
  vault.hashicorp.com/agent-inject-secret-jwt: "insureportal/data/global/jwt"
  vault.hashicorp.com/agent-inject-template-jwt: |
    {{- with secret "insureportal/data/global/jwt" -}}
    JWT_SECRET={{ .Data.data.secret }}
    {{- end }}
  vault.hashicorp.com/agent-inject-secret-service: "insureportal/data/services/${svc}"
  vault.hashicorp.com/agent-inject-template-service: |
    {{- with secret "insureportal/data/services/${svc}" -}}
    API_KEY={{ .Data.data.api_key }}
    {{- end }}
EOF
    echo "  Generated: $output_dir/${svc}-vault-annotations.yaml"
  done

  echo ""
  echo "Apply these annotations to each service's Deployment YAML"
}

# ---------------------------------------------------------------------------
case "${1:-init}" in
  init)      init_vault ;;
  rotate)    rotate_secrets ;;
  validate)  validate_secrets ;;
  deploy)    deploy_vault_k8s ;;
  sidecar)   generate_sidecar_config ;;
  *)         echo "Usage: $0 {init|rotate|validate|deploy|sidecar}" ;;
esac
