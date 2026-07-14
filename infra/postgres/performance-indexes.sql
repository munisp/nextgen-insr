-- ═══════════════════════════════════════════════════════════════════════════════
-- InsurePortal Insurance Platform — Performance Index Migration
-- Comprehensive B-tree, partial, composite, and covering indexes for all 71 tables.
-- Run after initial schema creation via: psql -f performance-indexes.sql
-- ═══════════════════════════════════════════════════════════════════════════════

-- Enable extensions for advanced indexing
CREATE EXTENSION IF NOT EXISTS pg_trgm;       -- Trigram indexes for LIKE/ILIKE
CREATE EXTENSION IF NOT EXISTS btree_gin;     -- GIN for multi-type columns

-- ─── Transactions (highest query volume) ────────────────────────────────────

-- Covering index for agent transaction list (avoids heap lookup)
CREATE INDEX CONCURRENTLY IF NOT EXISTS tx_agent_created_covering_idx
  ON transactions (
    "agentId", "createdAt" DESC
  ) INCLUDE ("ref", "type", "amount", "status", "currency", "customerName");

-- Partial index for pending transactions (hot path for settlement)
CREATE INDEX CONCURRENTLY IF NOT EXISTS tx_pending_idx
  ON transactions ("createdAt" DESC)
  WHERE status = 'pending';

-- Partial index for failed transactions (fraud analysis)
CREATE INDEX CONCURRENTLY IF NOT EXISTS tx_failed_idx
  ON transactions ("agentId", "createdAt" DESC)
  WHERE status = 'failed';

-- Currency + date for multi-currency reporting
CREATE INDEX CONCURRENTLY IF NOT EXISTS tx_currency_created_idx
  ON transactions ("currency", "createdAt" DESC);

-- Amount range queries for CBN threshold monitoring
CREATE INDEX CONCURRENTLY IF NOT EXISTS tx_amount_idx
  ON transactions ("amount");

-- Customer phone for lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS tx_customer_phone_idx
  ON transactions ("customerPhone")
  WHERE "customerPhone" IS NOT NULL;

-- Fraud score for high-risk transaction filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS tx_fraud_score_idx
  ON transactions ("fraudScore" DESC)
  WHERE "fraudScore" IS NOT NULL AND CAST("fraudScore" AS numeric) > 0;

-- ─── Fraud Alerts ───────────────────────────────────────────────────────────

-- Open fraud alerts (dashboard hot path)
CREATE INDEX CONCURRENTLY IF NOT EXISTS fraud_open_severity_idx
  ON fraud_alerts ("severity", "createdAt" DESC)
  WHERE status = 'open';

-- Transaction correlation
CREATE INDEX CONCURRENTLY IF NOT EXISTS fraud_transaction_idx
  ON fraud_alerts ("transactionId")
  WHERE "transactionId" IS NOT NULL;

-- Assigned-to for case management
CREATE INDEX CONCURRENTLY IF NOT EXISTS fraud_assigned_idx
  ON fraud_alerts ("assignedTo", "status")
  WHERE "assignedTo" IS NOT NULL;

-- ─── Audit Log ──────────────────────────────────────────────────────────────

-- Actor + timestamp for user activity trails
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_actor_created_idx
  ON audit_log ("actor", "createdAt" DESC);

-- Action type for compliance queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_action_created_idx
  ON audit_log ("action", "createdAt" DESC);

-- Resource type for entity-specific audit trails
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_resource_idx
  ON audit_log ("resourceType", "resourceId");

-- Trigram index for full-text search on audit descriptions
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_description_trgm_idx
  ON audit_log USING gin ("description" gin_trgm_ops)
  WHERE "description" IS NOT NULL;

-- ─── Agents ─────────────────────────────────────────────────────────────────

-- Active agents by tier (leaderboard, reporting)
CREATE INDEX CONCURRENTLY IF NOT EXISTS agents_active_tier_idx
  ON agents ("tier", "loyaltyPoints" DESC)
  WHERE "isActive" = true AND "deletedAt" IS NULL;

-- Phone lookup (unique constraint candidate)
CREATE INDEX CONCURRENTLY IF NOT EXISTS agents_phone_idx
  ON agents ("phone");

-- Credit score for lending decisions
CREATE INDEX CONCURRENTLY IF NOT EXISTS agents_credit_score_idx
  ON agents ("creditScore" DESC)
  WHERE "creditScore" > 0;

-- Float balance for settlement processing
CREATE INDEX CONCURRENTLY IF NOT EXISTS agents_float_balance_idx
  ON agents ("floatBalance" DESC)
  WHERE "isActive" = true;

-- ─── Loyalty History ────────────────────────────────────────────────────────

-- Agent + date for history pagination
CREATE INDEX CONCURRENTLY IF NOT EXISTS loyalty_agent_created_idx
  ON loyalty_history ("agentId", "createdAt" DESC);

-- Type aggregation for analytics
CREATE INDEX CONCURRENTLY IF NOT EXISTS loyalty_type_created_idx
  ON loyalty_history ("type", "createdAt" DESC);

-- ─── Chat Sessions & Messages ───────────────────────────────────────────────

-- Open sessions for support queue
CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_open_created_idx
  ON chat_sessions ("createdAt" DESC)
  WHERE status = 'open';

-- Messages by session (conversation thread)
CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_msg_session_created_idx
  ON chat_messages ("sessionId", "createdAt");

-- ─── Devices (MDM) ─────────────────────────────────────────────────────────

-- Active devices for fleet management
CREATE INDEX CONCURRENTLY IF NOT EXISTS devices_active_heartbeat_idx
  ON devices ("lastHeartbeat" DESC)
  WHERE status = 'active';

-- Agent-device mapping
CREATE INDEX CONCURRENTLY IF NOT EXISTS devices_agent_idx
  ON devices ("agentId")
  WHERE "agentId" IS NOT NULL;

-- ─── KYC Sessions ───────────────────────────────────────────────────────────

-- Pending KYC for review queue
CREATE INDEX CONCURRENTLY IF NOT EXISTS kyc_pending_created_idx
  ON kyc_sessions ("createdAt" DESC)
  WHERE status = 'pending';

-- Document type for compliance reporting
CREATE INDEX CONCURRENTLY IF NOT EXISTS kyc_doctype_status_idx
  ON kyc_sessions ("documentType", "status");

-- ─── Settlement Reconciliation ──────────────────────────────────────────────

-- Period lookups for daily settlement
CREATE INDEX CONCURRENTLY IF NOT EXISTS settlement_period_agent_idx
  ON settlement_reconciliation ("period", "agentId");

-- Discrepancy flagging
CREATE INDEX CONCURRENTLY IF NOT EXISTS settlement_discrepancy_idx
  ON settlement_reconciliation ("discrepancyAmount")
  WHERE CAST("discrepancyAmount" AS numeric) != 0;

-- ─── Commission Payouts ─────────────────────────────────────────────────────

-- Agent payout history
CREATE INDEX CONCURRENTLY IF NOT EXISTS commission_agent_status_idx
  ON commission_payouts ("agentId", "status", "createdAt" DESC);

-- Pending payouts for processing
CREATE INDEX CONCURRENTLY IF NOT EXISTS commission_pending_idx
  ON commission_payouts ("createdAt" DESC)
  WHERE status = 'pending';

-- ─── Webhook Deliveries ─────────────────────────────────────────────────────

-- Failed deliveries for retry queue
CREATE INDEX CONCURRENTLY IF NOT EXISTS webhook_delivery_failed_idx
  ON webhook_deliveries ("nextRetryAt")
  WHERE status = 'failed' AND "nextRetryAt" IS NOT NULL;

-- Endpoint + event for delivery log
CREATE INDEX CONCURRENTLY IF NOT EXISTS webhook_delivery_endpoint_idx
  ON webhook_deliveries ("endpointId", "createdAt" DESC);

-- ─── Referrals ──────────────────────────────────────────────────────────────

-- Referrer leaderboard
CREATE INDEX CONCURRENTLY IF NOT EXISTS referral_referrer_idx
  ON referrals ("referrerId", "createdAt" DESC);

-- ─── Disputes ───────────────────────────────────────────────────────────────

-- Open disputes for resolution queue
CREATE INDEX CONCURRENTLY IF NOT EXISTS dispute_open_created_idx
  ON disputes ("createdAt" DESC)
  WHERE status = 'open';

-- ─── Reversal Requests ──────────────────────────────────────────────────────

-- Pending reversals for approval queue
CREATE INDEX CONCURRENTLY IF NOT EXISTS reversal_pending_idx
  ON reversal_requests ("createdAt" DESC)
  WHERE status = 'pending';

-- ─── Float Top-Up Requests ──────────────────────────────────────────────────

-- Pending top-ups for approval
CREATE INDEX CONCURRENTLY IF NOT EXISTS float_topup_pending_idx
  ON float_topup_requests ("createdAt" DESC)
  WHERE status = 'pending';

-- Agent float request history
CREATE INDEX CONCURRENTLY IF NOT EXISTS float_topup_agent_idx
  ON float_topup_requests ("agentId", "createdAt" DESC);

-- ─── Email Queue ────────────────────────────────────────────────────────────

-- Queued emails for processing
CREATE INDEX CONCURRENTLY IF NOT EXISTS email_queued_idx
  ON email_queue ("createdAt")
  WHERE status = 'queued';

-- ─── ERP Sync Log ───────────────────────────────────────────────────────────

-- Pending retries for sync worker
CREATE INDEX CONCURRENTLY IF NOT EXISTS erp_pending_retry_idx
  ON erp_sync_log ("nextRetryAt")
  WHERE status = 'pending' AND "retryCount" < "maxRetries";

-- ─── OTP Tokens ─────────────────────────────────────────────────────────────

-- Active OTPs for verification
CREATE INDEX CONCURRENTLY IF NOT EXISTS otp_phone_active_idx
  ON otp_tokens ("phone", "expiresAt" DESC)
  WHERE "usedAt" IS NULL;

-- ─── DLQ Messages ───────────────────────────────────────────────────────────

-- Unprocessed DLQ for retry
CREATE INDEX CONCURRENTLY IF NOT EXISTS dlq_unprocessed_idx
  ON dlq_messages ("createdAt")
  WHERE status = 'pending';

-- ─── API Key Usage ──────────────────────────────────────────────────────────

-- Usage analytics per key
CREATE INDEX CONCURRENTLY IF NOT EXISTS api_usage_key_time_idx
  ON api_key_usage ("apiKeyId", "createdAt" DESC);

-- ─── Device Locations ───────────────────────────────────────────────────────

-- Latest location per device
CREATE INDEX CONCURRENTLY IF NOT EXISTS device_loc_latest_idx
  ON device_locations ("deviceId", "createdAt" DESC);

-- ─── Compliance Reports ────────────────────────────────────────────────────

-- Period-based compliance lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS compliance_period_type_idx
  ON compliance_reports ("period", "reportType");

-- ─── Geofence Zones ────────────────────────────────────────────────────────

-- Active zones for real-time checking
CREATE INDEX CONCURRENTLY IF NOT EXISTS geofence_active_idx
  ON geofence_zones ("createdAt")
  WHERE "isActive" = true;

-- ─── Inventory Items ────────────────────────────────────────────────────────

-- Low stock alerts
CREATE INDEX CONCURRENTLY IF NOT EXISTS inventory_low_stock_idx
  ON inventory_items ("quantity")
  WHERE status = 'low_stock' OR status = 'out_of_stock';

-- ─── Customers ──────────────────────────────────────────────────────────────

-- BVN/NIN lookup for KYC
CREATE INDEX CONCURRENTLY IF NOT EXISTS customers_bvn_idx
  ON customers ("bvn")
  WHERE "bvn" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS customers_nin_idx
  ON customers ("nin")
  WHERE "nin" IS NOT NULL;

-- Name search with trigram
CREATE INDEX CONCURRENTLY IF NOT EXISTS customers_name_trgm_idx
  ON customers USING gin ("firstName" gin_trgm_ops);

-- ─── Merchants ──────────────────────────────────────────────────────────────

-- Category + status for directory listing
CREATE INDEX CONCURRENTLY IF NOT EXISTS merchants_category_status_idx
  ON merchants ("category", "status");

-- ─── Analytics Metrics ──────────────────────────────────────────────────────

-- Time-series queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS analytics_bucket_metric_idx
  ON analytics_metrics ("bucketMinute" DESC, "metricName");

-- ─── Connectivity Log ───────────────────────────────────────────────────────

-- Recent connectivity for agent
CREATE INDEX CONCURRENTLY IF NOT EXISTS connectivity_recent_idx
  ON connectivity_log ("recordedAt" DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Table Partitioning (for high-volume tables)
-- NOTE: Requires PostgreSQL 12+. Apply BEFORE data migration.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Example: Range-partition transactions by month
-- CREATE TABLE transactions_partitioned (LIKE transactions INCLUDING ALL)
--   PARTITION BY RANGE ("createdAt");
--
-- CREATE TABLE transactions_2026_01 PARTITION OF transactions_partitioned
--   FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
-- CREATE TABLE transactions_2026_02 PARTITION OF transactions_partitioned
--   FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
-- ... (generate monthly partitions via cron or pg_partman)

-- ═══════════════════════════════════════════════════════════════════════════════
-- Materialized Views for Dashboard Analytics
-- ═══════════════════════════════════════════════════════════════════════════════

-- Daily transaction summary per agent
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_agent_summary AS
SELECT
  "agentId",
  DATE_TRUNC('day', "createdAt") AS day,
  COUNT(*) AS tx_count,
  SUM(CAST("amount" AS numeric)) AS total_volume,
  SUM(CAST("commission" AS numeric)) AS total_commission,
  SUM(CAST("fee" AS numeric)) AS total_fees,
  COUNT(*) FILTER (WHERE status = 'success') AS success_count,
  COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
  AVG(CAST("fraudScore" AS numeric)) AS avg_fraud_score
FROM transactions
WHERE "deletedAt" IS NULL
GROUP BY "agentId", DATE_TRUNC('day', "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS mv_daily_agent_summary_idx
  ON mv_daily_agent_summary ("agentId", day);

-- Hourly platform KPIs
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_hourly_platform_kpis AS
SELECT
  DATE_TRUNC('hour', "createdAt") AS hour,
  COUNT(*) AS tx_count,
  SUM(CAST("amount" AS numeric)) AS total_volume,
  COUNT(DISTINCT "agentId") AS active_agents,
  COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
  AVG(CAST("fraudScore" AS numeric)) AS avg_fraud_score
FROM transactions
WHERE "deletedAt" IS NULL
GROUP BY DATE_TRUNC('hour', "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS mv_hourly_kpis_idx
  ON mv_hourly_platform_kpis (hour);

-- Agent leaderboard (refreshed every 15 minutes)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_agent_leaderboard AS
SELECT
  a.id AS agent_id,
  a."agentCode",
  a.name,
  a.tier,
  a."loyaltyPoints",
  a.streak,
  COALESCE(t.tx_count, 0) AS monthly_tx_count,
  COALESCE(t.total_volume, 0) AS monthly_volume,
  COALESCE(t.total_commission, 0) AS monthly_commission
FROM agents a
LEFT JOIN (
  SELECT
    "agentId",
    COUNT(*) AS tx_count,
    SUM(CAST("amount" AS numeric)) AS total_volume,
    SUM(CAST("commission" AS numeric)) AS total_commission
  FROM transactions
  WHERE "createdAt" >= DATE_TRUNC('month', CURRENT_DATE)
    AND "deletedAt" IS NULL
    AND status = 'success'
  GROUP BY "agentId"
) t ON a.id = t."agentId"
WHERE a."isActive" = true AND a."deletedAt" IS NULL
ORDER BY a."loyaltyPoints" DESC;

CREATE UNIQUE INDEX IF NOT EXISTS mv_agent_leaderboard_idx
  ON mv_agent_leaderboard (agent_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Refresh schedule (run via pg_cron or application cron)
-- ═══════════════════════════════════════════════════════════════════════════════
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_agent_summary;   -- every 1 hour
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hourly_platform_kpis;  -- every 15 min
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_agent_leaderboard;     -- every 15 min
