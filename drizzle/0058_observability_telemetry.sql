-- B8 + B9 (Zero-Undelivered-Scope wave 2): in-repo observability telemetry.
-- Additive only — no drops, no type changes.
--
-- request_metrics: one row per tRPC procedure call, written by the real
-- observability middleware (server/middleware/observabilityMiddleware.ts via
-- server/lib/telemetryStore.ts). Writes are batched and fire-and-forget:
-- they never block or fail the request, and no row is ever fabricated — the
-- systemHealthMonitor.apiLatency procedure reads only rows that actually
-- landed here and fails loud (NO_METRICS_YET) on an empty scope.
CREATE TABLE IF NOT EXISTS request_metrics (
  id SERIAL PRIMARY KEY,
  path VARCHAR(255) NOT NULL,
  procedure_type VARCHAR(16) NOT NULL,
  duration_ms INTEGER NOT NULL,
  success BOOLEAN NOT NULL,
  error_code VARCHAR(64),
  user_id VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rm_path_created_idx ON request_metrics(path, created_at);
CREATE INDEX IF NOT EXISTS rm_created_idx ON request_metrics(created_at);

-- error_events: grouped application-error occurrences captured by the same
-- middleware error path. One row per fingerprint (sha256 of
-- path + message + stack hash); repeats increment count and advance
-- last_seen via a real upsert.
CREATE TABLE IF NOT EXISTS error_events (
  id SERIAL PRIMARY KEY,
  fingerprint VARCHAR(64) NOT NULL UNIQUE,
  message TEXT NOT NULL,
  stack_hash VARCHAR(64),
  path VARCHAR(255) NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  first_seen TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ee_last_seen_idx ON error_events(last_seen);
CREATE INDEX IF NOT EXISTS ee_path_idx ON error_events(path);
