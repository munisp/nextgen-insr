-- B3 (F-11 Class-2): security mitigation tracker — additive only.
-- Backs securityAudit.getMitigations / listMitigations / createMitigation /
-- updateMitigationStatus / getMitigationStats. Status transitions are guarded
-- in the router (invalid transition fails loud); resolvedAt is set on
-- transition INTO 'resolved' and cleared when reopened.
-- IF NOT EXISTS / duplicate_object guards keep this re-runnable; the drizzle
-- journal intentionally stays stale per repo pattern (schema is pushed via
-- drizzle-kit push in test/CI environments).
DO $$ BEGIN
  CREATE TYPE "public"."mitigation_status" AS ENUM('open', 'in_progress', 'resolved', 'accepted_risk');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."mitigation_severity" AS ENUM('critical', 'high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "security_mitigations" (
  "id" serial PRIMARY KEY NOT NULL,
  "title" varchar(200) NOT NULL,
  "description" text NOT NULL,
  "severity" "mitigation_severity" NOT NULL,
  "status" "mitigation_status" DEFAULT 'open' NOT NULL,
  "ownerUserId" integer,
  "linkedFindingRef" varchar(128),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  "resolvedAt" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "security_mitigations_status_idx" ON "security_mitigations" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "security_mitigations_severity_idx" ON "security_mitigations" ("severity");
