-- 0076 G1 fix-wave (merchant-onboarding audit, 2026-06): control tables.
--  * merchant_settlement_change_requests — CRIT-3: OTP-verified, audited
--    settlement (payout destination) changes with a cooling-off hold.
--  * merchant_fee_limits — MED-13: per-merchant MDR / min / max / daily cap.
--  * merchant_registry_verifications — HIGH-8: honest CAC/TIN verification
--    records (presence of a number is not verification).
--  * merchant_kyc_stages — MED-16: persisted KYC stage machine; "approval"
--    is reachable only via the admin approval path.
CREATE TABLE IF NOT EXISTS "merchant_settlement_change_requests" (
  "id" serial PRIMARY KEY,
  "merchantId" integer NOT NULL REFERENCES "merchants"("id"),
  "newAccountNumber" varchar(20) NOT NULL,
  "newBankCode" varchar(10) NOT NULL,
  "newBankName" varchar(64) NOT NULL,
  "hashedOtp" varchar(128) NOT NULL,
  "otpExpiresAt" timestamp NOT NULL,
  "otpAttempts" integer DEFAULT 0 NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "requestedBy" integer NOT NULL,
  "appliedAt" timestamp,
  "holdUntil" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "mscr_merchantId_idx" ON "merchant_settlement_change_requests" ("merchantId");
CREATE INDEX IF NOT EXISTS "mscr_status_idx" ON "merchant_settlement_change_requests" ("status");

CREATE TABLE IF NOT EXISTS "merchant_fee_limits" (
  "id" serial PRIMARY KEY,
  "merchantId" integer NOT NULL REFERENCES "merchants"("id"),
  "mdrBps" integer,
  "minAmount" numeric(15,2),
  "maxAmount" numeric(15,2),
  "dailyLimit" numeric(20,2),
  "updatedBy" integer NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "mfl_merchantId_uidx" ON "merchant_fee_limits" ("merchantId");

CREATE TABLE IF NOT EXISTS "merchant_registry_verifications" (
  "id" serial PRIMARY KEY,
  "merchantId" integer NOT NULL REFERENCES "merchants"("id"),
  "kind" varchar(8) NOT NULL,
  "registryNumber" varchar(32) NOT NULL,
  "verified" boolean DEFAULT false NOT NULL,
  "provider" varchar(64) NOT NULL,
  "providerRef" varchar(128),
  "detail" text,
  "verifiedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "mrv_merchantId_kind_idx" ON "merchant_registry_verifications" ("merchantId", "kind");

CREATE TABLE IF NOT EXISTS "merchant_kyc_stages" (
  "id" serial PRIMARY KEY,
  "merchantId" integer NOT NULL REFERENCES "merchants"("id"),
  "stage" varchar(32) DEFAULT 'document_collection' NOT NULL,
  "updatedBy" integer,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "mks_merchantId_uidx" ON "merchant_kyc_stages" ("merchantId");
