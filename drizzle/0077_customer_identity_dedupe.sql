-- G2 audit 2026-02 (finding #7): duplicate-identity controls.
-- customers.bvn / customers.nin are AES-256-GCM encrypted with random IVs,
-- so the ciphertext columns can never carry a unique constraint. These
-- deterministic HMAC-SHA256 blind-index columns (key = FIELD_ENCRYPTION_KEY,
-- computed by server/lib/piiCrypto.ts piiDedupeHash) make duplicate national
-- IDs enforceable at the database layer.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "bvn_hash" varchar(64);
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "nin_hash" varchar(64);
CREATE UNIQUE INDEX IF NOT EXISTS "customers_bvn_hash_idx" ON "customers" ("bvn_hash") WHERE "bvn_hash" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "customers_nin_hash_idx" ON "customers" ("nin_hash") WHERE "nin_hash" IS NOT NULL;
-- NOTE: historical rows have NULL hashes (backfill requires the encryption
-- key and is an operator task); the partial indexes enforce dedupe for all
-- NEW writes, which populate the hash at insert time.
