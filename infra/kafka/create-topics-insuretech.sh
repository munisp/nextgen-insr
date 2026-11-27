#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Kafka Topic Provisioning Script — InsureTech Platform
#
# Creates all required Kafka topics for all InsureTech microservices.
# Run once after Kafka starts: ./infra/kafka/create-topics-insuretech.sh
#
# Prerequisites:
#   - kafka-topics.sh available (Kafka bin directory in PATH)
#   - Kafka broker reachable at KAFKA_BROKERS
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

KAFKA_BROKERS="${KAFKA_BROKERS:-localhost:9092}"
REPLICATION_FACTOR="${KAFKA_REPLICATION_FACTOR:-1}"

echo "[Kafka] Connecting to brokers: ${KAFKA_BROKERS}"

# Helper function to create topic if it doesn't exist
create_topic() {
  local TOPIC=$1
  local PARTITIONS=$2
  local RETENTION_MS=$3
  local CLEANUP_POLICY="${4:-delete}"

  kafka-topics.sh \
    --bootstrap-server "${KAFKA_BROKERS}" \
    --create \
    --if-not-exists \
    --topic "${TOPIC}" \
    --partitions "${PARTITIONS}" \
    --replication-factor "${REPLICATION_FACTOR}" \
    --config retention.ms="${RETENTION_MS}" \
    --config cleanup.policy="${CLEANUP_POLICY}" \
    --config min.insync.replicas=$(( REPLICATION_FACTOR > 1 ? REPLICATION_FACTOR - 1 : 1 )) \
    && echo "[Kafka] ✓ Topic: ${TOPIC} (${PARTITIONS} partitions, retention: ${RETENTION_MS}ms)"
}

echo ""
echo "[Kafka] ═══════════════════════════════════════════════════════════"
echo "[Kafka] Creating InsureTech Platform Topics"
echo "[Kafka] ═══════════════════════════════════════════════════════════"

# ── Core Transaction Topics ──
echo "[Kafka] Creating transaction topics..."
create_topic "insuretech.transactions.created"     12  604800000
create_topic "insuretech.transactions.completed"   12  604800000
create_topic "insuretech.transactions.failed"      12  604800000
create_topic "insuretech.transactions.reversed"    6   604800000

# ── Claims & Adjudication Topics ──
echo "[Kafka] Creating claims topics..."
create_topic "insuretech.claims.submitted"         6   604800000
create_topic "insuretech.claims.adjudicated"       6   604800000
create_topic "insuretech.claims.approved"          6   604800000
create_topic "insuretech.claims.denied"            6   604800000
create_topic "insuretech.claims.paid"              6   2592000000  # 30 days

# ── Fraud Detection Topics ──
echo "[Kafka] Creating fraud topics..."
create_topic "insuretech.fraud.events"             12  2592000000  # 30 days
create_topic "insuretech.fraud.alerts"             6   2592000000
create_topic "insuretech.fraud.decisions"          6   2592000000

# ── Policy Management Topics ──
echo "[Kafka] Creating policy topics..."
create_topic "insuretech.policies.issued"          6   2592000000
create_topic "insuretech.policies.renewed"         6   2592000000
create_topic "insuretech.policies.cancelled"       6   2592000000
create_topic "insuretech.policies.workflow.events" 12  604800000

# ── KYC/KYB Topics ──
echo "[Kafka] Creating KYC topics..."
create_topic "insuretech.kyc.verified"             6   2592000000
create_topic "insuretech.kyc.failed"               6   604800000
create_topic "insuretech.kyb.verified"             6   2592000000

# ── Payment & Premium Topics ──
echo "[Kafka] Creating payment topics..."
create_topic "insuretech.payments.initiated"       6   604800000
create_topic "insuretech.payments.completed"       6   604800000
create_topic "insuretech.payments.failed"          6   604800000
create_topic "insuretech.payments.refunded"        6   604800000
create_topic "insuretech.premium.collections"      6   604800000
create_topic "insuretech.premium.finance"          6   604800000

# ── Notification Topics ──
echo "[Kafka] Creating notification topics..."
create_topic "insuretech.notifications.email"      6   3600000    # 1 hour
create_topic "insuretech.notifications.sms"        6   3600000
create_topic "insuretech.notifications.push"       6   3600000
create_topic "insuretech.notifications.ussd"       3   3600000

# ── USSD Gateway Topics ──
echo "[Kafka] Creating USSD topics..."
create_topic "insuretech.ussd.requests"            6   604800000
create_topic "insuretech.ussd.responses"           6   604800000

# ── MDM Topics ──
echo "[Kafka] Creating MDM topics..."
create_topic "insuretech.mdm.heartbeats"           12  86400000   # 1 day
create_topic "insuretech.mdm.compliance"           6   604800000
create_topic "insuretech.mdm.geofence"             6   604800000

# ── SIM Orchestrator Topics ──
echo "[Kafka] Creating SIM topics..."
create_topic "insuretech.sim.probe.readings"       6   86400000   # 1 day
create_topic "insuretech.sim.failover.events"      6   604800000
create_topic "insuretech.sim.carrier.status"       3   86400000

# ── Settlement Topics ──
echo "[Kafka] Creating settlement topics..."
create_topic "insuretech.settlement.daily"         3   2592000000  # 30 days
create_topic "insuretech.settlement.completed"     3   2592000000
create_topic "insuretech.settlement.failed"        3   2592000000

# ── Agent Lifecycle Topics ──
echo "[Kafka] Creating agent topics..."
create_topic "insuretech.agent.registered"         3   -1          # infinite
create_topic "insuretech.agent.suspended"          3   -1
create_topic "insuretech.agent.kyc.completed"      3   -1
create_topic "insuretech.agent.commission"         6   604800000

# ── Compliance Topics ──
echo "[Kafka] Creating compliance topics..."
create_topic "insuretech.compliance.cbn.reports"   3   2592000000  # 30 days
create_topic "insuretech.compliance.naicom.reports" 3  2592000000
create_topic "insuretech.compliance.ndpr.reports"  3   2592000000
create_topic "insuretech.compliance.sar.filed"     3   -1          # infinite

# ── Audit Log Topics (compacted — infinite retention) ──
echo "[Kafka] Creating audit topics..."
create_topic "insuretech.audit.log"                6   -1  compact
create_topic "insuretech.audit.changes"            6   -1  compact

# ── Dead Letter Queues ──
echo "[Kafka] Creating DLQ topics..."
create_topic "insuretech.dlq.transactions"         3   604800000
create_topic "insuretech.dlq.settlements"          3   604800000
create_topic "insuretech.dlq.notifications"        3   604800000
create_topic "insuretech.dlq.claims"               3   604800000
create_topic "insuretech.dlq.payments"             3   604800000

# ── Takaful Topics ──
echo "[Kafka] Creating takaful topics..."
create_topic "insuretech.takaful.policies"         6   2592000000
create_topic "insuretech.takaful.fund.allocations" 6   2592000000

# ── Reinsurance Topics ──
echo "[Kafka] Creating reinsurance topics..."
create_topic "insuretech.reinsurance.ceded"        6   2592000000
create_topic "insuretech.reinsurance.recovered"    6   2592000000

# ── Microinsurance Topics ──
echo "[Kafka] Creating microinsurance topics..."
create_topic "insuretech.microinsurance.policies"  6   2592000000
create_topic "insuretech.microinsurance.claims"    6   604800000

# ── Gamification Topics ──
echo "[Kafka] Creating gamification topics..."
create_topic "insuretech.gamification.achievements" 6  604800000
create_topic "insuretech.gamification.rewards"     6  604800000

# ── Disater Recovery Topics ──
echo "[Kafka] Creating DR topics..."
create_topic "insuretech.dr.replication"           3   604800000
create_topic "insuretech.dr.failover.events"       3   604800000

echo ""
echo "[Kafka] ═══════════════════════════════════════════════════════════"
echo "[Kafka] ✅ All InsureTech Platform topics provisioned"
echo "[Kafka] ═══════════════════════════════════════════════════════════"
kafka-topics.sh --bootstrap-server "${KAFKA_BROKERS}" --list | grep "insuretech\." | wc -l | xargs -I{} echo "[Kafka] Total insuretech topics: {}"
