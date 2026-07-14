#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# InsurePortal Fluvio SmartModule Deploy Script
# Deploys all WASM SmartModules to the Fluvio cluster and creates topics.
#
# Usage:
#   ./deploy-smartmodule.sh [--local | --cloud]
#
# Environment variables:
#   FLUVIO_ENDPOINT   — Fluvio cluster endpoint (default: localhost:9003)
#   FLUVIO_API_KEY    — Fluvio Cloud API key (required for --cloud mode)
#   FLUVIO_PROFILE    — Fluvio profile name (default: insureportal-production)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SMARTMODULE_DIR="${SCRIPT_DIR}/smartmodules"
FLUVIO_ENDPOINT="${FLUVIO_ENDPOINT:-localhost:9003}"
FLUVIO_PROFILE="${FLUVIO_PROFILE:-insureportal-production}"
MODE="${1:---local}"

log()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [FLUVIO] $*"; }
error(){ echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [ERROR]  $*" >&2; exit 1; }

# ── Check fluvio CLI ──────────────────────────────────────────────────────────
if ! command -v fluvio &>/dev/null; then
  log "fluvio CLI not found — installing..."
  curl -fsS https://hub.infinyon.cloud/install/install.sh | bash
  export PATH="${HOME}/.fluvio/bin:${PATH}"
fi

# ── Connect to cluster ────────────────────────────────────────────────────────
if [[ "${MODE}" == "--cloud" ]]; then
  [[ -z "${FLUVIO_API_KEY:-}" ]] && error "FLUVIO_API_KEY is required for cloud mode"
  log "Connecting to Fluvio Cloud..."
  fluvio cloud login --token "${FLUVIO_API_KEY}"
else
  log "Connecting to local Fluvio cluster at ${FLUVIO_ENDPOINT}..."
  fluvio profile add "${FLUVIO_PROFILE}" "${FLUVIO_ENDPOINT}" 2>/dev/null || true
  fluvio profile switch "${FLUVIO_PROFILE}" 2>/dev/null || true
fi

# ── Create topics ─────────────────────────────────────────────────────────────
log "Creating Fluvio topics..."
TOPICS=(
  "mdm.heartbeat"
  "mdm.commands"
  "mdm.compliance.violations"
  "mdm.geofence.violations"
  "sim.probe"
  "sim.failover"
  "tx.initiated"
  "tx.completed"
  "tx.failed"
  "fraud.alerts"
  "kyc.events"
  "settlement.batches"
  "agent.float.alerts"
  "cbn.reports"
  "ota.updates"
  "device.telemetry"
)

for topic in "${TOPICS[@]}"; do
  if fluvio topic list 2>/dev/null | grep -q "^${topic}"; then
    log "Topic already exists: ${topic}"
  else
    fluvio topic create "${topic}" --partitions 3 --replication 1 && \
      log "Created topic: ${topic}" || \
      log "Warning: failed to create topic ${topic} (may already exist)"
  fi
done

# ── Deploy SmartModules ───────────────────────────────────────────────────────
log "Deploying SmartModules from ${SMARTMODULE_DIR}..."

deploy_smartmodule() {
  local name="$1"
  local wasm_file="$2"
  local sm_type="${3:-filter}"  # filter | map | filter-map | array-map | aggregate

  if [[ ! -f "${wasm_file}" ]]; then
    log "Warning: WASM file not found: ${wasm_file} — skipping"
    return
  fi

  log "Deploying SmartModule: ${name} (${sm_type})"
  fluvio smartmodule create "${name}" \
    --wasm-file "${wasm_file}" \
    2>/dev/null || \
  fluvio smartmodule update "${name}" \
    --wasm-file "${wasm_file}" \
    2>/dev/null || \
  log "Warning: could not deploy ${name}"
}

# Deploy all compiled WASM SmartModules
deploy_smartmodule "insureportal-fraud-filter"      "${SMARTMODULE_DIR}/fraud_filter.wasm"      "filter"
deploy_smartmodule "insureportal-tx-enricher"       "${SMARTMODULE_DIR}/tx_enricher.wasm"        "map"
deploy_smartmodule "insureportal-mdm-heartbeat-map" "${SMARTMODULE_DIR}/mdm_heartbeat_map.wasm"  "map"
deploy_smartmodule "insureportal-sim-probe-filter"  "${SMARTMODULE_DIR}/sim_probe_filter.wasm"   "filter"
deploy_smartmodule "insureportal-kyc-router"        "${SMARTMODULE_DIR}/kyc_router.wasm"         "filter-map"
deploy_smartmodule "insureportal-settlement-agg"    "${SMARTMODULE_DIR}/settlement_agg.wasm"     "aggregate"

# ── Create connectors ─────────────────────────────────────────────────────────
log "Registering Kafka mirror connectors..."

# Mirror Kafka → Fluvio for MDM heartbeat
cat > /tmp/kafka-mdm-source.yaml << 'EOF'
apiVersion: 0.1.0
meta:
  version: 0.3.0
  name: kafka-mdm-heartbeat-source
  type: kafka-source
  topic: mdm.heartbeat
spec:
  brokers:
    - kafka:9092
  topic: mdm.heartbeat
  partition: 0
EOF

fluvio connector create -c /tmp/kafka-mdm-source.yaml 2>/dev/null || \
  log "Connector kafka-mdm-heartbeat-source already exists or Kafka not reachable"

log "Fluvio SmartModule deployment complete."
fluvio topic list
