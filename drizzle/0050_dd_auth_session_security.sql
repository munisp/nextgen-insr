-- DD-AUTH: session/credential security (additive only)
-- F6-5: durable agent PIN lockout (5 failures -> 15-minute lock)
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "failedPinAttempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "pinLockedUntil" timestamp;
-- F7-2: maker-checker attribution for the payout processing leg
ALTER TABLE "commission_payouts" ADD COLUMN IF NOT EXISTS "processed_by" integer;
