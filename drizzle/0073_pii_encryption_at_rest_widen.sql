-- 0073 OPS-3: widen PII columns to TEXT so they can hold AES-256-GCM
-- envelopes ("pii:v1:<salt>:<iv>:<tag>:<ciphertext>", hex — up to ~800 chars)
-- written by server/lib/piiCrypto.ts. Existing plaintext values remain valid
-- (decryptPii passes non-envelope values through unchanged) — widening is
-- non-destructive and requires no data rewrite.
-- Applied via scripts/db-migrate-safe.sh step 4b (schema_migrations_ext ledger).
ALTER TABLE "customers" ALTER COLUMN "bvn" TYPE text;
ALTER TABLE "customers" ALTER COLUMN "nin" TYPE text;
ALTER TABLE "customers" ALTER COLUMN "dateOfBirth" TYPE text;
ALTER TABLE "kyc_sessions" ALTER COLUMN "bvn" TYPE text;
ALTER TABLE "kyc_sessions" ALTER COLUMN "nin" TYPE text;
