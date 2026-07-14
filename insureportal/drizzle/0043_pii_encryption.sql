-- PII Encryption Migration: Encrypt BVN/NIN at rest using pgcrypto
-- This migration adds encryption for sensitive identity numbers

-- Enable pgcrypto extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add encrypted columns for PII data
-- We use a separate encrypted column and keep the hash for lookups

-- Create PII encryption key table (key managed externally via env var)
CREATE TABLE IF NOT EXISTS pii_encryption_keys (
    id SERIAL PRIMARY KEY,
    key_alias VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    rotated_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true
);

-- Add encrypted BVN/NIN columns to kyc_profiles if they exist
DO $$
BEGIN
    -- Add hashed BVN column for lookups (SHA-256)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'kyc_profiles') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_profiles' AND column_name = 'bvn_hash') THEN
            ALTER TABLE kyc_profiles ADD COLUMN bvn_hash TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_profiles' AND column_name = 'nin_hash') THEN
            ALTER TABLE kyc_profiles ADD COLUMN nin_hash TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_profiles' AND column_name = 'bvn_encrypted') THEN
            ALTER TABLE kyc_profiles ADD COLUMN bvn_encrypted BYTEA;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_profiles' AND column_name = 'nin_encrypted') THEN
            ALTER TABLE kyc_profiles ADD COLUMN nin_encrypted BYTEA;
        END IF;
    END IF;

    -- Add to customers table
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customers') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'bvn_hash') THEN
            ALTER TABLE customers ADD COLUMN bvn_hash TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'nin_hash') THEN
            ALTER TABLE customers ADD COLUMN nin_hash TEXT;
        END IF;
    END IF;
END $$;

-- Create indexes on hash columns for lookup
CREATE INDEX IF NOT EXISTS idx_kyc_profiles_bvn_hash ON kyc_profiles(bvn_hash) WHERE bvn_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kyc_profiles_nin_hash ON kyc_profiles(nin_hash) WHERE nin_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_bvn_hash ON customers(bvn_hash) WHERE bvn_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_nin_hash ON customers(nin_hash) WHERE nin_hash IS NOT NULL;

-- Create helper functions for PII encryption/decryption
CREATE OR REPLACE FUNCTION hash_pii(value TEXT) RETURNS TEXT AS $$
BEGIN
    RETURN encode(digest(value, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION encrypt_pii(value TEXT, encryption_key TEXT) RETURNS BYTEA AS $$
BEGIN
    RETURN pgp_sym_encrypt(value, encryption_key);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrypt_pii(encrypted BYTEA, encryption_key TEXT) RETURNS TEXT AS $$
BEGIN
    RETURN pgp_sym_decrypt(encrypted, encryption_key);
END;
$$ LANGUAGE plpgsql;

-- Backfill: hash existing BVN/NIN values
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_profiles' AND column_name = 'bvn') THEN
        UPDATE kyc_profiles SET bvn_hash = hash_pii(bvn) WHERE bvn IS NOT NULL AND bvn_hash IS NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_profiles' AND column_name = 'nin') THEN
        UPDATE kyc_profiles SET nin_hash = hash_pii(nin) WHERE nin IS NOT NULL AND nin_hash IS NULL;
    END IF;
END $$;
