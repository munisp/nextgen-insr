-- Q-wave Q2 (2026-09-25): Parametric Trigger Engine + straight-through
-- claims (STP) expansion.
--
-- Naming disclosure: the brief's table names `parametric_triggers` and
-- `parametric_payouts` are ALREADY taken by the legacy innovation-schema
-- weather-trigger tables (drizzle/schema.innovations.ts, used by
-- innovationRouters.parametricRouter). The engine tables therefore use
-- collision-free names:
--   parametric_triggers  -> parametric_trigger_definitions
--   parametric_payouts   -> parametric_payout_settlements
--   parametric_products  -> parametric_products            (free)
--   parametric_events    -> parametric_events              (free)
-- Plus claim_stp_tiers for per-product STP auto-adjudication caps
-- (claimsJourneyPolicy ₦200k default preserved when no tier row exists).
--
-- Money discipline: parametric_events.event_key is UNIQUE (idempotent fire —
-- a duplicate event key can never create a second payout), and
-- parametric_payout_settlements carries a UNIQUE (event_id, claim_id) pair.

CREATE TABLE IF NOT EXISTS "parametric_trigger_definitions" (
  "id" serial PRIMARY KEY,
  "name" varchar(128) NOT NULL UNIQUE,
  "metric" varchar(64) NOT NULL,
  "operator" varchar(8) NOT NULL,               -- gt | gte | lt | lte | eq
  "threshold" numeric(18,4) NOT NULL,
  "window_seconds" integer NOT NULL,            -- max reading age (staleness bound)
  "datasource_config" jsonb NOT NULL,           -- {type:'http',url,...} | {type:'manual'}
  "status" varchar(16) NOT NULL DEFAULT 'draft',-- draft | active | paused | retired
  "created_by" integer,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "parametric_products" (
  "id" serial PRIMARY KEY,
  "product_id" integer NOT NULL REFERENCES "insurance_products"("id"),
  "trigger_id" integer NOT NULL REFERENCES "parametric_trigger_definitions"("id"),
  "payout_amount" numeric(18,2) NOT NULL,       -- fixed payout (product config owns the amount)
  "covered_peril" varchar(64) NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'active',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "parametric_products_product_trigger_uniq" UNIQUE ("product_id", "trigger_id")
);

CREATE TABLE IF NOT EXISTS "parametric_events" (
  "id" serial PRIMARY KEY,
  "event_key" varchar(256) NOT NULL UNIQUE,     -- idempotency key (trigger + window)
  "trigger_id" integer NOT NULL REFERENCES "parametric_trigger_definitions"("id"),
  "measured_value" numeric(18,4),
  "payload_hash" varchar(64),                   -- sha256 of the datasource payload
  "payload" jsonb,
  "datasource_type" varchar(16) NOT NULL,       -- http | manual
  "status" varchar(24) NOT NULL,                -- fired | not_fired | data_unavailable
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "parametric_payout_settlements" (
  "id" serial PRIMARY KEY,
  "event_id" integer NOT NULL REFERENCES "parametric_events"("id"),
  "claim_id" integer NOT NULL REFERENCES "claims"("id"),
  "payment_id" integer,                         -- claims_payments.id when settled
  "amount" numeric(18,2) NOT NULL,
  "status" varchar(24) NOT NULL,                -- paid | pending_adjudication | failed
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "parametric_payout_event_claim_uniq" UNIQUE ("event_id", "claim_id")
);

-- Staff-attested readings for 'manual' datasources (dual control: the
-- confirmer must be a DIFFERENT staff member than the attester; only
-- confirmed readings are usable evidence).
CREATE TABLE IF NOT EXISTS "parametric_manual_readings" (
  "id" serial PRIMARY KEY,
  "trigger_id" integer NOT NULL REFERENCES "parametric_trigger_definitions"("id"),
  "metric" varchar(64) NOT NULL,
  "value" numeric(18,4) NOT NULL,
  "observed_at" timestamp NOT NULL,
  "attested_by" integer NOT NULL,
  "confirmed_by" integer,
  "note" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "confirmed_at" timestamp
);

CREATE TABLE IF NOT EXISTS "claim_stp_tiers" (
  "id" serial PRIMARY KEY,
  "product_id" integer REFERENCES "insurance_products"("id"), -- NULL = platform default row
  "tier_name" varchar(64) NOT NULL,
  "auto_approve_cap" numeric(18,2) NOT NULL,    -- auto-adjudication cap (₦) for this product/tier
  "max_fraud_score" numeric(5,2),               -- when set, fraud gate REQUIRED: score must be <= this
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" integer,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "claim_stp_tiers_product_tier_uniq" UNIQUE ("product_id", "tier_name")
);

CREATE INDEX IF NOT EXISTS "pte_trigger_status_idx" ON "parametric_events" ("trigger_id", "status");
CREATE INDEX IF NOT EXISTS "ptp_event_idx" ON "parametric_payout_settlements" ("event_id");
CREATE INDEX IF NOT EXISTS "pmr_trigger_idx" ON "parametric_manual_readings" ("trigger_id", "created_at");
CREATE INDEX IF NOT EXISTS "cst_product_idx" ON "claim_stp_tiers" ("product_id");
