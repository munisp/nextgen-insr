#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Vault Complete Initialisation Script — InsurePortal Agency Banking Platform
#
# Sets up:
#  1. KV v2 secrets engine
#  2. All application secrets with defaults
#  3. AppRole auth for each service
#  4. Policies for each service
#  5. PKI secrets engine (internal CA)
#  6. Transit secrets engine (encryption-as-a-service)
#  7. Database secrets engine (dynamic credentials)
#
# Usage:
#   VAULT_ADDR=http://localhost:8200 VAULT_TOKEN=root ./infra/vault/init-vault-complete.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

VAULT_ADDR="${VAULT_ADDR:-http://localhost:8200}"
VAULT_TOKEN="${VAULT_TOKEN:-root}"

export VAULT_ADDR VAULT_TOKEN

echo "[Vault] Connecting to ${VAULT_ADDR}"
vault status || { echo "[Vault] ERROR: Vault is sealed or unreachable"; exit 1; }

# ── Enable secrets engines ────────────────────────────────────────────────────
echo "[Vault] Enabling secrets engines..."
vault secrets enable -path=secret kv-v2 2>/dev/null || echo "[Vault] KV v2 already enabled"
vault secrets enable transit 2>/dev/null || echo "[Vault] Transit already enabled"
vault secrets enable pki 2>/dev/null || echo "[Vault] PKI already enabled"

# ── Enable auth methods ───────────────────────────────────────────────────────
vault auth enable approle 2>/dev/null || echo "[Vault] AppRole already enabled"

# ── Write application secrets ─────────────────────────────────────────────────
echo "[Vault] Writing application secrets..."
vault kv put secret/pos-shell-demo \
  JWT_SECRET="posinsureportal-jwt-secret-change-in-production" \
  KEYCLOAK_CLIENT_SECRET="pos-shell-secret-change-in-production" \
  TERMII_API_KEY="" \
  VAPID_PUBLIC_KEY="BNI_gF4TDVxJopDSnt73YaHP8jpCSXxKXJeSZ8Gm-CoSDYkTeEAYNYsXK5tvYpbxeBTfpSfLE77lC8kLnmI3ca8" \
  VAPID_PRIVATE_KEY="XBsV3B10_jSd8yVkMIB7xD1YulT3FJgBV9WOSPwxUs0" \
  MINIO_ACCESS_KEY="minioadmin" \
  MINIO_SECRET_KEY="minioadmin" \
  REDIS_URL="redis://localhost:6379" \
  KAFKA_BROKERS="localhost:9092" \
  PLATFORM_API_KEY="" \
  PLATFORM_SERVICE_TOKEN="" \
  SMTP_PASSWORD="" \
  SLACK_WEBHOOK_URL="" \
  PAGERDUTY_ROUTING_KEY="" \
  SENTRY_DSN=""

echo "[Vault] ✓ Application secrets written"

# ── Write policies ────────────────────────────────────────────────────────────
echo "[Vault] Writing policies..."
vault policy write platform-shell ./infra/vault/policies/platform-shell.hcl
vault policy write temporal-worker ./infra/vault/policies/temporal-worker.hcl
echo "[Vault] ✓ Policies written"

# ── Create AppRoles ───────────────────────────────────────────────────────────
echo "[Vault] Creating AppRoles..."

# platform-shell AppRole
vault write auth/approle/role/platform-shell \
  token_policies="platform-shell" \
  token_ttl="1h" \
  token_max_ttl="4h" \
  secret_id_ttl="0" \
  secret_id_num_uses=0

POS_ROLE_ID=$(vault read -field=role_id auth/approle/role/platform-shell/role-id)
POS_SECRET_ID=$(vault write -f -field=secret_id auth/approle/role/platform-shell/secret-id)
echo "[Vault] platform-shell AppRole:"
echo "  VAULT_ROLE_ID=${POS_ROLE_ID}"
echo "  VAULT_SECRET_ID=${POS_SECRET_ID}"

# temporal-worker AppRole
vault write auth/approle/role/temporal-worker \
  token_policies="temporal-worker" \
  token_ttl="1h" \
  token_max_ttl="4h" \
  secret_id_ttl="0" \
  secret_id_num_uses=0

TEMPORAL_ROLE_ID=$(vault read -field=role_id auth/approle/role/temporal-worker/role-id)
TEMPORAL_SECRET_ID=$(vault write -f -field=secret_id auth/approle/role/temporal-worker/secret-id)
echo "[Vault] temporal-worker AppRole:"
echo "  VAULT_ROLE_ID=${TEMPORAL_ROLE_ID}"
echo "  VAULT_SECRET_ID=${TEMPORAL_SECRET_ID}"

# ── Setup Transit encryption key ──────────────────────────────────────────────
echo "[Vault] Setting up Transit encryption key..."
vault write -f transit/keys/platform-shell type=aes256-gcm96
echo "[Vault] ✓ Transit key created: platform-shell"

# ── Setup PKI internal CA ─────────────────────────────────────────────────────
echo "[Vault] Setting up PKI internal CA..."
vault write pki/root/generate/internal \
  common_name="InsurePortal Internal CA" \
  ttl="87600h" \
  key_bits=4096 \
  organization="InsurePortal Agency Banking" \
  country="NG" \
  locality="Lagos" \
  province="Lagos" > /dev/null

vault write pki/config/urls \
  issuing_certificates="${VAULT_ADDR}/v1/pki/ca" \
  crl_distribution_points="${VAULT_ADDR}/v1/pki/crl"

vault write pki/roles/pos-shell \
  allowed_domains="insureportal.io,insureportal.ng,localhost" \
  allow_subdomains=true \
  allow_localhost=true \
  max_ttl="720h" \
  key_bits=2048 \
  key_type=rsa

echo "[Vault] ✓ PKI CA configured"

# ── Output summary ────────────────────────────────────────────────────────────
echo ""
echo "[Vault] ✅ Vault initialisation complete"
echo ""
echo "Add these to your .env.production:"
echo "  VAULT_ADDR=${VAULT_ADDR}"
echo "  VAULT_ROLE_ID=${POS_ROLE_ID}"
echo "  VAULT_SECRET_ID=${POS_SECRET_ID}"
echo ""
echo "Temporal worker:"
echo "  VAULT_ROLE_ID=${TEMPORAL_ROLE_ID}"
echo "  VAULT_SECRET_ID=${TEMPORAL_SECRET_ID}"
