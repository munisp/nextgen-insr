-- 0074 OPS-4: audit_log.erased-redaction tombstone column.
-- Enables GDPR/NDPR erasure of PII held in the append-only audit chain by
-- redacting PII payload columns (metadata/ipAddress/userAgent) while keeping
-- prevHash/entryHash intact, so hash-chain linkage remains verifiable.
-- Mechanism: server/lib/auditChain.ts redactAuditLogPii(); verification
-- skips content recompute for redacted rows but enforces linkage.
-- Applied via scripts/db-migrate-safe.sh step 4b (schema_migrations_ext ledger).
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "redactedAt" timestamp;
