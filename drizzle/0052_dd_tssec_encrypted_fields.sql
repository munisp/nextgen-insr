-- DD-TSSEC: encrypted_fields per-record crypto material + ownership (additive only)
-- A7-4/A7-6: ciphertext columns and per-record random salt; created_by binds
-- each record to its owning user for owner-or-admin access control. All
-- columns nullable so pre-existing metadata-only rows remain valid.
ALTER TABLE "encrypted_fields" ADD COLUMN IF NOT EXISTS "entity_type" text;
ALTER TABLE "encrypted_fields" ADD COLUMN IF NOT EXISTS "entity_id" integer;
ALTER TABLE "encrypted_fields" ADD COLUMN IF NOT EXISTS "encrypted_value" text;
ALTER TABLE "encrypted_fields" ADD COLUMN IF NOT EXISTS "iv" text;
ALTER TABLE "encrypted_fields" ADD COLUMN IF NOT EXISTS "auth_tag" text;
ALTER TABLE "encrypted_fields" ADD COLUMN IF NOT EXISTS "salt" text;
ALTER TABLE "encrypted_fields" ADD COLUMN IF NOT EXISTS "created_by" integer;
