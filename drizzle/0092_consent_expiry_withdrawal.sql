-- W12-R1 (2026-10-25): data_consent_records — consent expiry + withdrawal
-- audit columns. Repairs dataConsentRecordsCrud (4 of 6 procedures 500'd:
-- grantConsent inserted a non-existent expiresAt via `as any`, and
-- withdrawConsent SET a non-existent withdrawalReason). Both columns are
-- nullable and append-only: rows written by gdprDashboard (no expiresAt)
-- remain valid and are classified ACTIVE by the repaired
-- getComplianceStatus. No `status` column is added — status is derived:
--   active = granted AND revokedAt IS NULL
--            AND (expires_at IS NULL OR expires_at > now())
--
-- IDEMPOTENCY: IF NOT EXISTS on both ADD COLUMNs.

ALTER TABLE "data_consent_records"
  ADD COLUMN IF NOT EXISTS "expires_at" timestamp;

ALTER TABLE "data_consent_records"
  ADD COLUMN IF NOT EXISTS "withdrawal_reason" text;
