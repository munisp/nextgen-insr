-- InsurePortal Iceberg Table Definitions
-- These tables use Apache Iceberg format (PARQUET + ZSTD) for:
-- 1. Time-travel queries (rollback to any snapshot)
-- 2. ACID guarantees on object storage
-- 3. Schema evolution without rewriting data
-- 4. Partition pruning for fast analytics
--
-- Run against Trino: trino --server localhost:8085 --catalog iceberg --schema insurance

-- Bronze layer: Raw event ingestion
CREATE SCHEMA IF NOT EXISTS iceberg.bronze;

CREATE TABLE IF NOT EXISTS iceberg.bronze.policy_events (
    event_id VARCHAR,
    event_type VARCHAR,
    policy_id VARCHAR,
    customer_id VARCHAR,
    payload VARCHAR,
    source_system VARCHAR,
    ingested_at TIMESTAMP(6) WITH TIME ZONE
)
WITH (
    format = 'PARQUET',
    partitioning = ARRAY['day(ingested_at)', 'event_type']
);

CREATE TABLE IF NOT EXISTS iceberg.bronze.claims_events (
    event_id VARCHAR,
    event_type VARCHAR,
    claim_id VARCHAR,
    policy_id VARCHAR,
    amount DECIMAL(18,2),
    payload VARCHAR,
    source_system VARCHAR,
    ingested_at TIMESTAMP(6) WITH TIME ZONE
)
WITH (
    format = 'PARQUET',
    partitioning = ARRAY['day(ingested_at)', 'event_type']
);

CREATE TABLE IF NOT EXISTS iceberg.bronze.premium_transactions (
    transaction_id VARCHAR,
    policy_id VARCHAR,
    customer_id VARCHAR,
    amount DECIMAL(18,2),
    currency VARCHAR,
    channel VARCHAR,
    status VARCHAR,
    created_at TIMESTAMP(6) WITH TIME ZONE
)
WITH (
    format = 'PARQUET',
    partitioning = ARRAY['month(created_at)', 'channel']
);

-- Silver layer: Cleaned, enriched, deduplicated
CREATE SCHEMA IF NOT EXISTS iceberg.silver;

CREATE TABLE IF NOT EXISTS iceberg.silver.policies (
    policy_id VARCHAR,
    customer_id VARCHAR,
    product_type VARCHAR,
    status VARCHAR,
    sum_assured DECIMAL(18,2),
    premium DECIMAL(18,2),
    start_date DATE,
    end_date DATE,
    underwriting_decision VARCHAR,
    risk_score DECIMAL(5,2),
    agent_id VARCHAR,
    region VARCHAR,
    updated_at TIMESTAMP(6) WITH TIME ZONE
)
WITH (
    format = 'PARQUET',
    partitioning = ARRAY['product_type', 'year(start_date)']
);

CREATE TABLE IF NOT EXISTS iceberg.silver.claims (
    claim_id VARCHAR,
    policy_id VARCHAR,
    customer_id VARCHAR,
    claim_type VARCHAR,
    amount_claimed DECIMAL(18,2),
    amount_paid DECIMAL(18,2),
    status VARCHAR,
    adjudication_score DECIMAL(5,2),
    filed_date DATE,
    settled_date DATE,
    region VARCHAR
)
WITH (
    format = 'PARQUET',
    partitioning = ARRAY['claim_type', 'year(filed_date)']
);

CREATE TABLE IF NOT EXISTS iceberg.silver.customers (
    customer_id VARCHAR,
    name VARCHAR,
    phone_hash VARCHAR,
    bvn_hash VARCHAR,
    email_hash VARCHAR,
    region VARCHAR,
    segment VARCHAR,
    kyc_status VARCHAR,
    risk_score DECIMAL(5,2),
    lifetime_value DECIMAL(18,2),
    first_policy_date DATE,
    updated_at TIMESTAMP(6) WITH TIME ZONE
)
WITH (
    format = 'PARQUET',
    partitioning = ARRAY['segment', 'region']
);

-- Gold layer: Aggregated for reporting (NAICOM, IFRS 17, dashboards)
CREATE SCHEMA IF NOT EXISTS iceberg.gold;

CREATE TABLE IF NOT EXISTS iceberg.gold.naicom_quarterly_returns (
    report_period VARCHAR,
    report_type VARCHAR,
    gross_premium_written DECIMAL(18,2),
    net_premium_earned DECIMAL(18,2),
    claims_incurred DECIMAL(18,2),
    claims_paid DECIMAL(18,2),
    outstanding_claims DECIMAL(18,2),
    loss_ratio DECIMAL(8,4),
    expense_ratio DECIMAL(8,4),
    combined_ratio DECIMAL(8,4),
    solvency_margin DECIMAL(18,2),
    mcr_coverage DECIMAL(8,4),
    generated_at TIMESTAMP(6) WITH TIME ZONE
)
WITH (
    format = 'PARQUET',
    partitioning = ARRAY['report_period']
);

CREATE TABLE IF NOT EXISTS iceberg.gold.ifrs17_csm_rollforward (
    reporting_period VARCHAR,
    group_id VARCHAR,
    measurement_model VARCHAR,
    opening_csm DECIMAL(18,2),
    changes_relating_to_future_service DECIMAL(18,2),
    interest_accretion DECIMAL(18,2),
    fx_impact DECIMAL(18,2),
    release_to_pnl DECIMAL(18,2),
    closing_csm DECIMAL(18,2),
    loss_component DECIMAL(18,2),
    onerous_flag BOOLEAN,
    generated_at TIMESTAMP(6) WITH TIME ZONE
)
WITH (
    format = 'PARQUET',
    partitioning = ARRAY['reporting_period', 'measurement_model']
);

CREATE TABLE IF NOT EXISTS iceberg.gold.agent_performance (
    period VARCHAR,
    agent_id VARCHAR,
    agent_name VARCHAR,
    region VARCHAR,
    tier VARCHAR,
    policies_sold INTEGER,
    premium_collected DECIMAL(18,2),
    commission_earned DECIMAL(18,2),
    claims_assisted INTEGER,
    customer_satisfaction DECIMAL(5,2),
    retention_rate DECIMAL(5,4)
)
WITH (
    format = 'PARQUET',
    partitioning = ARRAY['period', 'region']
);

-- Materialized view: Real-time loss triangles
CREATE TABLE IF NOT EXISTS iceberg.gold.loss_development_triangles (
    origin_year INTEGER,
    development_month INTEGER,
    product_type VARCHAR,
    cumulative_paid DECIMAL(18,2),
    cumulative_incurred DECIMAL(18,2),
    case_reserves DECIMAL(18,2),
    ibnr_estimate DECIMAL(18,2),
    development_factor DECIMAL(8,4)
)
WITH (
    format = 'PARQUET',
    partitioning = ARRAY['product_type', 'origin_year']
);
