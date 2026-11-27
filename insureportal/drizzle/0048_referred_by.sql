-- 0048 W31-D (2026-11-27): loyalty_accounts.referredBy — port of the
-- missing column from main drizzle/insurance-extended-schema.ts:61
-- (loyalty_accounts.referredBy). Consumed by
-- server/routers/promotions.ts applyReferral: the guarded
-- UPDATE ... SET referredBy ... WHERE referredBy IS NULL is the atomic
-- one-time referral claim (fail-closed against repeat farming). Nullable:
-- an account is un-referred until the first successful applyReferral.
-- Idempotent: safe to re-apply.
ALTER TABLE "loyalty_accounts" ADD COLUMN IF NOT EXISTS "referredBy" integer;
