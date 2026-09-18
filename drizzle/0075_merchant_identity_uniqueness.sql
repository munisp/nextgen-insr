-- 0075 G1 fix-wave (merchant-onboarding audit #9, 2026-06): duplicate-identity
-- controls on merchants. Registration previously deduped only on email via a
-- racy check-then-insert; RC(CAC)/TIN/phone had no uniqueness at all, so one
-- CAC/TIN could onboard N shell merchants. These partial unique indexes make
-- identity collision a DB-enforced CONFLICT among live rows (NULL registry
-- numbers stay optional; soft-deleted merchants are out of scope).
-- Pre-flight: dedupe existing rows before applying, e.g.
--   SELECT "email", COUNT(*) FROM merchants WHERE "deletedAt" IS NULL GROUP BY 1 HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS "merchants_email_identity_uidx"
  ON "merchants" ("email") WHERE "email" IS NOT NULL AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "merchants_rc_identity_uidx"
  ON "merchants" ("rcNumber") WHERE "rcNumber" IS NOT NULL AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "merchants_tin_identity_uidx"
  ON "merchants" ("tinNumber") WHERE "tinNumber" IS NOT NULL AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "merchants_phone_identity_uidx"
  ON "merchants" ("phone") WHERE "deletedAt" IS NULL;
