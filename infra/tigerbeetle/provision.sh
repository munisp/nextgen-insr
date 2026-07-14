#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# InsurePortal TigerBeetle Account Provisioning Script
# Creates all ledger accounts required for the InsurePortal Agency Banking Platform.
#
# Account ID Convention (128-bit, encoded as two u64 values):
#   Ledger 1 = NGN (Nigerian Naira)
#   Ledger 2 = USD (US Dollar)
#   Ledger 3 = GBP (British Pound)
#
# Account Types (upper 32 bits of ID):
#   0x0001xxxx = System/Settlement accounts
#   0x0002xxxx = Agent float accounts
#   0x0003xxxx = Customer accounts
#   0x0004xxxx = Fee/commission accounts
#   0x0005xxxx = CBN reserve accounts
#   0x0006xxxx = Suspense accounts
#
# Usage:
#   ./provision.sh [--host localhost:3000] [--cluster 0]
#
# Environment variables:
#   TB_ADDRESS  — TigerBeetle address (default: localhost:3000)
#   TB_CLUSTER  — TigerBeetle cluster ID (default: 0)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

TB_ADDRESS="${TB_ADDRESS:-localhost:3000}"
TB_CLUSTER="${TB_CLUSTER:-0}"
TB_SIDECAR_URL="${TB_SIDECAR_URL:-http://localhost:8080}"

# Parse CLI args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)    TB_ADDRESS="$2"; shift 2;;
    --cluster) TB_CLUSTER="$2"; shift 2;;
    --sidecar) TB_SIDECAR_URL="$2"; shift 2;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

log()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [TIGERBEETLE] $*"; }
error(){ echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [ERROR] $*" >&2; exit 1; }

# ── Check TigerBeetle sidecar ─────────────────────────────────────────────────
log "Checking TigerBeetle sidecar at ${TB_SIDECAR_URL}..."
for i in $(seq 1 20); do
  if curl -sf "${TB_SIDECAR_URL}/health" &>/dev/null; then
    log "TigerBeetle sidecar is ready."
    break
  fi
  [[ $i -eq 20 ]] && error "TigerBeetle sidecar not ready after 20 attempts"
  sleep 3
done

# ── Account creation helper ───────────────────────────────────────────────────
create_account() {
  local id="$1"
  local ledger="$2"
  local code="$3"
  local flags="${4:-0}"
  local description="$5"

  log "Creating account: ${description} (id=${id}, ledger=${ledger}, code=${code})"

  local response
  response=$(curl -sf -X POST "${TB_SIDECAR_URL}/accounts" \
    -H "Content-Type: application/json" \
    -d "{
      \"id\": ${id},
      \"ledger\": ${ledger},
      \"code\": ${code},
      \"flags\": ${flags},
      \"user_data_128\": 0,
      \"user_data_64\": 0,
      \"user_data_32\": 0
    }" 2>&1) || {
    log "Warning: account ${id} may already exist or sidecar error: ${response}"
    return 0
  }
  log "Account created: ${description}"
}

# ── Ledger codes ──────────────────────────────────────────────────────────────
# Code 1000 = Settlement/System account
# Code 2000 = Agent float account
# Code 3000 = Customer account
# Code 4000 = Fee collection account
# Code 5000 = CBN reserve account
# Code 6000 = Suspense account
# Code 7000 = Interbank settlement account
# Code 8000 = Commission account

# Flags:
# 0 = normal account (debit/credit)
# 1 = linked (part of a transfer chain)
# 2 = debits_must_not_exceed_credits (overdraft protection)
# 4 = credits_must_not_exceed_debits (reserve account)

log "Provisioning TigerBeetle accounts for InsurePortal Agency Banking Platform..."

# ── LEDGER 1: NGN (Nigerian Naira) ────────────────────────────────────────────
log "--- NGN Ledger (1) ---"

# System settlement accounts
create_account 1001 1 1000 0 "NGN Master Settlement Account"
create_account 1002 1 1000 0 "NGN CBN Clearing Account"
create_account 1003 1 1000 0 "NGN Interbank Settlement Account"
create_account 1004 1 7000 0 "NGN NIBSS Settlement Account"
create_account 1005 1 7000 0 "NGN NIP Settlement Account"

# Float pool accounts
create_account 2001 1 2000 2 "NGN Agent Float Pool - Tier 1"
create_account 2002 1 2000 2 "NGN Agent Float Pool - Tier 2"
create_account 2003 1 2000 2 "NGN Agent Float Pool - Tier 3"
create_account 2004 1 2000 2 "NGN Super-Agent Float Pool"
create_account 2005 1 2000 2 "NGN Aggregator Float Pool"

# Fee and commission accounts
create_account 4001 1 4000 0 "NGN Transaction Fee Collection"
create_account 4002 1 8000 0 "NGN Agent Commission Pool"
create_account 4003 1 8000 0 "NGN Super-Agent Commission Pool"
create_account 4004 1 8000 0 "NGN Platform Revenue Account"
create_account 4005 1 4000 0 "NGN CBN Levy Collection"

# CBN reserve accounts
create_account 5001 1 5000 4 "NGN CBN Cash Reserve Requirement"
create_account 5002 1 5000 4 "NGN CBN Liquidity Reserve"
create_account 5003 1 5000 4 "NGN Statutory Reserve Fund"

# Suspense accounts
create_account 6001 1 6000 0 "NGN Inbound Suspense"
create_account 6002 1 6000 0 "NGN Outbound Suspense"
create_account 6003 1 6000 0 "NGN Failed Transaction Suspense"
create_account 6004 1 6000 0 "NGN Dispute Suspense"
create_account 6005 1 6000 0 "NGN Reconciliation Suspense"

# ── LEDGER 2: USD (US Dollar) ─────────────────────────────────────────────────
log "--- USD Ledger (2) ---"

create_account 10001 2 1000 0 "USD Master Settlement Account"
create_account 10002 2 1000 0 "USD Correspondent Bank Account"
create_account 10003 2 7000 0 "USD SWIFT Settlement Account"
create_account 10004 2 2000 2 "USD Agent Float Pool"
create_account 10005 2 4000 0 "USD Fee Collection"
create_account 10006 2 6000 0 "USD Suspense Account"
create_account 10007 2 5000 4 "USD Reserve Account"

# ── LEDGER 3: GBP (British Pound) ────────────────────────────────────────────
log "--- GBP Ledger (3) ---"

create_account 20001 3 1000 0 "GBP Master Settlement Account"
create_account 20002 3 1000 0 "GBP Correspondent Bank Account"
create_account 20003 3 7000 0 "GBP SWIFT Settlement Account"
create_account 20004 3 2000 2 "GBP Agent Float Pool"
create_account 20005 3 4000 0 "GBP Fee Collection"
create_account 20006 3 6000 0 "GBP Suspense Account"
create_account 20007 3 5000 4 "GBP Reserve Account"

# ── LEDGER 4: EUR (Euro) ──────────────────────────────────────────────────────
log "--- EUR Ledger (4) ---"

create_account 30001 4 1000 0 "EUR Master Settlement Account"
create_account 30002 4 1000 0 "EUR SEPA Settlement Account"
create_account 30003 4 2000 2 "EUR Agent Float Pool"
create_account 30004 4 4000 0 "EUR Fee Collection"
create_account 30005 4 6000 0 "EUR Suspense Account"

# ── Verify account count ──────────────────────────────────────────────────────
log "Querying account balances to verify provisioning..."
ACCOUNT_COUNT=$(curl -sf "${TB_SIDECAR_URL}/accounts/count" 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin).get("count",0))' 2>/dev/null || echo "unknown")
log "Total accounts provisioned: ${ACCOUNT_COUNT}"

log "TigerBeetle provisioning complete."
log "Ledgers: NGN(1), USD(2), GBP(3), EUR(4)"
log "Account types: Settlement, Float, Fee, Reserve, Suspense, Commission"
