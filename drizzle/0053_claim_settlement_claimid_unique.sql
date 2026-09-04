-- DD-TSSTATE: claim-settlement state-machine + money hardening (additive only)
-- F11-3: exactly one settlement payment per claim. Backs
-- insuranceWorkflows.settleClaimPayment claimId idempotency and its
-- INSERT ... ON CONFLICT ("claimId") DO NOTHING guard — a retry can never
-- double-pay a claim, even under a lost race.
CREATE UNIQUE INDEX IF NOT EXISTS "claims_pay_claimId_unique" ON "claims_payments" ("claimId");
-- F13 (clawback): clawback amounts must be positive. NOT VALID keeps this
-- additive (existing rows are not scanned); the constraint is enforced for
-- all new inserts/updates, mirroring the zod .positive() validation in
-- commissionClawback.initiate.
ALTER TABLE "commission_clawbacks" ADD CONSTRAINT "commission_clawbacks_amount_positive" CHECK (clawback_amount > 0) NOT VALID;
