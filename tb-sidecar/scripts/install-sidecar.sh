#!/usr/bin/env bash
# ============================================================
# InsurePortal POS — TigerBeetle Sidecar One-Command Installer
# Run as root on the POS terminal:
#   sudo bash install-sidecar.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIDECAR_BINARY="${SCRIPT_DIR}/../tb-sidecar"   # compiled Go binary
TB_VERSION="0.16.78"
TB_ARCH="x86_64"                               # change to aarch64 for ARM terminals

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${GREEN}[install]${NC} $*"; }
warn()    { echo -e "${YELLOW}[install]${NC} $*"; }
error()   { echo -e "${RED}[install]${NC} $*" >&2; exit 1; }
section() { echo -e "\n${BOLD}── $* ──${NC}"; }

# ── Root check ───────────────────────────────────────────────
[[ "${EUID}" -eq 0 ]] || error "This script must be run as root (sudo bash install-sidecar.sh)"

section "1. Create system user and directories"
if ! id -u insureportal &>/dev/null; then
  useradd --system --no-create-home --shell /sbin/nologin insureportal
  info "Created system user: insureportal"
else
  info "System user insureportal already exists."
fi
mkdir -p /var/lib/insureportal/tb-data /var/log/insureportal /etc/insureportal
chown -R insureportal:insureportal /var/lib/insureportal /var/log/insureportal

section "2. Install TigerBeetle binary"
if [[ ! -x /usr/local/bin/tigerbeetle ]]; then
  info "Downloading TigerBeetle v${TB_VERSION}..."
  TB_URL="https://github.com/tigerbeetle/tigerbeetle/releases/download/${TB_VERSION}/tigerbeetle-${TB_ARCH}-linux.zip"
  TMP_ZIP=$(mktemp /tmp/tb.XXXXXX.zip)
  curl -fsSL "${TB_URL}" -o "${TMP_ZIP}"
  unzip -o "${TMP_ZIP}" -d /tmp/tb-extract/
  install -m 0755 /tmp/tb-extract/tigerbeetle /usr/local/bin/tigerbeetle
  rm -rf "${TMP_ZIP}" /tmp/tb-extract/
  info "TigerBeetle installed: $(tigerbeetle version)"
else
  info "TigerBeetle already installed: $(tigerbeetle version)"
fi

section "3. Install sidecar binary"
if [[ ! -f "${SIDECAR_BINARY}" ]]; then
  error "Sidecar binary not found at ${SIDECAR_BINARY}. Build it first: cd tb-sidecar && go build ./cmd/sidecar"
fi
install -m 0755 "${SIDECAR_BINARY}" /usr/local/bin/insureportal-tb-sidecar
info "Sidecar binary installed at /usr/local/bin/insureportal-tb-sidecar"

section "4. Install start script"
install -m 0755 "${SCRIPT_DIR}/start-sidecar.sh" /usr/local/bin/insureportal-start-sidecar.sh
info "Start script installed at /usr/local/bin/insureportal-start-sidecar.sh"

section "5. Create environment file"
ENV_FILE="/etc/insureportal/sidecar.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  cat > "${ENV_FILE}" << 'EOF'
# InsurePortal TigerBeetle Sidecar Environment
# Edit this file to configure the sidecar on this terminal.

# PostgreSQL connection string for metadata sync
# POSTGRES_URL=postgresql://posadmin:posinsureportal2026@localhost:5432/posinsureportal

# TigerBeetle Zig cluster address (if running on a separate host)
# TB_REPLICA_ADDR=3000

# Sidecar HTTP port (must match VITE_TB_SIDECAR_URL in the Node.js server)
# SIDECAR_PORT=8030
EOF
  chmod 640 "${ENV_FILE}"
  chown root:insureportal "${ENV_FILE}"
  info "Environment file created at ${ENV_FILE}"
else
  warn "Environment file already exists at ${ENV_FILE} — not overwriting."
fi

section "6. Register systemd service"
install -m 0644 "${SCRIPT_DIR}/insureportal-tb-sidecar.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable insureportal-tb-sidecar
info "Service registered and enabled."

section "7. Start service"
systemctl restart insureportal-tb-sidecar
sleep 2
if systemctl is-active --quiet insureportal-tb-sidecar; then
  info "Service is running."
  systemctl status insureportal-tb-sidecar --no-pager -l | tail -8
else
  warn "Service did not start cleanly. Check logs:"
  warn "  journalctl -u insureportal-tb-sidecar -n 50 --no-pager"
fi

section "Done"
echo -e "${GREEN}InsurePortal TigerBeetle Sidecar installed successfully.${NC}"
echo ""
echo "  Health check : curl http://localhost:8030/health"
echo "  Logs         : journalctl -u insureportal-tb-sidecar -f"
echo "  Config       : ${ENV_FILE}"
echo ""
