// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * metrics.ts — Prometheus metrics registry for the InsurePortal POS Shell
 * ─────────────────────────────────────────────────────────────────────────────
 * Exposes a single shared prom-client Registry.  All instrumentation points
 * import from this module so they share the same registry instance.
 *
 * Endpoint: GET /api/metrics  (registered in server/_core/index.ts)
 *
 * Metrics defined here:
 *
 *   Counters (core)
 *   ────────────────
 *   pos_transactions_total          — every completed transaction (labels: type, status, channel)
 *   pos_transaction_errors_total    — failed transactions (labels: type, reason)
 *   pos_float_locks_total           — agent float lock events during settlement
 *   pos_disputes_raised_total       — new disputes raised (labels: type)
 *   pos_float_topup_requests_total  — float top-up requests (labels: status)
 *   pos_platform_calls_total        — outbound calls to platform microservices (labels: service, status)
 *   pos_fraud_alerts_total          — fraud alerts emitted (labels: severity)
 *
 *   Counters (business domain)
 *   ──────────────────────────
 *   pos_kyc_sessions_total          — KYC sessions by outcome
 *   pos_commission_payouts_total    — commission payout events by status
 *   pos_loyalty_redemptions_total   — loyalty reward redemptions by status
 *   pos_webhook_deliveries_total    — outbound webhook deliveries by event+status
 *   pos_agent_onboarding_total      — onboarding step transitions by step+status
 *   pos_referral_conversions_total  — referral conversions by agent tier
 *   pos_settlement_reconciliation_total — reconciliation outcomes
 *   pos_cbn_reports_total           — CBN regulatory report submissions by type
 *
 *   Gauges
 *   ──────
 *   pos_active_agents               — agents online in last 15 min
 *   pos_float_balance_total_ngn     — total float across all agents
 *   pos_pending_disputes            — disputes in pending/reviewing state
 *   pos_kafka_consumer_lag          — Kafka consumer lag per topic-partition
 *
 *   Histograms
 *   ──────────
 *   pos_transaction_duration_ms     — end-to-end transaction processing time
 *   pos_platform_call_duration_ms   — round-trip latency to platform services (labels: service)
 *   pos_http_request_duration_ms    — Express request duration (labels: method, route, status_code)
 */

import {
  Registry,
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
} from "prom-client";

// ── Shared registry ───────────────────────────────────────────────────────────

export const registry = new Registry();

// Collect default Node.js metrics (heap, GC, event loop lag, etc.)
collectDefaultMetrics({ register: registry, prefix: "pos_node_" });

// ── Core counters ─────────────────────────────────────────────────────────────

export const transactionsTotal = new Counter({
  name: "pos_transactions_total",
  help: "Total number of POS transactions processed",
  labelNames: ["type", "status", "channel"] as const,
  registers: [registry],
});

export const transactionErrorsTotal = new Counter({
  name: "pos_transaction_errors_total",
  help: "Total number of failed POS transactions",
  labelNames: ["type", "reason"] as const,
  registers: [registry],
});

export const floatLocksTotal = new Counter({
  name: "pos_float_locks_total",
  help: "Number of agent float lock events during settlement runs",
  labelNames: ["trigger"] as const,
  registers: [registry],
});

export const disputesRaisedTotal = new Counter({
  name: "pos_disputes_raised_total",
  help: "Total number of disputes raised by agents",
  labelNames: ["type"] as const,
  registers: [registry],
});

export const floatTopupRequestsTotal = new Counter({
  name: "pos_float_topup_requests_total",
  help: "Total number of float top-up requests",
  labelNames: ["status"] as const,
  registers: [registry],
});

export const platformCallsTotal = new Counter({
  name: "pos_platform_calls_total",
  help: "Total outbound calls to platform microservices",
  labelNames: ["service", "status"] as const,
  registers: [registry],
});

export const fraudAlertsTotal = new Counter({
  name: "pos_fraud_alerts_total",
  help: "Total fraud alerts emitted via Socket.IO",
  labelNames: ["severity"] as const,
  registers: [registry],
});

// ── Business-domain counters ──────────────────────────────────────────────────

export const kycSessionsTotal = new Counter({
  name: "pos_kyc_sessions_total",
  help: "Total KYC sessions by outcome",
  labelNames: ["status"] as const, // approved | rejected | pending | expired
  registers: [registry],
});

export const commissionPayoutsTotal = new Counter({
  name: "pos_commission_payouts_total",
  help: "Total commission payout events by status",
  labelNames: ["status"] as const, // pending | approved | paid | rejected
  registers: [registry],
});

export const loyaltyRedemptionsTotal = new Counter({
  name: "pos_loyalty_redemptions_total",
  help: "Total loyalty reward redemption attempts",
  labelNames: ["status"] as const, // success | failed | insufficient_points
  registers: [registry],
});

export const webhookDeliveriesTotal = new Counter({
  name: "pos_webhook_deliveries_total",
  help: "Total outbound webhook delivery attempts",
  labelNames: ["event", "status"] as const, // status: success | failed | retrying
  registers: [registry],
});

export const agentOnboardingTotal = new Counter({
  name: "pos_agent_onboarding_total",
  help: "Agent onboarding wizard step transitions",
  labelNames: ["step", "status"] as const, // step: profile|kyc|float|terminal|training
  registers: [registry],
});

export const referralConversionsTotal = new Counter({
  name: "pos_referral_conversions_total",
  help: "Referral program conversions (referred agent activated)",
  labelNames: ["tier"] as const, // bronze | silver | gold | platinum
  registers: [registry],
});

export const settlementReconciliationTotal = new Counter({
  name: "pos_settlement_reconciliation_total",
  help: "Settlement reconciliation run outcomes",
  labelNames: ["outcome"] as const, // matched | discrepancy | error
  registers: [registry],
});

export const cbnReportsTotal = new Counter({
  name: "pos_cbn_reports_total",
  help: "CBN regulatory report submissions",
  labelNames: ["type"] as const, // sar | ctr | daily_summary
  registers: [registry],
});

// ── Gauges ────────────────────────────────────────────────────────────────────

export const activeAgentsGauge = new Gauge({
  name: "pos_active_agents",
  help: "Number of agents currently active (online in last 15 min)",
  registers: [registry],
});

export const premiumReserveTotalGauge = new Gauge({
  name: "pos_float_balance_total_ngn",
  help: "Total premium reserve across all active agents in NGN",
  registers: [registry],
});

export const pendingDisputesGauge = new Gauge({
  name: "pos_pending_disputes",
  help: "Number of disputes currently in pending/reviewing state",
  registers: [registry],
});

export const kafkaConsumerLagGauge = new Gauge({
  name: "pos_kafka_consumer_lag",
  help: "Kafka consumer group lag per topic-partition",
  labelNames: ["topic", "partition"] as const,
  registers: [registry],
});

// ── Histograms ────────────────────────────────────────────────────────────────

export const transactionDurationMs = new Histogram({
  name: "pos_transaction_duration_ms",
  help: "End-to-end transaction processing time in milliseconds",
  labelNames: ["type"] as const,
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [registry],
});

export const platformCallDurationMs = new Histogram({
  name: "pos_platform_call_duration_ms",
  help: "Round-trip latency to platform microservices in milliseconds",
  labelNames: ["service"] as const,
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [registry],
});

export const httpRequestDurationMs = new Histogram({
  name: "pos_http_request_duration_ms",
  help: "Express HTTP request duration in milliseconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500],
  registers: [registry],
});
