-- 0049 W34-D (2026-11-28): actuary engine domain — the 12 Leg-D tables of
-- actuary-design/design.md §5: act_product_lines (22-line registry),
-- act_rate_versions (draft→filing→approved lifecycle + naicomFilingRef),
-- act_rating_tables, act_assumption_sets (naicomFilingReady gate),
-- act_reserve_runs (CL/BF/Mack), act_capital_runs (RBC approx + EC),
-- act_referrals (underwriter queue), act_referral_rules (declarative
-- predicates), act_exposure_limits, act_accumulation_cells (geo grid),
-- act_adequacy_alerts, act_model_registry (artefact registry).
-- Hand-authored transcription of the drizzle definitions in
-- drizzle/schema.ts (W34 actuary section) — matches the W30/W31 migration
-- style: the repo has no drizzle meta journal and drizzle.config.ts points
-- at a nonexistent schema path, so drizzle-kit generate is not the
-- mechanism here (see w34d report for the generate-idempotency check).
-- Idempotent: safe to re-apply. Enums created via DO blocks (drizzle-kit's
-- generate emits plain CREATE TYPE; DO+EXCEPTION keeps re-runs clean).
DO $$ BEGIN CREATE TYPE "act_product_line" AS ENUM ('group_life','whole_life','health','micro','parametric_crop','takaful','motor','fire_property','marine_hull','marine_cargo','oil_gas','agri_multi_peril','livestock','term_life','funeral','annuity','credit_life','hmo_health','engineering_car','bonds_surety','liability','git'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "act_rating_style" AS ENUM ('frequency_severity','burning_cost','mortality_based','exposure_based','parametric'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "act_rate_version_status" AS ENUM ('draft','filing','approved','retired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "act_rating_table_type" AS ENUM ('base','relativity','territory','loading','tax'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "act_assumption_scope" AS ENUM ('pricing','reserving','capital','life'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "act_reserve_method" AS ENUM ('chainladder','bf','mack'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "act_run_status" AS ENUM ('draft','running','completed','approved','failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "act_capital_model" AS ENUM ('naicom_rbc','internal_ec'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "act_model_type" AS ENUM ('freq_glm','sev_glm','mortality','capital','fraud_link'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "act_model_status" AS ENUM ('candidate','approved','retired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "act_referral_action" AS ENUM ('refer','decline'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "act_referral_status" AS ENUM ('open','accepted','declined'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "act_alert_severity" AS ENUM ('amber','red'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "act_product_lines" (
  "id" serial PRIMARY KEY,
  "code" "act_product_line" NOT NULL UNIQUE,
  "name" varchar(128) NOT NULL,
  "ratingStyle" "act_rating_style" NOT NULL,
  "isActive" boolean DEFAULT true NOT NULL,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "actpl_code_idx" ON "act_product_lines" ("code");
CREATE INDEX IF NOT EXISTS "actpl_isActive_idx" ON "act_product_lines" ("isActive");
CREATE INDEX IF NOT EXISTS "actpl_tenantId_idx" ON "act_product_lines" ("tenantId");

CREATE TABLE IF NOT EXISTS "act_rate_versions" (
  "id" serial PRIMARY KEY,
  "productLineId" integer NOT NULL REFERENCES "act_product_lines"("id"),
  "version" varchar(32) NOT NULL,
  "effectiveFrom" timestamp,
  "effectiveTo" timestamp,
  "status" "act_rate_version_status" DEFAULT 'draft' NOT NULL,
  "naicomFilingRef" varchar(128),
  "modelRegistryId" integer,
  "createdBy" integer,
  "approvedBy" integer,
  "approvedAt" timestamp,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "actrv_line_version_idx" ON "act_rate_versions" ("productLineId", "version");
CREATE INDEX IF NOT EXISTS "actrv_status_idx" ON "act_rate_versions" ("status");
CREATE INDEX IF NOT EXISTS "actrv_tenantId_idx" ON "act_rate_versions" ("tenantId");

CREATE TABLE IF NOT EXISTS "act_rating_tables" (
  "id" serial PRIMARY KEY,
  "rateVersionId" integer NOT NULL REFERENCES "act_rate_versions"("id"),
  "tableType" "act_rating_table_type" NOT NULL,
  "payload" jsonb NOT NULL,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "actrt_version_type_idx" ON "act_rating_tables" ("rateVersionId", "tableType");
CREATE INDEX IF NOT EXISTS "actrt_tenantId_idx" ON "act_rating_tables" ("tenantId");

CREATE TABLE IF NOT EXISTS "act_assumption_sets" (
  "id" serial PRIMARY KEY,
  "name" varchar(128) NOT NULL,
  "scope" "act_assumption_scope" NOT NULL,
  "version" varchar(32) NOT NULL,
  "payload" jsonb NOT NULL,
  "naicomFilingReady" boolean DEFAULT false NOT NULL,
  "approvedBy" integer,
  "approvedAt" timestamp,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "actas_name_scope_version_idx" ON "act_assumption_sets" ("name", "scope", "version");
CREATE INDEX IF NOT EXISTS "actas_scope_idx" ON "act_assumption_sets" ("scope");
CREATE INDEX IF NOT EXISTS "actas_tenantId_idx" ON "act_assumption_sets" ("tenantId");

CREATE TABLE IF NOT EXISTS "act_reserve_runs" (
  "id" serial PRIMARY KEY,
  "productLineId" integer NOT NULL REFERENCES "act_product_lines"("id"),
  "asOf" timestamp NOT NULL,
  "method" "act_reserve_method" NOT NULL,
  "ultimateByOrigin" jsonb NOT NULL,
  "ibnr" numeric(18,2) NOT NULL,
  "mackSe" jsonb,
  "assumptionSetId" integer REFERENCES "act_assumption_sets"("id"),
  "status" "act_run_status" DEFAULT 'draft' NOT NULL,
  "approvedBy" integer,
  "approvedAt" timestamp,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "actrr_line_asof_idx" ON "act_reserve_runs" ("productLineId", "asOf");
CREATE INDEX IF NOT EXISTS "actrr_status_idx" ON "act_reserve_runs" ("status");
CREATE INDEX IF NOT EXISTS "actrr_tenantId_idx" ON "act_reserve_runs" ("tenantId");

CREATE TABLE IF NOT EXISTS "act_capital_runs" (
  "id" serial PRIMARY KEY,
  "asOf" timestamp NOT NULL,
  "model" "act_capital_model" NOT NULL,
  "var995" numeric(18,2),
  "tvar99" numeric(18,2),
  "rbcRequired" numeric(18,2),
  "rbcAvailable" numeric(18,2),
  "perLine" jsonb,
  "riStructureId" integer,
  "assumptionSetId" integer REFERENCES "act_assumption_sets"("id"),
  "status" "act_run_status" DEFAULT 'draft' NOT NULL,
  "approvedBy" integer,
  "approvedAt" timestamp,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "actcr_asof_idx" ON "act_capital_runs" ("asOf");
CREATE INDEX IF NOT EXISTS "actcr_status_idx" ON "act_capital_runs" ("status");
CREATE INDEX IF NOT EXISTS "actcr_tenantId_idx" ON "act_capital_runs" ("tenantId");

CREATE TABLE IF NOT EXISTS "act_referrals" (
  "id" serial PRIMARY KEY,
  "quoteRef" varchar(64) NOT NULL UNIQUE,
  "productLineId" integer NOT NULL REFERENCES "act_product_lines"("id"),
  "reasonCodes" text[] NOT NULL,
  "status" "act_referral_status" DEFAULT 'open' NOT NULL,
  "underwriterId" integer,
  "decidedAt" timestamp,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "actref_quoteRef_idx" ON "act_referrals" ("quoteRef");
CREATE INDEX IF NOT EXISTS "actref_status_idx" ON "act_referrals" ("status");
CREATE INDEX IF NOT EXISTS "actref_line_idx" ON "act_referrals" ("productLineId");
CREATE INDEX IF NOT EXISTS "actref_tenantId_idx" ON "act_referrals" ("tenantId");

CREATE TABLE IF NOT EXISTS "act_referral_rules" (
  "id" serial PRIMARY KEY,
  "productLineId" integer NOT NULL REFERENCES "act_product_lines"("id"),
  "predicate" jsonb NOT NULL,
  "action" "act_referral_action" NOT NULL,
  "reasonCode" varchar(64) NOT NULL,
  "priority" integer DEFAULT 100 NOT NULL,
  "isActive" boolean DEFAULT true NOT NULL,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "actrrl_line_priority_idx" ON "act_referral_rules" ("productLineId", "priority");
CREATE INDEX IF NOT EXISTS "actrrl_isActive_idx" ON "act_referral_rules" ("isActive");
CREATE INDEX IF NOT EXISTS "actrrl_tenantId_idx" ON "act_referral_rules" ("tenantId");

CREATE TABLE IF NOT EXISTS "act_exposure_limits" (
  "id" serial PRIMARY KEY,
  "productLineId" integer NOT NULL UNIQUE REFERENCES "act_product_lines"("id"),
  "maxSumInsured" numeric(18,2),
  "maxPremium" numeric(18,2),
  "maxAggregateExposure" numeric(18,2),
  "geoAccumulationLimit" jsonb,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "actel_line_idx" ON "act_exposure_limits" ("productLineId");
CREATE INDEX IF NOT EXISTS "actel_tenantId_idx" ON "act_exposure_limits" ("tenantId");

CREATE TABLE IF NOT EXISTS "act_accumulation_cells" (
  "id" serial PRIMARY KEY,
  "productLineId" integer NOT NULL REFERENCES "act_product_lines"("id"),
  "geoCell" varchar(64) NOT NULL,
  "aggregateExposure" numeric(18,2) DEFAULT '0.00' NOT NULL,
  "policyCount" integer DEFAULT 0 NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  "tenantId" integer
);
CREATE UNIQUE INDEX IF NOT EXISTS "actac_line_cell_idx" ON "act_accumulation_cells" ("productLineId", "geoCell");
CREATE INDEX IF NOT EXISTS "actac_tenantId_idx" ON "act_accumulation_cells" ("tenantId");

CREATE TABLE IF NOT EXISTS "act_adequacy_alerts" (
  "id" serial PRIMARY KEY,
  "productLineId" integer NOT NULL REFERENCES "act_product_lines"("id"),
  "period" varchar(7) NOT NULL,
  "pricedLossRatio" numeric(18,4) NOT NULL,
  "actualLossRatio" numeric(18,4) NOT NULL,
  "severity" "act_alert_severity" NOT NULL,
  "acknowledgedBy" integer,
  "acknowledgedAt" timestamp,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "actaa_line_period_idx" ON "act_adequacy_alerts" ("productLineId", "period");
CREATE INDEX IF NOT EXISTS "actaa_severity_idx" ON "act_adequacy_alerts" ("severity");
CREATE INDEX IF NOT EXISTS "actaa_tenantId_idx" ON "act_adequacy_alerts" ("tenantId");

CREATE TABLE IF NOT EXISTS "act_model_registry" (
  "id" serial PRIMARY KEY,
  "modelType" "act_model_type" NOT NULL,
  "version" varchar(32) NOT NULL,
  "artefactUri" varchar(512) NOT NULL,
  "metrics" jsonb,
  "trainedAt" timestamp,
  "status" "act_model_status" DEFAULT 'candidate' NOT NULL,
  "approvedBy" integer,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "actmr_type_version_idx" ON "act_model_registry" ("modelType", "version");
CREATE INDEX IF NOT EXISTS "actmr_status_idx" ON "act_model_registry" ("status");
CREATE INDEX IF NOT EXISTS "actmr_tenantId_idx" ON "act_model_registry" ("tenantId");

-- Rollback (manual, mirrors MIGRATION_ROLLBACK.md conventions; this file is
-- apply-only like 0047/0048):
--   DROP TABLE IF EXISTS "act_model_registry", "act_adequacy_alerts",
--     "act_accumulation_cells", "act_exposure_limits", "act_referral_rules",
--     "act_referrals", "act_capital_runs", "act_reserve_runs",
--     "act_assumption_sets", "act_rating_tables", "act_rate_versions",
--     "act_product_lines" CASCADE;
--   DROP TYPE IF EXISTS "act_alert_severity", "act_referral_status",
--     "act_referral_action", "act_model_status", "act_model_type",
--     "act_capital_model", "act_run_status", "act_reserve_method",
--     "act_assumption_scope", "act_rating_table_type",
--     "act_rate_version_status", "act_rating_style", "act_product_line";
