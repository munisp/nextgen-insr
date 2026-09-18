-- Wave F2 insurance audit fixes (INS-1/4/5/8/9).
-- 1) policy_lifecycle_states: 1:1 extension of policies carrying grace-period
--    config, lapse/expiry timestamps, arrears ledger, waiting-period reset.
-- 2) claim_appeals: appeal records for the rejected→appealed transition.
-- 3) Partial unique index enforcing claim dedup at the DB layer: one OPEN
--    claim per (policy, incident day, claim type). Fuzzy amount matching is
--    done in application code; rejected/closed claims release the key so a
--    legitimate re-file after rejection is not blocked forever.

CREATE TABLE IF NOT EXISTS "policy_lifecycle_states" (
  "id" serial PRIMARY KEY,
  "policyId" integer NOT NULL,
  "gracePeriodDays" integer DEFAULT 30 NOT NULL,
  "lapsedAt" timestamp,
  "expiredAt" timestamp,
  "reinstatedAt" timestamp,
  "waitingPeriodResetAt" timestamp,
  "arrearsAmount" numeric(18,2) DEFAULT 0 NOT NULL,
  "lastSweptAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pls_policy_idx" ON "policy_lifecycle_states" ("policyId");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "claim_appeals" (
  "id" serial PRIMARY KEY,
  "claimId" integer NOT NULL,
  "appellantId" integer NOT NULL,
  "reason" text NOT NULL,
  "status" varchar(32) DEFAULT 'open' NOT NULL,
  "slaDeadline" timestamp NOT NULL,
  "resolution" text,
  "resolvedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ca_claim_idx" ON "claim_appeals" ("claimId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ca_status_idx" ON "claim_appeals" ("status");
--> statement-breakpoint
-- Dedup: at most one non-terminal claim per (policy, incidentDate, claimType).
CREATE UNIQUE INDEX IF NOT EXISTS "cl_dedup_open_claim_idx"
  ON "claims" ("policyId", "incidentDate", "claimType")
  WHERE status NOT IN ('rejected', 'closed');
