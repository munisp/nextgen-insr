-- Sprint 123: SAR Dead-Letter Queue
CREATE TABLE IF NOT EXISTS sar_dead_letter_queue (
  id SERIAL PRIMARY KEY,
  filing_type TEXT NOT NULL DEFAULT 'SAR',
  original_filing_id INTEGER NOT NULL,
  reference_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'dlq',
  error_history JSONB NOT NULL DEFAULT '[]',
  last_error TEXT,
  total_retries INTEGER NOT NULL DEFAULT 0,
  filing_data JSONB,
  routed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  requeued_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS sar_dlq_status_idx ON sar_dead_letter_queue(status, routed_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS sar_dlq_original_filing_idx ON sar_dead_letter_queue(original_filing_id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS sar_dlq_reference_number_idx ON sar_dead_letter_queue(reference_number);

-- Add aml.sar.dlq to Fluvio topics tracking
-- (handled by ensureFluvioTopics() in fluvio.ts)
