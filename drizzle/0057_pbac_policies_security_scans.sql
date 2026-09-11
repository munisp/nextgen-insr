-- B1 + B2 (zero-undelivered-scope, Wave 2a): PBAC policy store / access
-- evaluation log + security scanner run/finding store — additive only.
--
-- Backs:
--   securityAudit.getPolicies / syncPbacPolicies / evaluateAccess (B1)
--   securityAudit.runSecurityScan / getSecurityScanHistory /
--   getSecurityScanFindings (B2)
--
-- pbac_policies rows are seeded from the REAL in-repo Permify schema
-- (infra/permify/schema.perm, version 3.0.0) via
-- server/lib/pbacPolicies.ts syncPoliciesFromSchema — never invented.
-- security_scan_runs/security_scan_findings rows are written ONLY by real
-- scanner executions (server/lib/securityScanner.ts — trivy/semgrep);
-- nothing here fabricates findings.
--
-- IF NOT EXISTS guards keep this re-runnable; the drizzle journal
-- intentionally stays stale per repo pattern (schema is pushed via
-- drizzle-kit push in test/CI environments).
CREATE TABLE IF NOT EXISTS "pbac_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "entity" varchar(128) NOT NULL,
  "permission" varchar(128) NOT NULL,
  "name" varchar(256) NOT NULL,
  "description" text NOT NULL,
  -- Permify DSL expression exactly as declared in the schema file
  -- (e.g. 'tenant.super_admin or tenant.admin or policyholder_user').
  "expression" text NOT NULL,
  "permifySchemaVersion" varchar(64) NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pbac_policies_entity_permission_uidx" ON "pbac_policies" ("entity", "permission");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pbac_access_evaluations" (
  "id" serial PRIMARY KEY NOT NULL,
  "subjectType" varchar(128) NOT NULL,
  "subjectId" varchar(256) NOT NULL,
  "entityType" varchar(128) NOT NULL,
  "entityId" varchar(256) NOT NULL,
  "permission" varchar(128) NOT NULL,
  "allowed" boolean NOT NULL,
  -- 'permify' = real Permify answer; 'permify_fail_open' = Permify
  -- unreachable and PERMIFY_FAIL_OPEN=true (insecure opt-in) allowed it.
  "source" varchar(32) NOT NULL,
  "evaluatedBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pbac_access_evaluations_created_idx" ON "pbac_access_evaluations" ("createdAt");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "security_scan_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  -- Real scanner identity, e.g. 'trivy' / 'semgrep', and its --version output.
  "scanner" varchar(32) NOT NULL,
  "scannerVersion" varchar(128) NOT NULL,
  "targetPath" text NOT NULL,
  "startedAt" timestamp NOT NULL,
  "finishedAt" timestamp,
  -- 'running' | 'completed' | 'failed' — a run row is written before
  -- execution and closed with the real outcome; a failed run keeps the
  -- scanner's error tail.
  "status" varchar(32) NOT NULL,
  "totalFindings" integer,
  "severityCounts" json,
  "error" text,
  "triggeredBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "security_scan_runs_started_idx" ON "security_scan_runs" ("startedAt");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "security_scan_findings" (
  "id" serial PRIMARY KEY NOT NULL,
  "runId" integer NOT NULL REFERENCES "security_scan_runs" ("id"),
  -- Scanner-native identifier (CVE ID / semgrep rule id / misconfig check id).
  "ruleId" varchar(256) NOT NULL,
  "title" text NOT NULL,
  -- Normalised severity exactly as reported: CRITICAL/HIGH/MEDIUM/LOW/UNKNOWN.
  "severity" varchar(16) NOT NULL,
  -- Scanner-native finding class: 'vulnerability' | 'secret' | 'misconfig' | 'code'.
  "findingType" varchar(32) NOT NULL,
  "target" text NOT NULL,
  "packageName" varchar(256),
  "installedVersion" varchar(128),
  "fixedVersion" varchar(128),
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "security_scan_findings_run_idx" ON "security_scan_findings" ("runId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "security_scan_findings_severity_idx" ON "security_scan_findings" ("severity");
