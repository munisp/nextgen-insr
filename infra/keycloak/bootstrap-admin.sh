#!/usr/bin/env bash
# bootstrap-admin.sh — 2026-09-19 (L-wave, L-S-8)
#
# Sets the insureportal realm admin user's password from the environment.
# The realm export (realm-insureportal.json) deliberately carries NO
# credential for the `admin` user — the previous hardcoded bootstrap
# password ("Admin@1234!") was known to anyone with repo read access.
#
# FAIL-CLOSED: in the production profile (ENVIRONMENT=production or
# NODE_ENV=production) this script exits non-zero when
# KEYCLOAK_REALM_ADMIN_PASSWORD is unset — the platform must not boot a
# realm whose super-admin has no secret or a default secret.
#
# Auth: uses the master-realm admin (KEYCLOAK_ADMIN / KEYCLOAK_ADMIN_PASSWORD,
# already fail-closed via `:?` in docker-compose.production.yml).
set -euo pipefail

KC_URL="${KEYCLOAK_INTERNAL_URL:-http://keycloak:8080}"
REALM="${KEYCLOAK_REALM:-insureportal}"
ADMIN_USER="${KEYCLOAK_ADMIN:-admin}"
ADMIN_PASS="${KEYCLOAK_ADMIN_PASSWORD:?KEYCLOAK_ADMIN_PASSWORD required}"
REALM_ADMIN_USERNAME="${KEYCLOAK_REALM_ADMIN_USERNAME:-admin}"

IS_PROD=false
if [ "${ENVIRONMENT:-}" = "production" ] || [ "${NODE_ENV:-}" = "production" ]; then
  IS_PROD=true
fi

if [ -z "${KEYCLOAK_REALM_ADMIN_PASSWORD:-}" ]; then
  if [ "$IS_PROD" = "true" ]; then
    echo "[bootstrap-admin] FATAL: KEYCLOAK_REALM_ADMIN_PASSWORD is unset in the production profile." >&2
    echo "[bootstrap-admin] Refusing to boot the realm with a credential-less super-admin. Set the secret and redeploy." >&2
    exit 1
  fi
  echo "[bootstrap-admin] KEYCLOAK_REALM_ADMIN_PASSWORD unset (non-production) — realm admin left WITHOUT a password; login disabled until one is set."
  exit 0
fi

echo "[bootstrap-admin] waiting for Keycloak at ${KC_URL} ..."
for i in $(seq 1 60); do
  if curl -sf "${KC_URL}/health/ready" >/dev/null 2>&1; then
    break
  fi
  if [ "$i" = "60" ]; then
    echo "[bootstrap-admin] FATAL: Keycloak never became ready" >&2
    exit 1
  fi
  sleep 5
done

TOKEN=$(curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" \
  -d "username=${ADMIN_USER}" \
  -d "password=${ADMIN_PASS}" \
  -d "grant_type=password" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
if [ -z "$TOKEN" ]; then
  echo "[bootstrap-admin] FATAL: could not obtain master-realm admin token" >&2
  exit 1
fi

USER_ID=$(curl -sf -H "Authorization: Bearer ${TOKEN}" \
  "${KC_URL}/admin/realms/${REALM}/users?username=${REALM_ADMIN_USERNAME}&exact=true" \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
if [ -z "$USER_ID" ]; then
  echo "[bootstrap-admin] FATAL: realm admin user '${REALM_ADMIN_USERNAME}' not found in realm '${REALM}'" >&2
  exit 1
fi

# temporary=true forces a password change at first login — the bootstrap
# secret is a one-time handover credential, never a standing password.
curl -sf -X PUT -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  "${KC_URL}/admin/realms/${REALM}/users/${USER_ID}/reset-password" \
  -d "{\"type\":\"password\",\"value\":\"${KEYCLOAK_REALM_ADMIN_PASSWORD}\",\"temporary\":true}" >/dev/null

echo "[bootstrap-admin] realm '${REALM}' admin password set from environment (temporary=true — rotation required at first login)."
