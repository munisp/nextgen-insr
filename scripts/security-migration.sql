-- Security Migration: PII encryption at rest + performance tuning
-- This migration adds pgcrypto for hashing PII fields and adds performance indexes

BEGIN;

-- Enable pgcrypto for encryption functions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Widen BVN/NIN columns to hold SHA-256 hashes (64 hex chars)
ALTER TABLE kyc_profiles ALTER COLUMN bvn TYPE VARCHAR(128);
ALTER TABLE kyc_profiles ALTER COLUMN nin TYPE VARCHAR(128);

-- Hash existing plaintext BVN values in kyc_profiles
UPDATE kyc_profiles 
SET bvn = encode(digest(bvn, 'sha256'), 'hex')
WHERE bvn IS NOT NULL 
  AND LENGTH(bvn) = 11 
  AND bvn ~ '^\d{11}$';

-- Hash existing plaintext NIN values in kyc_profiles
UPDATE kyc_profiles 
SET nin = encode(digest(nin, 'sha256'), 'hex')
WHERE nin IS NOT NULL 
  AND LENGTH(nin) = 11 
  AND nin ~ '^\d{11}$';

-- Add encrypted PII columns for enhanced security
ALTER TABLE kyc_profiles ADD COLUMN IF NOT EXISTS bvn_encrypted BYTEA;
ALTER TABLE kyc_profiles ADD COLUMN IF NOT EXISTS nin_encrypted BYTEA;

-- Add KYC event tracking table
CREATE TABLE IF NOT EXISTS kyc_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  trigger_source VARCHAR(50) NOT NULL,
  previous_status VARCHAR(30),
  new_status VARCHAR(30),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kyc_events_user ON kyc_events (user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_kyc_events_type ON kyc_events (event_type, created_at DESC);

-- Add KYC tier daily limits table (replaces hardcoded values)
CREATE TABLE IF NOT EXISTS kyc_tier_limits (
  id SERIAL PRIMARY KEY,
  tier INTEGER NOT NULL UNIQUE,
  daily_limit NUMERIC(15,2) NOT NULL,
  monthly_limit NUMERIC(15,2),
  max_policy_value NUMERIC(15,2),
  reverification_months INTEGER DEFAULT 12,
  description VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO kyc_tier_limits (tier, daily_limit, monthly_limit, max_policy_value, reverification_months, description) VALUES
  (0, 0, 0, 0, NULL, 'Unverified — no transactions allowed'),
  (1, 300000, 5000000, 1000000, 24, 'Tier 1 — BVN only'),
  (2, 5000000, 50000000, 50000000, 12, 'Tier 2 — BVN + NIN'),
  (3, 999999999, 999999999, 999999999, 12, 'Tier 3 — Full KYC')
ON CONFLICT (tier) DO NOTHING;

-- Add PEP screening results table
CREATE TABLE IF NOT EXISTS pep_screening (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  screening_date TIMESTAMP DEFAULT NOW(),
  is_pep BOOLEAN DEFAULT false,
  pep_category VARCHAR(50),
  source VARCHAR(100),
  risk_level VARCHAR(20) DEFAULT 'standard',
  details JSONB DEFAULT '{}',
  next_screening_date TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pep_screening_user ON pep_screening (user_id, screening_date DESC);

-- Add sanctions screening results table
CREATE TABLE IF NOT EXISTS sanctions_screening (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  screening_date TIMESTAMP DEFAULT NOW(),
  is_sanctioned BOOLEAN DEFAULT false,
  list_source VARCHAR(100),
  match_score NUMERIC(5,4),
  details JSONB DEFAULT '{}',
  next_screening_date TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sanctions_screening_user ON sanctions_screening (user_id, screening_date DESC);

-- Performance indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_policies_status_created ON policies (status, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_claims_status_amount ON claims (status, amount DESC);
CREATE INDEX IF NOT EXISTS idx_claims_policy ON claims ("policyId");
CREATE INDEX IF NOT EXISTS idx_payment_tx_gateway ON payment_transactions (gateway, status);
CREATE INDEX IF NOT EXISTS idx_underwriting_app ON underwriting_decisions ("applicationId");
CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets (user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions (user_id, created_at DESC);

-- Table partitioning preparation for high-volume tables
-- (These would be applied during maintenance window in production)
-- CREATE TABLE claims_partitioned (...) PARTITION BY RANGE ("createdAt");
-- CREATE TABLE audit_trail_partitioned (...) PARTITION BY RANGE ("createdAt");
-- CREATE TABLE payment_transactions_partitioned (...) PARTITION BY RANGE ("createdAt");

-- Enable query performance monitoring
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Connection pooling configuration (comment for reference — applied at PgBouncer/Pgpool level)
-- pool_mode = transaction
-- max_client_conn = 400
-- default_pool_size = 20
-- min_pool_size = 5

ANALYZE;

COMMIT;
