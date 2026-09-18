-- 0046 H2-wave (2026-09): maker-checker attribution on merchant_payouts.
-- approvePayout is now admin-only with a maker-checker guard (initiator can
-- never approve; NULL-initiator legacy rows are unapprovable, fail-closed).
-- Also: initiatePayout now binds the caller's Keycloak identity to the
-- merchant and debits the wallet ATOMICALLY in the same transaction
-- (guarded UPDATE ... WHERE walletBalance >= amount), and writes the
-- previously-phantom reference/period columns honestly.
ALTER TABLE "merchant_payouts" ADD COLUMN IF NOT EXISTS "initiated_by" integer;
