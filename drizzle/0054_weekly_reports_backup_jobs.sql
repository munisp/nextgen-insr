-- B7 + B5 (Zero-Undelivered-Scope wave 1): weekly report document engine +
-- backup job catalog. Additive only — no drops, no type changes.
--
-- generated_reports: persisted weekly report documents produced by
-- weeklyReports.generateWeeklyReport. sections_json is the computed section
-- payload from server/lib/weeklyReport.ts, built exclusively from real rows
-- (transactions / premiums / claims / policies / agents). Sections with no
-- data source are recorded with a 'no_data_source' marker, never invented
-- numbers.
CREATE TABLE IF NOT EXISTS generated_reports (
  id SERIAL PRIMARY KEY,
  week_start TIMESTAMP NOT NULL,
  week_end TIMESTAMP NOT NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  generated_by INTEGER,
  sections_json JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'completed'
);

CREATE INDEX IF NOT EXISTS gr_week_start_idx ON generated_reports(week_start);
CREATE INDEX IF NOT EXISTS gr_generated_at_idx ON generated_reports(generated_at);

-- backup_jobs: runtime catalog of backup runs. Rows are recorded by the real
-- backup tooling (scripts/backup/pg_backup.sh via psql against DATABASE_URL,
-- or server/lib/backupCatalog.ts for server-side callers). size_bytes is NULL
-- when the producing tool did not measure it — never defaulted.
CREATE TABLE IF NOT EXISTS backup_jobs (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMP NOT NULL,
  finished_at TIMESTAMP,
  status VARCHAR(32) NOT NULL,
  size_bytes BIGINT,
  location TEXT,
  triggered_by VARCHAR(128) NOT NULL,
  verification_status VARCHAR(32)
);

CREATE INDEX IF NOT EXISTS bj_started_at_idx ON backup_jobs(started_at);
CREATE INDEX IF NOT EXISTS bj_status_idx ON backup_jobs(status);
