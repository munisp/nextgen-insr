#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Kafka Topic Provisioning Script — NGApp Platform
#
# Creates all required Kafka topics for all NGApp microservices.
# Run once after Kafka starts: ./infra/kafka/create-topics-ngapp.sh
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
echo "[Kafka] Creating NGApp Platform Topics"
echo "[Kafka] ═══════════════════════════════════════════════════════════"

# ── Core Transaction Topics ──
echo "[Kafka] Creating transaction topics..."
create_topic "ngapp.transactions.created"     12  604800000
create_topic "ngapp.transactions.completed"   12  604800000
create_topic "ngapp.transactions.failed"      12  604800000
create_topic "ngapp.transactions.reversed"    6   604800000

# ── Claims & Adjudication Topics ──
echo "[Kafka] Creating claims topics..."
create_topic "ngapp.claims.submitted"         6   604800000
create_topic "ngapp.claims.adjudicated"       6   604800000
create_topic "ngapp.claims.approved"          6   604800000
create_topic "ngapp.claims.denied"            6   604800000
create_topic "ngapp.claims.paid"              6   2592000000  # 30 days

# ── Fraud Detection Topics ──
echo "[Kafka] Creating fraud topics..."
create_topic "ngapp.fraud.events"             12  2592000000  # 30 days
create_topic "ngapp.fraud.alerts"             6   2592000000
create_topic "ngapp.fraud.decisions"          6   2592000000

# ── Policy Management Topics ──
echo "[Kafka] Creating policy topics..."
create_topic "ngapp.policies.issued"          6   2592000000
create_topic "ngapp.policies.renewed"         6   2592000000
create_topic "ngapp.policies.cancelled"       6   2592000000
create_topic "ngapp.policies.workflow.events" 12  604800000

# ── KYC/KYB Topics ──
echo "[Kafka] Creating KYC topics..."
create_topic "ngapp.kyc.verified"             6   2592000000
create_topic "ngapp.kyc.failed"               6   604800000
create_topic "ngapp.kyb.verified"             6   2592000000

# ── Payment & Premium Topics ──
echo "[Kafka] Creating payment topics..."
create_topic "ngapp.payments.initiated"       6   604800000
create_topic "ngapp.payments.completed"       6   604800000
create_topic "ngapp.payments.failed"          6   604800000
create_topic "ngapp.payments.refunded"        6   604800000
create_topic "ngapp.premium.collections"      6   604800000
create_topic "ngapp.premium.finance"          6   604800000

# ── Notification Topics ──
echo "[Kafka] Creating notification topics..."
create_topic "ngapp.notifications.email"      6   3600000    # 1 hour
create_topic "ngapp.notifications.sms"        6   3600000
create_topic "ngapp.notifications.push"       6   3600000
create_topic "ngapp.notifications.ussd"       3   3600000

# ── USSD Gateway Topics ──
echo "[Kafka] Creating USSD topics..."
create_topic "ngapp.ussd.requests"            6   604800000
create_topic "ngapp.ussd.responses"           6   604800000

# ── MDM Topics ──
echo "[Kafka] Creating MDM topics..."
create_topic "ngapp.mdm.heartbeats"           12  86400000   # 1 day
create_topic "ngapp.mdm.compliance"           6   604800000
create_topic "ngapp.mdm.geofence"             6   604800000

# ── SIM Orchestrator Topics ──
echo "[Kafka] Creating SIM topics..."
create_topic "ngapp.sim.probe.readings"       6   86400000   # 1 day
create_topic "ngapp.sim.failover.events"      6   604800000
create_topic "ngapp.sim.carrier.status"       3   86400000

# ── Settlement Topics ──
echo "[Kafka] Creating settlement topics..."
create_topic "ngapp.settlement.daily"         3   2592000000  # 30 days
create_topic "ngapp.settlement.completed"     3   2592000000
create_topic "ngapp.settlement.failed"        3   2592000000

# ── Agent Lifecycle Topics ──
echo "[Kafka] Creating agent topics..."
create_topic "ngapp.agent.registered"         3   -1          # infinite
create_topic "ngapp.agent.suspended"          3   -1
create_topic "ngapp.agent.kyc.completed"      3   -1
create_topic "ngapp.agent.commission"         6   604800000

# ── Compliance Topics ──
echo "[Kafka] Creating compliance topics..."
create_topic "ngapp.compliance.cbn.reports"   3   2592000000  # 30 days
create_topic "ngapp.compliance.naicom.reports" 3  2592000000
create_topic "ngapp.compliance.ndpr.reports"  3   2592000000
create_topic "ngapp.compliance.sar.filed"     3   -1          # infinite

# ── Audit Log Topics (compacted — infinite retention) ──
echo "[Kafka] Creating audit topics..."
create_topic "ngapp.audit.log"                6   -1  compact
create_topic "ngapp.audit.changes"            6   -1  compact

# ── Dead Letter Queues ──
echo "[Kafka] Creating DLQ topics..."
create_topic "ngapp.dlq.transactions"         3   604800000
create_topic "ngapp.dlq.settlements"          3   604800000
create_topic "ngapp.dlq.notifications"        3   604800000
create_topic "ngapp.dlq.claims"               3   604800000
create_topic "ngapp.dlq.payments"             3   604800000

# ── Takaful Topics ──
echo "[Kafka] Creating takaful topics..."
create_topic "ngapp.takaful.policies"         6   2592000000
create_topic "ngapp.takaful.fund.allocations" 6   2592000000

# ── Reinsurance Topics ──
echo "[Kafka] Creating reinsurance topics..."
create_topic "ngapp.reinsurance.ceded"        6   2592000000
create_topic "ngapp.reinsurance.recovered"    6   2592000000

# ── Microinsurance Topics ──
echo "[Kafka] Creating microinsurance topics..."
create_topic "ngapp.microinsurance.policies"  6   2592000000
create_topic "ngapp.microinsurance.claims"    6   604800000

# ── Gamification Topics ──
echo "[Kafka] Creating gamification topics..."
create_topic "ngapp.gamification.achievements" 6  604800000
create_topic "ngapp.gamification.rewards"     6  604800000

# ── Disater Recovery Topics ──
echo "[Kafka] Creating DR topics..."
create_topic "ngapp.dr.replication"           3   604800000
create_topic "ngapp.dr.failover.events"       3   604800000

echo ""
echo "[Kafka] ═══════════════════════════════════════════════════════════"
echo "[Kafka] ✅ All NGApp Platform topics provisioned"
echo "[Kafka] ═══════════════════════════════════════════════════════════"
kafka-topics.sh --bootstrap-server "${KAFKA_BROKERS}" --list | grep "ngapp\." | wc -l | xargs -I{} echo "[Kafka] Total ngapp topics: {}"
