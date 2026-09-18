-- AUTH-19: audit trail for admin-impersonation (admin acting on an agent record)
CREATE TABLE IF NOT EXISTS "impersonation_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "adminUserId" integer NOT NULL,
  "adminSub" varchar(128),
  "targetAgentId" integer NOT NULL,
  "action" varchar(128) NOT NULL,
  "path" varchar(256),
  "ipAddress" varchar(64),
  "userAgent" varchar(512),
  "metadata" json,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "impersonation_admin_idx" ON "impersonation_events" ("adminUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "impersonation_target_idx" ON "impersonation_events" ("targetAgentId", "createdAt");
