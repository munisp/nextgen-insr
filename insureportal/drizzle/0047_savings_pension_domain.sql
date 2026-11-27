-- 0047 W30 (2026-11-27): savings & pension domain — savings_products,
-- savings_accounts, savings_ledger (append-only postings), pfa_registry,
-- pension_contributions. Serves the newly implemented
-- savingsProducts.products/analytics and pensionCollection.pfas/analytics
-- procedures (design: w30-design.md §2; hand-authored transcription of the
-- drizzle definitions in drizzle/schema.ts — the repo has no drizzle meta
-- journal and drizzle.config.ts points at a nonexistent schema path, so
-- drizzle-kit generate is not the mechanism).
-- Idempotent: safe to re-apply. Enums created via DO blocks (drizzle-kit's
-- generate emits plain CREATE TYPE; DO+EXCEPTION keeps re-runs clean).
DO $$ BEGIN CREATE TYPE "savings_product_type" AS ENUM ('Daily Thrift','Target Savings','Fixed Deposit'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "savings_frequency" AS ENUM ('Daily','Weekly','Monthly','Flexible'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "savings_account_status" AS ENUM ('active','dormant','closed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "savings_entry_type" AS ENUM ('deposit','withdrawal','interest_credit'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "pension_contribution_status" AS ENUM ('collected','remitted','failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "savings_products" (
  "id" serial PRIMARY KEY,
  "code" varchar(32) NOT NULL UNIQUE,
  "name" varchar(256) NOT NULL,
  "type" "savings_product_type" NOT NULL,
  "description" text,
  "minDeposit" numeric(15,2) DEFAULT '0.00' NOT NULL,
  "maxDeposit" numeric(15,2),
  "interestRateBps" integer DEFAULT 0 NOT NULL,
  "lockPeriodDays" integer DEFAULT 0 NOT NULL,
  "frequency" "savings_frequency" DEFAULT 'Flexible' NOT NULL,
  "isActive" boolean DEFAULT true NOT NULL,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "savprod_code_idx" ON "savings_products" ("code");
CREATE INDEX IF NOT EXISTS "savprod_isActive_idx" ON "savings_products" ("isActive");
CREATE INDEX IF NOT EXISTS "savprod_tenantId_idx" ON "savings_products" ("tenantId");

CREATE TABLE IF NOT EXISTS "savings_accounts" (
  "id" serial PRIMARY KEY,
  "accountNo" varchar(32) NOT NULL UNIQUE,
  "productId" integer NOT NULL REFERENCES "savings_products"("id"),
  "customerId" integer REFERENCES "customers"("id"),
  "agentId" integer REFERENCES "agents"("id"),
  "status" "savings_account_status" DEFAULT 'active' NOT NULL,
  "openedAt" timestamp DEFAULT now() NOT NULL,
  "closedAt" timestamp,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "savacct_accountNo_idx" ON "savings_accounts" ("accountNo");
CREATE INDEX IF NOT EXISTS "savacct_productId_idx" ON "savings_accounts" ("productId");
CREATE INDEX IF NOT EXISTS "savacct_status_idx" ON "savings_accounts" ("status");
CREATE INDEX IF NOT EXISTS "savacct_tenantId_idx" ON "savings_accounts" ("tenantId");

CREATE TABLE IF NOT EXISTS "savings_ledger" (
  "id" serial PRIMARY KEY,
  "entryRef" varchar(32) NOT NULL UNIQUE,
  "accountId" integer NOT NULL REFERENCES "savings_accounts"("id"),
  "entryType" "savings_entry_type" NOT NULL,
  "amount" numeric(15,2) NOT NULL,
  "currency" varchar(3) DEFAULT 'NGN' NOT NULL,
  "rateBpsApplied" integer,
  "periodStart" timestamp,
  "periodEnd" timestamp,
  "agentId" integer,
  "postedAt" timestamp DEFAULT now() NOT NULL,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "savled_entryRef_idx" ON "savings_ledger" ("entryRef");
CREATE INDEX IF NOT EXISTS "savled_accountId_type_idx" ON "savings_ledger" ("accountId", "entryType");
CREATE INDEX IF NOT EXISTS "savled_type_posted_idx" ON "savings_ledger" ("entryType", "postedAt");
CREATE INDEX IF NOT EXISTS "savled_tenantId_idx" ON "savings_ledger" ("tenantId");

CREATE TABLE IF NOT EXISTS "pfa_registry" (
  "id" serial PRIMARY KEY,
  "code" varchar(32) NOT NULL UNIQUE,
  "name" varchar(256) NOT NULL,
  "licenseNo" varchar(64) NOT NULL,
  "contactEmail" varchar(320),
  "contactPhone" varchar(20),
  "isActive" boolean DEFAULT true NOT NULL,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "pfa_code_idx" ON "pfa_registry" ("code");
CREATE INDEX IF NOT EXISTS "pfa_isActive_idx" ON "pfa_registry" ("isActive");
CREATE INDEX IF NOT EXISTS "pfa_tenantId_idx" ON "pfa_registry" ("tenantId");

CREATE TABLE IF NOT EXISTS "pension_contributions" (
  "id" serial PRIMARY KEY,
  "ref" varchar(32) NOT NULL UNIQUE,
  "rsaPin" varchar(32) NOT NULL,
  "contributorName" varchar(256),
  "pfaId" integer NOT NULL REFERENCES "pfa_registry"("id"),
  "type" varchar(32) DEFAULT 'Mandatory' NOT NULL,
  "employeeAmount" numeric(15,2) NOT NULL,
  "employerAmount" numeric(15,2) NOT NULL,
  "commission" numeric(12,2) DEFAULT '0.00' NOT NULL,
  "period" varchar(7) NOT NULL,
  "status" "pension_contribution_status" DEFAULT 'collected' NOT NULL,
  "agentId" integer,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "pencon_ref_idx" ON "pension_contributions" ("ref");
CREATE INDEX IF NOT EXISTS "pencon_pfaId_status_idx" ON "pension_contributions" ("pfaId", "status");
CREATE INDEX IF NOT EXISTS "pencon_rsaPin_idx" ON "pension_contributions" ("rsaPin");
CREATE INDEX IF NOT EXISTS "pencon_period_idx" ON "pension_contributions" ("period");
CREATE INDEX IF NOT EXISTS "pencon_tenantId_idx" ON "pension_contributions" ("tenantId");
