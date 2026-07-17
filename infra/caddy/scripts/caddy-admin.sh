#!/usr/bin/env bash
# ─── InsurePortal Caddy Admin API Integration Script ─────────────────────────
# Manages Caddy configuration dynamically via the Admin API (port 2019).
# Used by the platform's GitOps pipeline to apply config changes without restart.
#
# Usage:
#   ./caddy-admin.sh status              - Check Caddy status
#   ./caddy-admin.sh reload              - Reload Caddyfile without downtime
#   ./caddy-admin.sh add-broker <slug>   - Add a new broker sub-domain
#   ./caddy-admin.sh remove-broker <slug>- Remove a broker sub-domain
#   ./caddy-admin.sh list-certs          - List all managed TLS certificates
#   ./caddy-admin.sh renew-cert <domain> - Force certificate renewal
#   ./caddy-admin.sh metrics             - Fetch Prometheus metrics
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

CADDY_ADMIN_URL="${CADDY_ADMIN_URL:-http://localhost:2019}"
CADDY_DOMAIN="${INSUREPORTAL_DOMAIN:-insureportal.ng}"

# Colours
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

log_info()    { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

caddy_api() {
    local method="$1"; local path="$2"; local data="${3:-}"
    if [[ -n "$data" ]]; then
        curl -sf -X "$method" "${CADDY_ADMIN_URL}${path}" \
            -H "Content-Type: application/json" \
            -d "$data"
    else
        curl -sf -X "$method" "${CADDY_ADMIN_URL}${path}"
    fi
}

cmd_status() {
    log_info "Caddy status:"
    caddy_api GET /config/ | python3 -c "
import json,sys
cfg=json.load(sys.stdin)
apps=cfg.get('apps',{})
http=apps.get('http',{})
servers=http.get('servers',{})
print(f'  HTTP servers: {len(servers)}')
tls=apps.get('tls',{})
certs=tls.get('certificates',{})
print(f'  TLS certificate configs: {len(certs)}')
pki=apps.get('pki',{})
cas=pki.get('certificate_authorities',{})
print(f'  Internal CAs: {len(cas)}')
" 2>/dev/null || echo "  (Could not parse config)"
    echo ""
    log_info "Caddy version:"
    caddy_api GET /reverse_proxy/upstreams 2>/dev/null | \
        python3 -c "import json,sys; ups=json.load(sys.stdin); [print(f'  Upstream: {u[\"dial\"]} healthy={u.get(\"healthy\",\"?\")}') for u in ups]" \
        2>/dev/null || true
}

cmd_reload() {
    log_info "Reloading Caddy configuration..."
    CADDYFILE="${1:-/etc/caddy/Caddyfile}"
    if [[ ! -f "$CADDYFILE" ]]; then
        log_error "Caddyfile not found: $CADDYFILE"
        exit 1
    fi
    # Validate first
    caddy validate --config "$CADDYFILE" --adapter caddyfile 2>&1 && \
        log_info "Caddyfile is valid" || { log_error "Caddyfile validation failed"; exit 1; }
    # Reload via admin API
    caddy_api POST /load "$(caddy adapt --config "$CADDYFILE" --adapter caddyfile 2>/dev/null)" && \
        log_info "Caddy reloaded successfully (zero downtime)" || \
        log_error "Reload failed"
}

cmd_add_broker() {
    local slug="${1:-}"
    if [[ -z "$slug" ]]; then
        log_error "Usage: $0 add-broker <slug>"
        exit 1
    fi
    local domain="${slug}.brokers.${CADDY_DOMAIN}"
    log_info "Adding broker sub-domain: $domain"
    # Add a new route via the Admin API
    caddy_api POST /config/apps/http/servers/insureportal/routes \
        "{
            \"@id\": \"broker-${slug}\",
            \"match\": [{\"host\": [\"${domain}\"]}],
            \"handle\": [
                {
                    \"handler\": \"headers\",
                    \"request\": {\"set\": {\"X-Broker-Slug\": [\"${slug}\"]}}
                },
                {
                    \"handler\": \"reverse_proxy\",
                    \"upstreams\": [{\"dial\": \"${APISIX_UPSTREAM:-apisix:9080}\"}],
                    \"headers\": {
                        \"request\": {\"set\": {\"X-Broker-Slug\": [\"${slug}\"]}}
                    }
                }
            ],
            \"terminal\": true
        }" && log_info "Broker $slug added: https://$domain" || \
        log_error "Failed to add broker $slug"
}

cmd_remove_broker() {
    local slug="${1:-}"
    if [[ -z "$slug" ]]; then
        log_error "Usage: $0 remove-broker <slug>"
        exit 1
    fi
    log_info "Removing broker sub-domain: ${slug}.brokers.${CADDY_DOMAIN}"
    caddy_api DELETE "/config/apps/http/servers/insureportal/routes/broker-${slug}" && \
        log_info "Broker $slug removed" || \
        log_error "Failed to remove broker $slug (may not exist)"
}

cmd_list_certs() {
    log_info "Managed TLS certificates:"
    caddy_api GET /pki/ca/insureportal-internal 2>/dev/null | \
        python3 -c "
import json,sys
ca=json.load(sys.stdin)
print(f'  Internal CA: {ca.get(\"name\",\"?\")}')
print(f'  Root CN: {ca.get(\"root\",{}).get(\"subject\",{}).get(\"common_name\",\"?\")}')
" 2>/dev/null || true
    echo ""
    log_info "Upstream health (proxy targets):"
    caddy_api GET /reverse_proxy/upstreams 2>/dev/null | \
        python3 -c "
import json,sys
ups=json.load(sys.stdin)
for u in ups:
    healthy = '✅' if u.get('healthy') else '❌'
    print(f'  {healthy} {u[\"dial\"]} (fails={u.get(\"num_requests\",0)} reqs)')
" 2>/dev/null || echo "  (No upstream data)"
}

cmd_renew_cert() {
    local domain="${1:-}"
    if [[ -z "$domain" ]]; then
        log_error "Usage: $0 renew-cert <domain>"
        exit 1
    fi
    log_info "Forcing certificate renewal for: $domain"
    # Caddy handles renewals automatically, but we can force via the API
    caddy_api POST /pki/ca/local/certificates \
        "{\"subjects\": [\"${domain}\"]}" && \
        log_info "Certificate renewal triggered for $domain" || \
        log_warn "Manual renewal not supported for ACME certs (Caddy auto-renews at 2/3 lifetime)"
}

cmd_metrics() {
    log_info "Fetching Prometheus metrics from Caddy admin API..."
    curl -sf "${CADDY_ADMIN_URL}/metrics" | grep -E "^caddy_" | head -30
}

# ── Main ──────────────────────────────────────────────────────────────────────
CMD="${1:-status}"
shift || true

case "$CMD" in
    status)         cmd_status ;;
    reload)         cmd_reload "$@" ;;
    add-broker)     cmd_add_broker "$@" ;;
    remove-broker)  cmd_remove_broker "$@" ;;
    list-certs)     cmd_list_certs ;;
    renew-cert)     cmd_renew_cert "$@" ;;
    metrics)        cmd_metrics ;;
    *)
        echo "Usage: $0 {status|reload|add-broker|remove-broker|list-certs|renew-cert|metrics}"
        exit 1
        ;;
esac
