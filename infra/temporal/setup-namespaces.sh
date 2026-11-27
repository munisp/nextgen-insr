#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Temporal Namespace Provisioning — InsureTech Platform
#
# Creates all required Temporal namespaces for InsureTech microservices.
# Run after Temporal server is up: ./infra/temporal/setup-namespaces.sh
#
# Prerequisites:
#   - temporal CLI available (https://docs.temporal.io/cli#installation)
#   - Temporal server reachable at TEMPORAL_ADDRESS
# ─────────────────────────────────═════════════════════════════════════════
set -euo pipefail

TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-localhost:7233}"
DEFAULT_NAMESPACE="${TEMPORAL_NAMESPACE:-insuretech}"

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
    --description "InsureTech Platform - ${NAMESPACE}" \
    2>/dev/null && {
      echo "[Temporal] ✓ Namespace created: ${NAMESPACE} (retention: ${RETENTION_DAYS}d)"
      return 0
  }

  echo "[Temporal] ✗ Failed to create namespace: ${NAMESPACE}"
  return 1
}

echo ""
echo "[Temporal] ═══════════════════════════════════════════════════════════"
echo "[Temporal] Creating InsureTech Platform Namespaces"
echo "[Temporal] ═══════════════════════════════════════════════════════════"

# ── Core Namespaces ──
create_namespace "insuretech" "default-cluster" "30"
create_namespace "insuretech-claims" "default-cluster" "30"
create_namespace "insuretech-fraud" "default-cluster" "90"
create_namespace "insuretech-policies" "default-cluster" "90"
create_namespace "insuretech-payments" "default-cluster" "365"
create_namespace "insuretech-notifications" "default-cluster" "7"
create_namespace "insuretech-kyc" "default-cluster" "365"

# ── Compliance Namespaces ──
create_namespace "insuretech-compliance-cbn" "default-cluster" "365"
create_namespace "insuretech-compliance-naicom" "default-cluster" "365"
create_namespace "insuretech-compliance-ndpr" "default-cluster" "365"

# ── Agent Namespaces ──
create_namespace "insuretech-agent" "default-cluster" "90"
create_namespace "insuretech-agent-commission" "default-cluster" "365"

# ── Settlement Namespaces ──
create_namespace "insuretech-settlement" "default-cluster" "365"
create_namespace "insuretech-settlement-daily" "default-cluster" "90"

# ── Reporting Namespaces ──
create_namespace "insuretech-reporting" "default-cluster" "365"
create_namespace "insuretech-audit" "default-cluster" "365"

echo ""
echo "[Temporal] ═══════════════════════════════════════════════════════════"
echo "[Temporal] ✅ All InsureTech Platform namespaces provisioned"
echo "[Temporal] ═══════════════════════════════════════════════════════════"
echo "[Temporal] Listing all namespaces:"
temporal namespace list --address "${TEMPORAL_ADDRESS}" 2>/dev/null || echo "[Temporal] (namespace list failed - temporal CLI may not be available)"
