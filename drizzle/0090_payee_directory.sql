-- W11-B1a (2026-10-05): payee_directory — per-member saved payees for the
-- member funds rails (bill / airtime / momo). Mirrors the payeeDirectory
-- table in drizzle/schema.ts so `drizzle-kit push` (integration harness)
-- materializes the same structure. Append-only and idempotent
-- (IF NOT EXISTS / CREATE TYPE guarded by a DO block); no existing table or
-- column is altered.
--
--   - naturalKey: keyed HMAC-SHA256 blind index of the rail identifier tuple
--     (encryptPii random IVs can never be unique-indexed; same discipline as
--     customers.bvn_hash, migration 0077) — enables deterministic upsert.
--   - meterNumber / phone / walletNumber hold AES-256-GCM "pii:v1:..."
--     envelopes (server/lib/piiCrypto.ts); application-level encryption, so
--     the column type is plain text (same pattern as customers.bvn, 0073).

DO $$ BEGIN
  CREATE TYPE "payee_rail" AS ENUM ('bill', 'airtime', 'momo');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "payee_directory" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customerId" integer NOT NULL REFERENCES "customers"("id"),
  "rail" "payee_rail" NOT NULL,
  "label" text,
  "billerCode" text,
  "meterNumber" text,
  "network" text,
  "phone" text,
  "provider" text,
  "walletNumber" text,
  "naturalKey" text NOT NULL,
  "lastAmountKobo" bigint,
  "useCount" integer DEFAULT 0 NOT NULL,
  "lastUsedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "payee_dir_customer_idx"
  ON "payee_directory" ("customerId");
CREATE UNIQUE INDEX IF NOT EXISTS "payee_dir_natural_unique"
  ON "payee_directory" ("customerId", "rail", "naturalKey");
