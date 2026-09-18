-- 0080 G3 (agent-onboarding audit #30): one PENDING float top-up request per
-- agent, enforced by the database (the app-layer check-then-insert in
-- agentManagement.submitTopUpRequest was racy even with the new advisory
-- lock; this partial unique index is the durable backstop).
-- Applied via scripts/db-migrate-safe.sh step 4b (schema_migrations_ext ledger).
CREATE UNIQUE INDEX IF NOT EXISTS "float_topup_requests_one_pending_per_agent"
  ON "float_topup_requests" ("agentId")
  WHERE "status" = 'pending';

-- NOTE: fails loudly if duplicate pending rows already exist; resolve them
-- (approve/reject all but the newest per agent) before re-running.
