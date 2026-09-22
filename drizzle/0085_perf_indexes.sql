-- P-wave (infra/DB performance, 2026-09-19): hot-path composite indexes from
-- the integrations/data-layer performance audit (p-audit-infra findings 8-10).
-- All statements are idempotent (IF NOT EXISTS) and append-only; no table or
-- column changes. Index definitions are mirrored in drizzle/schema.ts so
-- `drizzle-kit push` (used by the integration test harness) creates the same
-- indexes. For production apply with CONCURRENTLY per the runbook — plain
-- CREATE INDEX is used here for consistency with prior migrations (0079/0083).
--
-- SKIPPED: agents(phone) — the G3 wave already added a UNIQUE index
-- ("agents_phone_unique", migration 0079); a second plain index is redundant.

-- audit_log: lookups by resource and time-ranged action queries were seq
-- scans on the fastest-growing append-only table.
CREATE INDEX IF NOT EXISTS "audit_resourceId_createdAt_idx"
  ON "audit_log" ("resourceId", "createdAt");
CREATE INDEX IF NOT EXISTS "audit_action_createdAt_idx"
  ON "audit_log" ("action", "createdAt");

-- policies: customer portal hot path filters by (customerId, status); the
-- single-column status index alone is low-selectivity.
CREATE INDEX IF NOT EXISTS "pol_customer_status_idx"
  ON "policies" ("customerId", "status");

-- claims: adjuster queues / status+policy rollups and status+time ranges.
CREATE INDEX IF NOT EXISTS "cl_status_policy_idx"
  ON "claims" ("status", "policyId");
CREATE INDEX IF NOT EXISTS "cl_status_createdAt_idx"
  ON "claims" ("status", "createdAt");

-- transactions: reporting/analytics filter on metadata->>'category' was a
-- full seq scan over the JSON column (expression index; metadata is `json`,
-- ->> works on both json and jsonb).
CREATE INDEX IF NOT EXISTS "tx_metadata_category_idx"
  ON "transactions" ((metadata->>'category'));
