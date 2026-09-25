-- Q-wave Q3 (2026-09-25): P2P pool surplus accounting + usage-based motor.
-- Five REAL tables, mirrored in drizzle/schema.innovations.ts (append-only
-- EOF tail) so `drizzle-kit push` materializes the same structure for the
-- integration harness. All statements idempotent (IF NOT EXISTS); no
-- existing table or column is altered.
--
--   pool_periods                — period-close accounting record per pool
--   pool_surplus_distributions  — dual-control surplus distribution lines
--   telematics_trips            — idempotent trip ingestion (client_trip_id)
--   telematics_scores           — rolling score + bounded rating factor
--   usage_cover_activations     — per-trip / per-day cover activation

CREATE TABLE IF NOT EXISTS "pool_periods" (
  "id" serial PRIMARY KEY,
  "pool_id" integer NOT NULL REFERENCES "p2p_pools"("id"),
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "opening_balance" numeric(15,2) NOT NULL,
  "contributions_collected" numeric(15,2) NOT NULL DEFAULT 0,
  "claims_paid" numeric(15,2) NOT NULL DEFAULT 0,
  "closing_balance" numeric(15,2) NOT NULL,
  "reserve_bps" integer NOT NULL,
  "reserve_amount" numeric(15,2) NOT NULL,
  "surplus_amount" numeric(15,2) NOT NULL,
  "distribution_mode" varchar(24) NOT NULL DEFAULT 'p2p_refund',
  "wakala_fee_bps" integer,
  "wakala_fee_amount" numeric(15,2),
  "status" varchar(24) NOT NULL DEFAULT 'open',
  "closed_by_user_id" integer,
  "closed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_pool_periods_pool_start" ON "pool_periods" ("pool_id", "period_start");
CREATE INDEX IF NOT EXISTS "idx_pool_periods_pool" ON "pool_periods" ("pool_id", "period_end");

CREATE TABLE IF NOT EXISTS "pool_surplus_distributions" (
  "id" serial PRIMARY KEY,
  "period_id" integer NOT NULL REFERENCES "pool_periods"("id"),
  "pool_id" integer NOT NULL REFERENCES "p2p_pools"("id"),
  "member_id" integer NOT NULL REFERENCES "p2p_pool_members"("id"),
  "customer_id" integer NOT NULL REFERENCES "customers"("id"),
  "share_bps" integer NOT NULL,
  "amount" numeric(15,2) NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'proposed',
  "proposed_by_user_id" integer NOT NULL,
  "approved_by_user_id" integer,
  "executed_by_user_id" integer,
  "tb_transfer_id" varchar(64),
  "failure_reason" text,
  "executed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_pool_surplus_dist_period_member" ON "pool_surplus_distributions" ("period_id", "member_id");
CREATE INDEX IF NOT EXISTS "idx_pool_surplus_dist_period" ON "pool_surplus_distributions" ("period_id", "status");

CREATE TABLE IF NOT EXISTS "telematics_trips" (
  "id" bigserial PRIMARY KEY,
  "policy_id" integer NOT NULL REFERENCES "policies"("id"),
  "customer_id" integer NOT NULL REFERENCES "customers"("id"),
  "client_trip_id" varchar(64) NOT NULL,
  "device_id" varchar(64) NOT NULL,
  "started_at" timestamptz NOT NULL,
  "ended_at" timestamptz NOT NULL,
  "distance_km" numeric(10,3) NOT NULL DEFAULT 0,
  "duration_seconds" integer NOT NULL DEFAULT 0,
  "hard_brakes" integer NOT NULL DEFAULT 0,
  "speeding_events" integer NOT NULL DEFAULT 0,
  "cornering_events" integer NOT NULL DEFAULT 0,
  "night_driving_seconds" integer NOT NULL DEFAULT 0,
  "max_speed_kmh" numeric(6,2),
  "trip_score" numeric(5,2),
  "raw_event_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_telematics_trips_client_trip" ON "telematics_trips" ("client_trip_id");
CREATE INDEX IF NOT EXISTS "idx_telematics_trips_policy" ON "telematics_trips" ("policy_id", "started_at");

CREATE TABLE IF NOT EXISTS "telematics_scores" (
  "id" serial PRIMARY KEY,
  "policy_id" integer NOT NULL UNIQUE REFERENCES "policies"("id"),
  "customer_id" integer NOT NULL REFERENCES "customers"("id"),
  "score" numeric(5,2) NOT NULL,
  "rating_factor" numeric(4,2) NOT NULL DEFAULT 1.00,
  "trips_counted" integer NOT NULL DEFAULT 0,
  "window_days" integer NOT NULL DEFAULT 30,
  "computed_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "usage_cover_activations" (
  "id" serial PRIMARY KEY,
  "policy_id" integer NOT NULL REFERENCES "policies"("id"),
  "customer_id" integer NOT NULL REFERENCES "customers"("id"),
  "cover_type" varchar(8) NOT NULL,
  "client_activation_id" varchar(64) NOT NULL,
  "trip_id" integer REFERENCES "telematics_trips"("id"),
  "days" integer,
  "premium_amount" numeric(15,2),
  "status" varchar(16) NOT NULL DEFAULT 'active',
  "activated_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_usage_cover_client_activation" ON "usage_cover_activations" ("client_activation_id");
CREATE INDEX IF NOT EXISTS "idx_usage_cover_policy_status" ON "usage_cover_activations" ("policy_id", "status");
CREATE INDEX IF NOT EXISTS "idx_usage_cover_expiry" ON "usage_cover_activations" ("status", "expires_at");
