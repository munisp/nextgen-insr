#!/usr/bin/env bash
# ============================================================
# InsurePortal POS — TigerBeetle Sidecar Start Script
# Runs the tb-sidecar binary on the POS terminal.
# Designed to be called by systemd or manually for testing.
# ============================================================
set -euo pipefail

# ── Configuration ────────────────────────────────────────────
SIDECAR_BIN="${SIDECAR_BIN:-/usr/local/bin/insureportal-tb-sidecar}"
TB_BIN="${TB_BIN:-/usr/local/bin/tigerbeetle}"
TB_DATA_DIR="${TB_DATA_DIR:-/var/lib/insureportal/tb-data}"
TB_DATA_FILE="${TB_DATA_DIR}/cluster.tigerbeetle"
TB_CLUSTER_ID="${TB_CLUSTER_ID:-0}"
TB_REPLICA_ADDR="${TB_REPLICA_ADDR:-3000}"
SIDECAR_PORT="${SIDECAR_PORT:-8030}"
SIDECAR_SQLITE_PATH="${SIDECAR_SQLITE_PATH:-/var/lib/insureportal/sidecar.db}"
POSTGRES_URL="${POSTGRES_URL:-}"
LOG_DIR="${LOG_DIR:-/var/log/insureportal}"
LOG_FILE="${LOG_DIR}/tb-sidecar.log"

# ── Colour helpers ───────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[InsurePortal TB]${NC} $*"; }
warn()  { echo -e "${YELLOW}[InsurePortal TB]${NC} $*"; }
error() { echo -e "${RED}[InsurePortal TB]${NC} $*" >&2; }

# ── Pre-flight checks ────────────────────────────────────────
info "Starting InsurePortal TigerBeetle Sidecar..."

if [[ ! -x "${SIDECAR_BIN}" ]]; then
  error "Sidecar binary not found at ${SIDECAR_BIN}. Run install-sidecar.sh first."
  exit 1
fi

if [[ ! -x "${TB_BIN}" ]]; then
  error "TigerBeetle binary not found at ${TB_BIN}. Run install-sidecar.sh first."
  exit 1
fi

# ── Create required directories ──────────────────────────────
mkdir -p "${TB_DATA_DIR}" "${LOG_DIR}"

# ── Format TigerBeetle data file if it doesn't exist ─────────
if [[ ! -f "${TB_DATA_FILE}" ]]; then
  info "Formatting TigerBeetle data file at ${TB_DATA_FILE}..."
  "${TB_BIN}" format \
    --cluster="${TB_CLUSTER_ID}" \
    --replica=0 \
    --replica-count=1 \
    "${TB_DATA_FILE}" \
    >> "${LOG_FILE}" 2>&1
  info "TigerBeetle data file formatted."
fi

# ── Start TigerBeetle Zig cluster in background ───────────────
TB_PID_FILE="/var/run/insureportal-tigerbeetle.pid"
if [[ -f "${TB_PID_FILE}" ]] && kill -0 "$(cat "${TB_PID_FILE}")" 2>/dev/null; then
  info "TigerBeetle Zig cluster already running (PID $(cat "${TB_PID_FILE}"))."
else
  info "Starting TigerBeetle Zig cluster on port ${TB_REPLICA_ADDR}..."
  "${TB_BIN}" start \
    --addresses="0.0.0.0:${TB_REPLICA_ADDR}" \
    "${TB_DATA_FILE}" \
    >> "${LOG_FILE}" 2>&1 &
  TB_PID=$!
  echo "${TB_PID}" > "${TB_PID_FILE}"
  info "TigerBeetle Zig cluster started (PID ${TB_PID})."
  # Give it a moment to bind the port
  sleep 1
fi

# ── Start the Go sidecar ─────────────────────────────────────
info "Starting Go sidecar on port ${SIDECAR_PORT}..."
info "  SQLite path : ${SIDECAR_SQLITE_PATH}"
info "  TB address  : 127.0.0.1:${TB_REPLICA_ADDR}"
info "  PostgreSQL  : ${POSTGRES_URL:+(configured)}"

exec "${SIDECAR_BIN}" \
  -port="${SIDECAR_PORT}" \
  -sqlite="${SIDECAR_SQLITE_PATH}" \
  -tb-addr="127.0.0.1:${TB_REPLICA_ADDR}" \
  -postgres="${POSTGRES_URL}" \
  -sync-interval=5s \
  -batch-size=50
