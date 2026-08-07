-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0045: Journey Execution Tracking
-- Tracks every Temporal journey execution for history, audit, and analytics
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS journey_executions (
    id                  SERIAL PRIMARY KEY,
    journey_id          TEXT NOT NULL,                          -- J01..J20
    journey_name        TEXT NOT NULL,
    workflow_id         TEXT NOT NULL UNIQUE,                   -- Temporal workflow ID
    run_id              TEXT,                                   -- Temporal run ID
    triggered_by        INTEGER REFERENCES users(id),          -- User who triggered
    input_snapshot      JSONB,                                  -- Input parameters (PII-scrubbed)
    status              TEXT NOT NULL DEFAULT 'running'         -- running|completed|failed|cancelled|timed_out
                            CHECK (status IN ('running','completed','failed','cancelled','timed_out')),
    current_step        TEXT DEFAULT 'initializing',
    result_snapshot     JSONB,                                  -- Output (non-sensitive fields only)
    error_message       TEXT,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    duration_ms         INTEGER,                                -- Computed on completion
    idempotency_key     TEXT UNIQUE,                            -- Prevents duplicate triggers
    scheduled           BOOLEAN NOT NULL DEFAULT FALSE,         -- Was this a scheduled run?
    schedule_id         TEXT,                                   -- Temporal schedule ID if scheduled
    metadata            JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_je_journey_id ON journey_executions (journey_id);
CREATE INDEX IF NOT EXISTS idx_je_status ON journey_executions (status);
CREATE INDEX IF NOT EXISTS idx_je_triggered_by ON journey_executions (triggered_by);
CREATE INDEX IF NOT EXISTS idx_je_started_at ON journey_executions (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_je_workflow_id ON journey_executions (workflow_id);
CREATE INDEX IF NOT EXISTS idx_je_idempotency ON journey_executions (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_je_scheduled ON journey_executions (scheduled, started_at DESC);

-- Journey step events for granular tracking
CREATE TABLE IF NOT EXISTS journey_step_events (
    id              SERIAL PRIMARY KEY,
    execution_id    INTEGER NOT NULL REFERENCES journey_executions(id) ON DELETE CASCADE,
    step_name       TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('started','completed','failed','compensated')),
    service         TEXT,                                       -- Which service was called
    duration_ms     INTEGER,
    error_message   TEXT,
    metadata        JSONB DEFAULT '{}'::jsonb,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jse_execution_id ON journey_step_events (execution_id);
CREATE INDEX IF NOT EXISTS idx_jse_step_name ON journey_step_events (step_name);
CREATE INDEX IF NOT EXISTS idx_jse_recorded_at ON journey_step_events (recorded_at DESC);

-- Journey schedules (for recurring journeys like EOD reconciliation, IFRS17)
CREATE TABLE IF NOT EXISTS journey_schedules (
    id              SERIAL PRIMARY KEY,
    journey_id      TEXT NOT NULL,
    schedule_id     TEXT NOT NULL UNIQUE,                       -- Temporal schedule ID
    cron_expression TEXT,                                       -- e.g. "0 22 * * *" for EOD
    interval_ms     INTEGER,                                    -- Alternative: interval in ms
    input_template  JSONB NOT NULL,                             -- Parameterised input template
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      INTEGER REFERENCES users(id),
    last_run_at     TIMESTAMPTZ,
    next_run_at     TIMESTAMPTZ,
    run_count       INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_js_journey_id ON journey_schedules (journey_id);
CREATE INDEX IF NOT EXISTS idx_js_enabled ON journey_schedules (enabled, next_run_at);
