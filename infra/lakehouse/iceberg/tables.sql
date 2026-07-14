-- ── InsurePortal Data Lakehouse: Iceberg Table Definitions ─────────────────────────
-- Engine: Apache Spark + Iceberg on MinIO (S3-compatible)
-- Catalog: REST catalog via Nessie or Iceberg REST
-- Namespace: insureportal

-- Bronze layer: raw ingestion (append-only, partitioned by date)
CREATE TABLE IF NOT EXISTS insureportal.bronze.transactions (
  id              BIGINT,
  ref             STRING,
  agent_id        INT,
  type            STRING,
  amount          DECIMAL(15,2),
  fee             DECIMAL(10,2),
  commission      DECIMAL(10,2),
  currency        STRING,
  customer_name   STRING,
  customer_phone  STRING,
  channel         STRING,
  status          STRING,
  fraud_score     DECIMAL(5,2),
  metadata        STRING,  -- JSON blob
  tenant_id       INT,
  created_at      TIMESTAMP,
  ingested_at     TIMESTAMP,
  _source         STRING DEFAULT 'kafka'
)
USING iceberg
PARTITIONED BY (days(created_at), tenant_id)
TBLPROPERTIES (
  'write.format.default' = 'parquet',
  'write.parquet.compression-codec' = 'snappy',
  'history.expire.max-snapshot-age-ms' = '604800000',  -- 7 days
  'read.split.target-size' = '134217728'               -- 128 MB splits
);

CREATE TABLE IF NOT EXISTS insureportal.bronze.fraud_alerts (
  id              BIGINT,
  agent_id        INT,
  transaction_id  INT,
  severity        STRING,
  type            STRING,
  fraud_score     DECIMAL(5,2),
  reason          STRING,
  ai_explanation  STRING,  -- JSON blob
  status          STRING,
  tenant_id       INT,
  created_at      TIMESTAMP,
  ingested_at     TIMESTAMP
)
USING iceberg
PARTITIONED BY (days(created_at), severity)
TBLPROPERTIES (
  'write.format.default' = 'parquet',
  'write.parquet.compression-codec' = 'snappy'
);

CREATE TABLE IF NOT EXISTS insureportal.bronze.mdm_heartbeats (
  device_id       STRING,
  agent_code      STRING,
  terminal_model  STRING,
  battery_level   INT,
  signal_strength INT,
  latitude        DOUBLE,
  longitude       DOUBLE,
  app_version     STRING,
  os_version      STRING,
  is_compliant    BOOLEAN,
  raw_payload     STRING,  -- JSON blob
  tenant_id       INT,
  received_at     TIMESTAMP,
  ingested_at     TIMESTAMP
)
USING iceberg
PARTITIONED BY (hours(received_at), tenant_id)
TBLPROPERTIES (
  'write.format.default' = 'parquet',
  'write.parquet.compression-codec' = 'zstd'
);

-- Silver layer: cleaned, deduplicated, enriched
CREATE TABLE IF NOT EXISTS insureportal.silver.transactions (
  id              BIGINT,
  ref             STRING,
  agent_id        INT,
  agent_code      STRING,
  agent_tier      STRING,
  type            STRING,
  amount          DECIMAL(15,2),
  fee             DECIMAL(10,2),
  commission      DECIMAL(10,2),
  currency        STRING,
  amount_ngn      DECIMAL(15,2),  -- normalized to NGN
  channel         STRING,
  status          STRING,
  fraud_score     DECIMAL(5,2),
  is_fraud        BOOLEAN,
  region          STRING,
  state           STRING,
  tenant_id       INT,
  tx_date         DATE,
  tx_hour         INT,
  created_at      TIMESTAMP,
  processed_at    TIMESTAMP
)
USING iceberg
PARTITIONED BY (tx_date, tenant_id)
TBLPROPERTIES (
  'write.format.default' = 'parquet',
  'write.parquet.compression-codec' = 'snappy',
  'write.merge.mode' = 'merge-on-read'
);

-- Gold layer: aggregated metrics for dashboards
CREATE TABLE IF NOT EXISTS insureportal.gold.daily_agent_summary (
  summary_date    DATE,
  tenant_id       INT,
  agent_id        INT,
  agent_code      STRING,
  agent_tier      STRING,
  tx_count        BIGINT,
  tx_volume       DECIMAL(20,2),
  tx_fees         DECIMAL(15,2),
  tx_commission   DECIMAL(15,2),
  fraud_count     BIGINT,
  fraud_volume    DECIMAL(15,2),
  success_rate    DOUBLE,
  avg_tx_amount   DOUBLE,
  unique_customers BIGINT,
  computed_at     TIMESTAMP
)
USING iceberg
PARTITIONED BY (summary_date, tenant_id)
TBLPROPERTIES (
  'write.format.default' = 'parquet',
  'write.parquet.compression-codec' = 'snappy'
);

CREATE TABLE IF NOT EXISTS insureportal.gold.hourly_transaction_metrics (
  metric_hour     TIMESTAMP,
  tenant_id       INT,
  tx_count        BIGINT,
  tx_volume       DECIMAL(20,2),
  p50_latency_ms  DOUBLE,
  p95_latency_ms  DOUBLE,
  p99_latency_ms  DOUBLE,
  error_rate      DOUBLE,
  fraud_rate      DOUBLE,
  computed_at     TIMESTAMP
)
USING iceberg
PARTITIONED BY (days(metric_hour), tenant_id)
TBLPROPERTIES (
  'write.format.default' = 'parquet',
  'write.parquet.compression-codec' = 'snappy'
);

CREATE TABLE IF NOT EXISTS insureportal.gold.cbn_monthly_summary (
  report_month    STRING,  -- YYYY-MM
  tenant_id       INT,
  total_tx_count  BIGINT,
  total_volume    DECIMAL(20,2),
  cash_in_volume  DECIMAL(20,2),
  cash_out_volume DECIMAL(20,2),
  transfer_volume DECIMAL(20,2),
  active_agents   INT,
  new_agents      INT,
  kyc_verified    INT,
  fraud_cases     INT,
  reversal_count  INT,
  reversal_volume DECIMAL(15,2),
  computed_at     TIMESTAMP
)
USING iceberg
PARTITIONED BY (report_month)
TBLPROPERTIES (
  'write.format.default' = 'parquet',
  'write.parquet.compression-codec' = 'snappy'
);
