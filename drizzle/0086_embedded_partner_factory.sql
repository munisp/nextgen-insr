-- Q-wave Q1 (embedded partner product factory, 2026-09-25): four NEW tables,
-- append-only. Turaco/Lami-style embedded partner product config, MicroEnsure-
-- style freemium ladder (tiers + assignments), ZhongAn-style scenario product
-- templates. No existing table or column is altered.
--
-- Sprint46 platform table-count gate: base 250 + 4 = 254 measured on this
-- branch. NOTE (2026-09-25): sibling Q-wave branches add their own tables
-- (Q2 +6, Q4 +4) — the orchestrator resolves the merged count at merge time;
-- this comment records ONLY the Q1 increment.
--
-- Column naming follows the platform convention used by policies/claims
-- (camelCase physical names) so drizzle-kit push and raw SQL agree.

-- 1. partner_products: one row per (partner, product) embedding config.
CREATE TABLE IF NOT EXISTS "partner_products" (
  "id" serial PRIMARY KEY,
  "partnerCode" varchar(32) NOT NULL UNIQUE,
  "partnerName" varchar(128) NOT NULL,
  "productId" integer NOT NULL REFERENCES "insurance_products"("id"),
  "maxSumInsured" numeric(18,2) NOT NULL,
  "commissionRate" numeric(5,2) NOT NULL DEFAULT '5.0',
  "branding" jsonb DEFAULT '{}',
  "whitelabel" boolean NOT NULL DEFAULT false,
  -- sandbox=true: every row written through this config is test-mode data,
  -- isolated from live data (queries are scoped by the product's sandbox flag).
  "sandbox" boolean NOT NULL DEFAULT false,
  -- sha256 hash of the partner's server-to-server key (raw key shown once).
  "apiKeyHash" varchar(64),
  "status" varchar(16) NOT NULL DEFAULT 'active',
  "createdByUserId" integer,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "pp_product_idx" ON "partner_products" ("productId");
CREATE INDEX IF NOT EXISTS "pp_status_idx" ON "partner_products" ("status");

-- 2. freemium_tiers: the ladder definitions (free basic cover → paid tiers).
CREATE TABLE IF NOT EXISTS "freemium_tiers" (
  "id" serial PRIMARY KEY,
  "tierCode" varchar(32) NOT NULL UNIQUE,
  "name" varchar(128) NOT NULL,
  "productId" integer NOT NULL REFERENCES "insurance_products"("id"),
  "monthlyPremium" numeric(18,2) NOT NULL DEFAULT '0',
  "sumInsured" numeric(18,2) NOT NULL,
  "coverageType" varchar(64) NOT NULL,
  "isFree" boolean NOT NULL DEFAULT false,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

-- 3. freemium_enrollments: customer → tier assignments (the ladder position).
CREATE TABLE IF NOT EXISTS "freemium_enrollments" (
  "id" serial PRIMARY KEY,
  "customerId" integer NOT NULL,
  "tierId" integer NOT NULL REFERENCES "freemium_tiers"("id"),
  "policyId" integer REFERENCES "policies"("id"),
  "status" varchar(16) NOT NULL DEFAULT 'active',
  "enrolledAt" timestamp NOT NULL DEFAULT now(),
  "upgradedAt" timestamp,
  "metadata" jsonb DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS "fe_customer_idx" ON "freemium_enrollments" ("customerId");
CREATE INDEX IF NOT EXISTS "fe_tier_idx" ON "freemium_enrollments" ("tierId");

-- 4. scenario_templates: event-bound small-ticket cover templates.
CREATE TABLE IF NOT EXISTS "scenario_templates" (
  "id" serial PRIMARY KEY,
  "templateCode" varchar(32) NOT NULL UNIQUE,
  "name" varchar(128) NOT NULL,
  "productId" integer NOT NULL REFERENCES "insurance_products"("id"),
  "triggerEvent" varchar(64) NOT NULL,
  "coverageType" varchar(64) NOT NULL,
  "sumInsured" numeric(18,2) NOT NULL,
  "premiumAmount" numeric(18,2) NOT NULL,
  "durationHours" integer NOT NULL DEFAULT 24,
  "terms" jsonb DEFAULT '{}',
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
