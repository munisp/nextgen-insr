#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# InsurePortal Vault Initialisation Script
# Run ONCE after first `docker-compose up vault` to initialise and unseal Vault
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

VAULT_ADDR="${VAULT_ADDR:-http://localhost:8200}"
INIT_FILE="./vault-init-keys.json"

echo "==> Waiting for Vault to start..."
until curl -sf "${VAULT_ADDR}/v1/sys/health" > /dev/null 2>&1; do
  sleep 2
done

# Check if already initialised
STATUS=$(curl -sf "${VAULT_ADDR}/v1/sys/init" | python3 -c "import sys,json; print(json.load(sys.stdin)['initialized'])")
if [ "$STATUS" = "True" ]; then
  echo "==> Vault already initialised. Skipping."
  exit 0
fi

echo "==> Initialising Vault (5 key shares, 3 threshold)..."
curl -sf -X POST "${VAULT_ADDR}/v1/sys/init" \
  -H "Content-Type: application/json" \
  -d '{"secret_shares":5,"secret_threshold":3}' \
  | tee "${INIT_FILE}" | python3 -m json.tool

echo ""
echo "==> IMPORTANT: Save vault-init-keys.json in a secure location!"
echo "==> The root token and unseal keys are ONLY shown once."
echo ""

ROOT_TOKEN=$(python3 -c "import json; d=json.load(open('${INIT_FILE}')); print(d['root_token'])")
UNSEAL_KEY_1=$(python3 -c "import json; d=json.load(open('${INIT_FILE}')); print(d['keys'][0])")
UNSEAL_KEY_2=$(python3 -c "import json; d=json.load(open('${INIT_FILE}')); print(d['keys'][1])")
UNSEAL_KEY_3=$(python3 -c "import json; d=json.load(open('${INIT_FILE}')); print(d['keys'][2])")

echo "==> Unsealing Vault (3 of 5 keys)..."
curl -sf -X POST "${VAULT_ADDR}/v1/sys/unseal" -d "{\"key\":\"${UNSEAL_KEY_1}\"}" > /dev/null
curl -sf -X POST "${VAULT_ADDR}/v1/sys/unseal" -d "{\"key\":\"${UNSEAL_KEY_2}\"}" > /dev/null
curl -sf -X POST "${VAULT_ADDR}/v1/sys/unseal" -d "{\"key\":\"${UNSEAL_KEY_3}\"}" > /dev/null
echo "==> Vault unsealed."

echo "==> Enabling KV secrets engine..."
curl -sf -X POST "${VAULT_ADDR}/v1/sys/mounts/secret" \
  -H "X-Vault-Token: ${ROOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"type":"kv","options":{"version":"2"}}' > /dev/null || true

echo "==> Enabling Transit secrets engine (PII encryption)..."
curl -sf -X POST "${VAULT_ADDR}/v1/sys/mounts/transit" \
  -H "X-Vault-Token: ${ROOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"type":"transit"}' > /dev/null || true

echo "==> Creating transit key for PII..."
curl -sf -X POST "${VAULT_ADDR}/v1/transit/keys/insureportal-pii" \
  -H "X-Vault-Token: ${ROOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"type":"aes256-gcm96"}' > /dev/null || true

echo "==> Writing application policy..."
curl -sf -X PUT "${VAULT_ADDR}/v1/sys/policies/acl/insureportal-app" \
  -H "X-Vault-Token: ${ROOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"policy\":\"$(cat ./policies/app-policy.hcl | python3 -c "import sys; print(sys.stdin.read().replace('\"','\\\\\"').replace('\n','\\n'))")\"}" > /dev/null

echo "==> Creating application token..."
APP_TOKEN=$(curl -sf -X POST "${VAULT_ADDR}/v1/auth/token/create" \
  -H "X-Vault-Token: ${ROOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"policies":["insureportal-app"],"ttl":"8760h","renewable":true}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['auth']['client_token'])")

echo ""
echo "==> ✅ Vault initialised successfully!"
echo "==> Root Token: ${ROOT_TOKEN}"
echo "==> App Token:  ${APP_TOKEN}"
echo ""
echo "==> Add these to your .env.production:"
echo "    VAULT_ROOT_TOKEN=${ROOT_TOKEN}"
echo "    VAULT_APP_TOKEN=${APP_TOKEN}"
echo ""
echo "==> Enabling audit log..."
curl -sf -X PUT "${VAULT_ADDR}/v1/sys/audit/file" \
  -H "X-Vault-Token: ${ROOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"type":"file","options":{"file_path":"/vault/logs/audit.log"}}' > /dev/null

echo "==> Audit log enabled at /vault/logs/audit.log"
echo "==> Done!"
