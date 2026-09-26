-- Q4 health & retention wave (2026-09-25): care-app retention layer (Alan
-- model) + claims CX upgrades (Curacel model). Four REAL platform tables.
-- Append-only and idempotent (IF NOT EXISTS); no existing table or column is
-- changed. Table definitions are mirrored in drizzle/schema.ts so
-- `drizzle-kit push` (used by the integration test harness) creates the same
-- objects. sprint46 platform table count: 250 + 4 = 254 (measured).

-- teleconsult_sessions: member teleconsult bookings against the configurable
-- provider adapter (server/lib/teleconsultAdapter.ts). PHI-minimized by
-- design: opaque provider session refs + scheduling metadata + coarse status
-- only — no transcripts, notes or clinical payloads.
CREATE TABLE IF NOT EXISTS "teleconsult_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "memberId" integer NOT NULL,
  "providerCode" varchar(64) NOT NULL,
  "providerSessionRef" varchar(128) NOT NULL,
  "status" varchar(32) DEFAULT 'scheduled' NOT NULL,
  "scheduledAt" timestamp NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "tc_provider_ref_unique"
  ON "teleconsult_sessions" ("providerCode", "providerSessionRef");
CREATE INDEX IF NOT EXISTS "tc_member_created_idx"
  ON "teleconsult_sessions" ("memberId", "createdAt");
CREATE INDEX IF NOT EXISTS "tc_status_idx"
  ON "teleconsult_sessions" ("status");

-- wellness_content: staff-curated retention content; members read a
-- locale-aware paginated feed of published rows only.
CREATE TABLE IF NOT EXISTS "wellness_content" (
  "id" serial PRIMARY KEY NOT NULL,
  "title" varchar(256) NOT NULL,
  "body" text NOT NULL,
  "category" varchar(64) NOT NULL,
  "locale" varchar(16) DEFAULT 'en' NOT NULL,
  "status" varchar(16) DEFAULT 'draft' NOT NULL,
  "publishedAt" timestamp,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "wc_feed_idx"
  ON "wellness_content" ("locale", "category", "publishedAt");
CREATE INDEX IF NOT EXISTS "wc_status_idx"
  ON "wellness_content" ("status");

-- provider_tariffs: Curacel-model negotiated pricing (provider, service) ->
-- price. Provider-portal pre-auth pricing fails closed on this table.
CREATE TABLE IF NOT EXISTS "provider_tariffs" (
  "id" serial PRIMARY KEY NOT NULL,
  "providerCode" varchar(64) NOT NULL,
  "serviceCode" varchar(64) NOT NULL,
  "serviceName" varchar(256),
  "negotiatedPrice" numeric(18,2) NOT NULL,
  "currency" varchar(8) DEFAULT 'NGN' NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "pt_provider_service_unique"
  ON "provider_tariffs" ("providerCode", "serviceCode");
CREATE INDEX IF NOT EXISTS "pt_provider_idx"
  ON "provider_tariffs" ("providerCode");

-- photo_reimbursements: one-tap photo reimbursement. documentRefs are
-- object-storage keys issued by the existing presigned PUT flow
-- (documentManagement.requestUploadUrl, P-wave, migration 0085 era).
-- Adjudication reuses the existing claim_status vocabulary.
CREATE TABLE IF NOT EXISTS "photo_reimbursements" (
  "id" serial PRIMARY KEY NOT NULL,
  "memberId" integer NOT NULL,
  "claimId" integer,
  "documentRefs" json NOT NULL,
  "amount" numeric(18,2) NOT NULL,
  "currency" varchar(8) DEFAULT 'NGN' NOT NULL,
  "description" text,
  "status" varchar(32) DEFAULT 'pending_review' NOT NULL,
  "ocrStatus" varchar(32) DEFAULT 'not_requested' NOT NULL,
  "ocrExtracted" json,
  "reviewedBy" integer,
  "reviewedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "pr_member_idx"
  ON "photo_reimbursements" ("memberId", "createdAt");
CREATE INDEX IF NOT EXISTS "pr_claim_idx"
  ON "photo_reimbursements" ("claimId");
CREATE INDEX IF NOT EXISTS "pr_status_idx"
  ON "photo_reimbursements" ("status");
