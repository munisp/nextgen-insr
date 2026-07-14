#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Temporal Namespace Provisioning — NGApp Platform
#
# Creates all required Temporal namespaces for NGApp microservices.
# Run after Temporal server is up: ./infra/temporal/setup-namespaces.sh
#
# Prerequisites:
#   - temporal CLI available (https://docs.temporal.io/cli#installation)
#   - Temporal server reachable at TEMPORAL_ADDRESS
# ─────────────────────────────────═════════════════════════════════════════
set -euo pipefail

TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-localhost:7233}"
DEFAULT_NAMESPACE="${TEMPORAL_NAMESPACE:-ngapp}"

echo "[Temporal] Connecting to: ${TEMPORAL_ADDRESS}"
echo "[Temporal] Default namespace: ${DEFAULT_NAMESPACE}"

# Helper function to create namespace if it doesn't exist
create_namespace() {
  local NAMESPACE=$1
  local CLUSTER="${2:-default-cluster}"
  local RETENTION_DAYS="${3:-7}"
  local REPLICATION_CONSISTENCY="${4:-eventual}"

  temporal namespace describe \
    --namespace "${NAMESPACE}" \
    --address "${TEMPORAL_ADDRESS}" 2>/dev/null && {
      echo "[Temporal] ✓ Namespace already exists: ${NAMESPACE}"
      return 0
  }

  temporal namespace register \
    --namespace "${NAMESPACE}" \
    --address "${TEMPORAL_ADDRESS}" \
    --replication-cluster "${CLUSTER}" \
    --retention "${RETENTION_DAYS}" \
    --description "NGApp Platform - ${NAMESPACE}" \
    2>/dev/null && {
      echo "[Temporal] ✓ Namespace created: ${NAMESPACE} (retention: ${RETENTION_DAYS}d)"
      return 0
  }

  echo "[Temporal] ✗ Failed to create namespace: ${NAMESPACE}"
  return 1
}

echo ""
echo "[Temporal] ═══════════════════════════════════════════════════════════"
echo "[Temporal] Creating NGApp Platform Namespaces"
echo "[Temporal] ═══════════════════════════════════════════════════════════"

# ── Core Namespaces ──
create_namespace "ngapp" "default-cluster" "30"
create_namespace "ngapp-claims" "default-cluster" "30"
create_namespace "ngapp-fraud" "default-cluster" "90"
create_namespace "ngapp-policies" "default-cluster" "90"
create_namespace "ngapp-payments" "default-cluster" "365"
create_namespace "ngapp-notifications" "default-cluster" "7"
create_namespace "ngapp-kyc" "default-cluster" "365"

# ── Compliance Namespaces ──
create_namespace "ngapp-compliance-cbn" "default-cluster" "365"
create_namespace "ngapp-compliance-naicom" "default-cluster" "365"
create_namespace "ngapp-compliance-ndpr" "default-cluster" "365"

# ── Agent Namespaces ──
create_namespace "ngapp-agent" "default-cluster" "90"
create_namespace "ngapp-agent-commission" "default-cluster" "365"

# ── Settlement Namespaces ──
create_namespace "ngapp-settlement" "default-cluster" "365"
create_namespace "ngapp-settlement-daily" "default-cluster" "90"

# ── Reporting Namespaces ──
create_namespace "ngapp-reporting" "default-cluster" "365"
create_namespace "ngapp-audit" "default-cluster" "365"

echo ""
echo "[Temporal] ═══════════════════════════════════════════════════════════"
echo "[Temporal] ✅ All NGApp Platform namespaces provisioned"
echo "[Temporal] ═══════════════════════════════════════════════════════════"
echo "[Temporal] Listing all namespaces:"
temporal namespace list --address "${TEMPORAL_ADDRESS}" 2>/dev/null || echo "[Temporal] (namespace list failed - temporal CLI may not be available)"
