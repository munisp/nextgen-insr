#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# InsurePortal APISix Bootstrap Script
# Seeds all routes, upstreams, plugins, and consumers via the APISix Admin API.
#
# Usage:
#   ./bootstrap.sh [--host http://apisix:9180] [--key <admin-key>]
#
# Environment variables:
#   APISIX_ADMIN_URL  — APISix admin endpoint (default: http://localhost:9180)
#   APISIX_ADMIN_KEY  — APISix admin API key (default: edd1c9f034335f136f87ad84b625c8f1)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APISIX_ADMIN_URL="${APISIX_ADMIN_URL:-http://localhost:9180}"
APISIX_ADMIN_KEY="${APISIX_ADMIN_KEY:-edd1c9f034335f136f87ad84b625c8f1}"
APISIX_BASE="${APISIX_ADMIN_URL}/apisix/admin"

# Parse CLI args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) APISIX_ADMIN_URL="$2"; APISIX_BASE="${APISIX_ADMIN_URL}/apisix/admin"; shift 2;;
    --key)  APISIX_ADMIN_KEY="$2"; shift 2;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

log()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [APISIX] $*"; }
error(){ echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [ERROR]  $*" >&2; exit 1; }

apisix_put() {
  local path="$1"
  local data="$2"
  local response
  response=$(curl -sf -X PUT \
    -H "X-API-KEY: ${APISIX_ADMIN_KEY}" \
    -H "Content-Type: application/json" \
    -d "${data}" \
    "${APISIX_BASE}${path}" 2>&1) || {
    log "Warning: PUT ${path} failed: ${response}"
    return 1
  }
  log "PUT ${path} → OK"
}

# ── Wait for APISix to be ready ───────────────────────────────────────────────
log "Waiting for APISix admin API at ${APISIX_ADMIN_URL}..."
for i in $(seq 1 30); do
  if curl -sf -H "X-API-KEY: ${APISIX_ADMIN_KEY}" "${APISIX_BASE}/routes" &>/dev/null; then
    log "APISix is ready."
    break
  fi
  [[ $i -eq 30 ]] && error "APISix not ready after 30 attempts"
  sleep 2
done

# ── Create upstreams ──────────────────────────────────────────────────────────
log "Creating upstreams..."

apisix_put "/upstreams/1" '{
  "id": "1",
  "name": "platform-shell-app",
  "type": "roundrobin",
  "nodes": {"app:3000": 1},
  "scheme": "http",
  "pass_host": "pass",
  "keepalive_pool": {"size": 320, "requests": 1000, "idle_timeout": 60}
}'

apisix_put "/upstreams/2" '{
  "id": "2",
  "name": "ota-service",
  "type": "roundrobin",
  "nodes": {"ota-service:8081": 1},
  "scheme": "http",
  "pass_host": "pass"
}'

apisix_put "/upstreams/3" '{
  "id": "3",
  "name": "mdm-compliance-engine",
  "type": "roundrobin",
  "nodes": {"mdm-compliance-engine:8091": 1},
  "scheme": "http",
  "pass_host": "pass"
}'

apisix_put "/upstreams/4" '{
  "id": "4",
  "name": "mdm-geofence-service",
  "type": "roundrobin",
  "nodes": {"mdm-geofence-service:8092": 1},
  "scheme": "http",
  "pass_host": "pass"
}'

apisix_put "/upstreams/5" '{
  "id": "5",
  "name": "fraud-engine",
  "type": "roundrobin",
  "nodes": {"fraud-engine:8072": 1},
  "scheme": "http",
  "pass_host": "pass"
}'

apisix_put "/upstreams/6" '{
  "id": "6",
  "name": "settlement-service",
  "type": "roundrobin",
  "nodes": {"settlement-service:8073": 1},
  "scheme": "http",
  "pass_host": "pass"
}'

apisix_put "/upstreams/7" '{
  "id": "7",
  "name": "kyc-service",
  "type": "roundrobin",
  "nodes": {"kyc-service:8070": 1},
  "scheme": "http",
  "pass_host": "pass"
}'

# ── Create global plugins ─────────────────────────────────────────────────────
log "Configuring global plugins..."

apisix_put "/global_rules/1" '{
  "id": "1",
  "plugins": {
    "prometheus": {"prefer_name": true},
    "request-id": {"include_in_response": true},
    "real-ip": {
      "source": "http_x_forwarded_for",
      "trusted_addresses": ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
    }
  }
}'

# ── Create consumers ──────────────────────────────────────────────────────────
log "Creating consumers..."

apisix_put "/consumers/pos-device" '{
  "username": "pos-device",
  "plugins": {
    "key-auth": {"key": "pos-device-api-key-change-in-production"}
  }
}'

apisix_put "/consumers/internal-service" '{
  "username": "internal-service",
  "plugins": {
    "key-auth": {"key": "internal-service-key-change-in-production"}
  }
}'

# ── Create routes ─────────────────────────────────────────────────────────────
log "Creating routes..."

# Main app — all tRPC and web traffic
apisix_put "/routes/1" '{
  "id": "1",
  "name": "platform-shell-app",
  "uri": "/*",
  "upstream_id": "1",
  "plugins": {
    "cors": {
      "allow_origins": "**",
      "allow_methods": "GET,POST,PUT,DELETE,OPTIONS",
      "allow_headers": "Content-Type,Authorization,X-Device-Token,X-Admin-Key",
      "max_age": 3600
    },
    "response-rewrite": {
      "headers": {
        "set": {
          "X-Frame-Options": "DENY",
          "X-Content-Type-Options": "nosniff",
          "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
        }
      }
    }
  },
  "priority": 0
}'

# OTA service
apisix_put "/routes/2" '{
  "id": "2",
  "name": "ota-service",
  "uri": "/api/v1/ota/*",
  "upstream_id": "2",
  "plugins": {
    "limit-req": {"rate": 10, "burst": 20, "key": "remote_addr"},
    "proxy-rewrite": {"regex_uri": ["/api/v1/ota/(.*)", "/api/v1/ota/$1"]}
  },
  "priority": 100
}'

# MDM Compliance Engine
apisix_put "/routes/3" '{
  "id": "3",
  "name": "mdm-compliance-engine",
  "uri": "/api/v1/compliance/*",
  "upstream_id": "3",
  "plugins": {
    "key-auth": {},
    "limit-req": {"rate": 50, "burst": 100, "key": "remote_addr"}
  },
  "priority": 100
}'

# MDM Geofence Service
apisix_put "/routes/4" '{
  "id": "4",
  "name": "mdm-geofence-service",
  "uri": "/api/v1/geofence/*",
  "upstream_id": "4",
  "plugins": {
    "key-auth": {},
    "limit-req": {"rate": 50, "burst": 100, "key": "remote_addr"}
  },
  "priority": 100
}'

# Fraud Engine
apisix_put "/routes/5" '{
  "id": "5",
  "name": "fraud-engine",
  "uri": "/api/v1/fraud/*",
  "upstream_id": "5",
  "plugins": {
    "key-auth": {},
    "limit-req": {"rate": 100, "burst": 200, "key": "remote_addr"}
  },
  "priority": 100
}'

# Settlement Service
apisix_put "/routes/6" '{
  "id": "6",
  "name": "settlement-service",
  "uri": "/api/v1/settlement/*",
  "upstream_id": "6",
  "plugins": {
    "key-auth": {},
    "limit-req": {"rate": 20, "burst": 50, "key": "remote_addr"}
  },
  "priority": 100
}'

# KYC Service
apisix_put "/routes/7" '{
  "id": "7",
  "name": "kyc-service",
  "uri": "/api/v1/kyc/*",
  "upstream_id": "7",
  "plugins": {
    "key-auth": {},
    "limit-req": {"rate": 30, "burst": 60, "key": "remote_addr"}
  },
  "priority": 100
}'

# ── Health check route (no auth) ──────────────────────────────────────────────
apisix_put "/routes/100" '{
  "id": "100",
  "name": "health-check",
  "uri": "/health",
  "upstream_id": "1",
  "plugins": {
    "limit-req": {"rate": 100, "burst": 200, "key": "remote_addr"}
  },
  "priority": 200
}'

log "APISix bootstrap complete."
log "Routes created: $(curl -sf -H 'X-API-KEY: '"${APISIX_ADMIN_KEY}"'' "${APISIX_BASE}/routes" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(len(d.get("list",[])))' 2>/dev/null || echo 'unknown')"
