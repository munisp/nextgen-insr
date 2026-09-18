-- 0045 H-wave (2026-09): OTP-verified merchant settlement changes for the
-- legacy insureportal tree (mirrors platform 0076). The static
-- X-Merchant-Code auth and silent settlement swaps were falsified-verifier
-- findings; the payout destination now changes only via this OTP-gated,
-- audited, hold-protected flow.
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
