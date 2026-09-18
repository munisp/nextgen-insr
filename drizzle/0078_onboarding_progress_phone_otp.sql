-- G2 audit 2026-02 (findings #8, #10):
--  * customer_onboarding_progress — durable, server-derived pipeline stage
--    (previously client-asserted fromStage + fabricated "live" progress).
--  * phone_verification_otps — phone-ownership proof required before a
--    phone match may merge into an existing customer record.
CREATE TABLE IF NOT EXISTS "customer_onboarding_progress" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "current_stage" varchar(32) DEFAULT 'registration' NOT NULL,
  "notes" text,
  "advanced_by" varchar(64),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "customer_onboarding_progress_user_idx" ON "customer_onboarding_progress" ("user_id");

CREATE TABLE IF NOT EXISTS "phone_verification_otps" (
  "id" serial PRIMARY KEY NOT NULL,
  "phone" varchar(20) NOT NULL,
  "hashed_otp" varchar(128) NOT NULL,
  "purpose" varchar(32) DEFAULT 'phone_ownership' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "used" boolean DEFAULT false NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "phone_verif_otps_phone_idx" ON "phone_verification_otps" ("phone");
CREATE INDEX IF NOT EXISTS "phone_verif_otps_expires_idx" ON "phone_verification_otps" ("expires_at");
