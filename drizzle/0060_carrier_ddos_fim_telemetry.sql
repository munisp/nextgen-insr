-- Zero-undelivered-scope Wave 2d (B14 / B6 / B4) — additive only.
--
-- B6: DDoS self-telemetry. server/lib/ddosTelemetry.ts counts requests per
-- client key per fixed window in-process and persists each finished window
-- into ddos_rate_windows; threshold breaches are appended to
-- ddos_threshold_events at the moment they are observed. Capture is
-- fire-and-forget and can never block or fail a request.
--
-- B4: file-integrity monitoring. server/lib/fileIntegrity.ts records a
-- sha256 baseline of an operator-configured allowlist (system_config key
-- 'fim_monitored_paths') into file_integrity_baseline and diffs later scans
-- against it.
--
-- B14: network carrier telemetry uses the EXISTING sim_probe_log table
-- (real writer: SIM orchestrator daemon -> simOrchestrator.ingestProbe);
-- the only new store is network_alert_resolutions, the durable resolution
-- record for derived carrier alerts.
--
-- IF NOT EXISTS guards keep this re-runnable; the drizzle journal
-- intentionally stays stale per repo pattern (schema is pushed via
-- drizzle-kit push in test/CI environments).
CREATE TABLE IF NOT EXISTS "ddos_rate_windows" (
  "id" serial PRIMARY KEY NOT NULL,
  "window_start" timestamp NOT NULL,
  "window_seconds" integer NOT NULL,
  -- sha256(ip)[:32] — stable per client, no raw IPs at rest.
  "client_key" varchar(64) NOT NULL,
  "request_count" integer NOT NULL,
  "recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drw_window_start_idx" ON "ddos_rate_windows" ("window_start");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drw_client_key_idx" ON "ddos_rate_windows" ("client_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ddos_threshold_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "client_key" varchar(64) NOT NULL,
  "window_start" timestamp NOT NULL,
  "window_seconds" integer NOT NULL,
  "request_count" integer NOT NULL,
  "threshold" integer NOT NULL,
  "detected_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dte_detected_at_idx" ON "ddos_threshold_events" ("detected_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "file_integrity_baseline" (
  "id" serial PRIMARY KEY NOT NULL,
  -- path relative to the server process working directory.
  "path" text NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "file_size" integer NOT NULL,
  "baselined_at" timestamp DEFAULT now() NOT NULL,
  "baselined_by" varchar(128)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fib_path_unique" ON "file_integrity_baseline" ("path");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "network_alert_resolutions" (
  "id" serial PRIMARY KEY NOT NULL,
  -- deterministic alert key produced by networkStatusDashboard.getAlerts.
  "alert_key" varchar(255) NOT NULL,
  "resolution" text,
  "resolved_by" varchar(128),
  "resolved_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nar_alert_key_idx" ON "network_alert_resolutions" ("alert_key");
