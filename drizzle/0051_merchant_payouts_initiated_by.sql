-- DD-AUTH follow-up: maker-checker attribution for merchant payouts (additive only)
-- merchantPayoutSettlement.approvePayout/processPayout guard on initiated_by
-- (mirrors commission_payouts.requested_by / processed_by conventions: integer user id).
ALTER TABLE "merchant_payouts" ADD COLUMN IF NOT EXISTS "initiated_by" integer;
