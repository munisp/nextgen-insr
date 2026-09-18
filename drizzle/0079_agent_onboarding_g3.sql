-- 0079 G3 (agent-onboarding audit): uniqueness + pending-by-default for agents.
-- Applied via scripts/db-migrate-safe.sh step 4b (schema_migrations_ext ledger).
--
-- (a) Audit #1: agents.isActive defaulted to true, so every unhardened insert
--     path (public register, journey activities) produced an instantly ACTIVE
--     agent. Pending is now the DB default; activation is an explicit gated
--     decision (server/lib/agentLifecycle.ts assertAgentActivationEligible).
ALTER TABLE "agents" ALTER COLUMN "isActive" SET DEFAULT false;

-- (b) Audit #26: one agent identity per MSISDN. Phone is the USSD identity;
--     duplicates allowed two agent identities per person. NULLs excluded
--     (phone is NOT NULL in the model, but be safe).
CREATE UNIQUE INDEX IF NOT EXISTS "agents_phone_unique"
  ON "agents" ("phone")
  WHERE "deletedAt" IS NULL;

-- (c) Audit #6/#29: terminal serials are device identities and must be
--     unique. Partial unique index (multiple unassigned NULL serials allowed).
CREATE UNIQUE INDEX IF NOT EXISTS "agents_terminal_serial_unique"
  ON "agents" ("terminalSerial")
  WHERE "terminalSerial" IS NOT NULL;

-- (d) Audit #22: one onboarding-progress row per agent code (was a plain
--     index; check-then-insert raced and the CONFLICT guard compared the
--     wrong keyspace).
CREATE UNIQUE INDEX IF NOT EXISTS "agent_onboarding_progress_agentId_unique"
  ON "agent_onboarding_progress" ("agentId");

-- (e) Audit #21/#29: POS terminal serial numbers must be unique devices.
CREATE UNIQUE INDEX IF NOT EXISTS "pos_terminals_serial_unique"
  ON "pos_terminals" ("serialNumber");

-- NOTE for operators: if production data already contains duplicate phones,
-- serials, or progress rows, the CREATE INDEX above fails LOUDLY (desired —
-- fail-closed). Deduplicate first, e.g. keep the lowest id per phone:
--   DELETE FROM agents a USING agents b
--   WHERE a.phone = b.phone AND a.id > b.id AND a."deletedAt" IS NULL AND b."deletedAt" IS NULL;
