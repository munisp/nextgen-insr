-- Migration 0047: Compliance, AML, and Risk Scoring High-Speed Indexes
-- All indexes use CONCURRENTLY to avoid table locks in production
-- Covers: compliance_filings, naicom_reports, fraud_alerts, transactions, kyc_verifications

-- ── compliance_filings ────────────────────────────────────────────────────────

-- Hot path: SAR retry cron — WHERE filing_type='SAR' AND status='pending' ORDER BY created_at
-- This is the most critical index: the retry cron runs every 15 minutes and scans this
CREATE INDEX CONCURRENTLY IF NOT EXISTS cf_filingType_status_createdAt_idx
  ON compliance_filings (filing_type, status, created_at ASC)
  WHERE status IN ('pending', 'flagged');

-- Dashboard: WHERE filing_type IN ('SAR','CTR','AML_SCREENING') AND created_at >= $1
CREATE INDEX CONCURRENTLY IF NOT EXISTS cf_filingType_createdAt_idx
  ON compliance_filings (filing_type, created_at DESC);

-- Deduplication: WHERE reference_number=$1 — must be UNIQUE to prevent duplicate SARs
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS cf_referenceNumber_unique_idx
  ON compliance_filings (reference_number);

-- Flagged count: WHERE status='flagged' AND created_at >= $1
CREATE INDEX CONCURRENTLY IF NOT EXISTS cf_status_createdAt_idx
  ON compliance_filings (status, created_at DESC);

-- Submitted SARs: WHERE filing_type='SAR' AND status='submitted' AND created_at >= $1
CREATE INDEX CONCURRENTLY IF NOT EXISTS cf_filingType_status_submitted_idx
  ON compliance_filings (filing_type, status, created_at DESC)
  WHERE status = 'submitted';

-- Overdue SARs: WHERE filing_type='SAR' AND status='pending' AND created_at <= $1 (24h ago)
-- Partial index on pending only — much smaller than full table scan
CREATE INDEX CONCURRENTLY IF NOT EXISTS cf_pending_sar_createdAt_idx
  ON compliance_filings (created_at ASC)
  WHERE filing_type = 'SAR' AND status = 'pending';

-- ── naicom_reports ────────────────────────────────────────────────────────────

-- Overdue check: WHERE status='pending' AND due_date <= NOW()
CREATE INDEX CONCURRENTLY IF NOT EXISTS nr_status_dueDate_idx
  ON naicom_reports (status, due_date ASC)
  WHERE status IN ('pending', 'submitted');

-- Duplicate prevention: WHERE report_type=$1 AND reporting_period=$1
CREATE INDEX CONCURRENTLY IF NOT EXISTS nr_reportType_period_idx
  ON naicom_reports (report_type, reporting_period);

-- Pending overdue: partial index for fast overdue count
CREATE INDEX CONCURRENTLY IF NOT EXISTS nr_pending_dueDate_idx
  ON naicom_reports (due_date ASC)
  WHERE status = 'pending';

-- ── fraud_alerts ──────────────────────────────────────────────────────────────

-- Transaction lookup: WHERE transaction_id=$1
CREATE INDEX CONCURRENTLY IF NOT EXISTS fraud_transactionId_idx
  ON fraud_alerts (transaction_id);

-- Open alerts: WHERE status='open' ORDER BY created_at DESC
-- Partial index on open alerts only — most queries only care about open alerts
CREATE INDEX CONCURRENTLY IF NOT EXISTS fraud_open_createdAt_idx
  ON fraud_alerts (created_at DESC)
  WHERE status = 'open';

-- High-risk query: WHERE risk_score >= $1 AND created_at >= $2
CREATE INDEX CONCURRENTLY IF NOT EXISTS fraud_riskScore_createdAt_idx
  ON fraud_alerts (risk_score DESC, created_at DESC);

-- Customer fraud history: WHERE customer_id=$1 ORDER BY created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS fraud_customerId_createdAt_idx
  ON fraud_alerts (customer_id, created_at DESC);

-- ── transactions ──────────────────────────────────────────────────────────────

-- NAICOM premium queries: WHERE type='premium' AND created_at BETWEEN $1 AND $2
-- Note: tx_type_createdAt_idx already exists — this is a partial index for premium only
CREATE INDEX CONCURRENTLY IF NOT EXISTS tx_premium_createdAt_idx
  ON transactions (created_at DESC)
  WHERE type = 'premium';

-- AML threshold queries: WHERE amount >= $1 AND created_at BETWEEN $2 AND $3
-- Covers CTR threshold (₦5M) and SAR threshold (₦10M) queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS tx_amount_createdAt_idx
  ON transactions (amount DESC, created_at DESC);

-- Date range scans: WHERE created_at BETWEEN $1 AND $2 (used by NAICOM, AML, lakehouse)
-- Note: tx_status_createdAt_idx exists but doesn't cover date-only queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS tx_createdAt_idx
  ON transactions (created_at DESC);

-- AML velocity: WHERE description LIKE $1 AND created_at >= $2
-- GIN index for full-text search on description (pg_trgm extension required)
-- Falls back gracefully if pg_trgm is not installed
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX CONCURRENTLY IF NOT EXISTS tx_description_trgm_idx ON transactions USING gin (description gin_trgm_ops)';
    RAISE NOTICE 'Created GIN trigram index on transactions.description';
  ELSE
    RAISE NOTICE 'pg_trgm not installed — skipping trigram index. Run: CREATE EXTENSION pg_trgm;';
  END IF;
END $$;

-- ── kyc_verifications ─────────────────────────────────────────────────────────

-- KYC check: WHERE customer_id=$1 AND status='verified'
CREATE INDEX CONCURRENTLY IF NOT EXISTS kyc_customerId_status_idx
  ON kyc_verifications (customer_id, status);

-- Pending KYC queue: WHERE status='pending' ORDER BY created_at
CREATE INDEX CONCURRENTLY IF NOT EXISTS kyc_status_createdAt_idx
  ON kyc_verifications (status, created_at ASC);

-- Latest KYC per customer: WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 1
CREATE INDEX CONCURRENTLY IF NOT EXISTS kyc_customerId_createdAt_idx
  ON kyc_verifications (customer_id, created_at DESC);

-- ── agents (AML velocity query) ───────────────────────────────────────────────

-- Agent status lookup: WHERE status='active' (used in NAICOM report)
CREATE INDEX CONCURRENTLY IF NOT EXISTS agents_status_idx
  ON agents (status)
  WHERE status = 'active';

-- ── policies (NAICOM report) ──────────────────────────────────────────────────

-- Active policy count: WHERE status='active' (used in NAICOM report)
CREATE INDEX CONCURRENTLY IF NOT EXISTS policies_status_idx
  ON policies (status)
  WHERE status = 'active';

-- ── claims (NAICOM report) ────────────────────────────────────────────────────

-- Settled claims: WHERE status='settled' AND created_at BETWEEN $1 AND $2
CREATE INDEX CONCURRENTLY IF NOT EXISTS claims_status_createdAt_idx
  ON claims (status, created_at DESC);

-- Large claims (NAICOM notification threshold ₦10M): WHERE settlement_amount >= $1
CREATE INDEX CONCURRENTLY IF NOT EXISTS claims_settlementAmount_idx
  ON claims (settlement_amount DESC)
  WHERE settlement_amount IS NOT NULL;

-- ── journey_executions (journey monitoring) ───────────────────────────────────

-- Journey status queries: WHERE journey_id=$1 AND status=$2
CREATE INDEX CONCURRENTLY IF NOT EXISTS je_journeyId_status_idx
  ON journey_executions (journey_id, status);

-- Active journeys: WHERE status='running' ORDER BY started_at
CREATE INDEX CONCURRENTLY IF NOT EXISTS je_status_startedAt_idx
  ON journey_executions (status, started_at DESC)
  WHERE status IN ('running', 'pending');

-- Tenant isolation: WHERE tenant_id=$1 AND status=$2
CREATE INDEX CONCURRENTLY IF NOT EXISTS je_tenantId_status_idx
  ON journey_executions (tenant_id, status);

-- ── audit_log (compliance queries) ───────────────────────────────────────────

-- Action-based queries: WHERE action=$1 AND created_at >= $2
CREATE INDEX CONCURRENTLY IF NOT EXISTS al_action_createdAt_idx
  ON audit_log (action, created_at DESC);

-- User audit trail: WHERE user_id=$1 ORDER BY created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS al_userId_createdAt_idx
  ON audit_log (user_id, created_at DESC);

-- Entity audit trail: WHERE entity_type=$1 AND entity_id=$1
CREATE INDEX CONCURRENTLY IF NOT EXISTS al_entityType_entityId_idx
  ON audit_log (entity_type, entity_id);

-- ── ANALYZE to update query planner statistics ────────────────────────────────
ANALYZE compliance_filings;
ANALYZE naicom_reports;
ANALYZE fraud_alerts;
ANALYZE transactions;
ANALYZE kyc_verifications;
ANALYZE agents;
ANALYZE policies;
ANALYZE claims;
ANALYZE audit_log;
