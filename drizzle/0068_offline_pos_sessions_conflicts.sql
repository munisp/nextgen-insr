-- F4 audit NG-16: offline POS server-side session ledger, idempotent sync
-- records, and conflict resolution queue (both versions preserved).
CREATE TABLE IF NOT EXISTS offline_sessions (
  id SERIAL PRIMARY KEY,
  "sessionId" varchar(64) NOT NULL UNIQUE,
  "agentId" integer NOT NULL,
  reason varchar(32) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'active',
  "floatSnapshot" numeric(18,2),
  "clientReportedCount" integer,
  "clientReportedAmount" numeric(18,2),
  "serverCount" integer,
  "serverAmount" numeric(18,2),
  "totalsMismatch" boolean NOT NULL DEFAULT false,
  "startedAt" timestamp NOT NULL DEFAULT now(),
  "endedAt" timestamp
);
CREATE INDEX IF NOT EXISTS ofs_agent_idx ON offline_sessions("agentId");
CREATE INDEX IF NOT EXISTS ofs_status_idx ON offline_sessions(status);

CREATE TABLE IF NOT EXISTS offline_sync_records (
  id SERIAL PRIMARY KEY,
  "sessionId" varchar(64) NOT NULL,
  "agentId" integer NOT NULL,
  "clientRecordId" varchar(128) NOT NULL,
  "entityType" varchar(32) NOT NULL,
  "entityId" varchar(128) NOT NULL,
  amount numeric(18,2) NOT NULL DEFAULT 0,
  payload jsonb NOT NULL,
  "payloadHash" varchar(64) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'applied',
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS osr_session_idx ON offline_sync_records("sessionId");
CREATE INDEX IF NOT EXISTS osr_entity_idx ON offline_sync_records("entityType", "entityId");
CREATE UNIQUE INDEX IF NOT EXISTS osr_client_record_uq ON offline_sync_records("sessionId", "clientRecordId");

CREATE TABLE IF NOT EXISTS offline_sync_conflicts (
  id SERIAL PRIMARY KEY,
  "entityType" varchar(32) NOT NULL,
  "entityId" varchar(128) NOT NULL,
  "sessionId" varchar(64) NOT NULL,
  "agentId" integer NOT NULL,
  "localVersion" jsonb NOT NULL,
  "serverVersion" jsonb NOT NULL,
  resolution varchar(32),
  "resolvedBy" varchar(128),
  "resolvedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS osc_pending_idx ON offline_sync_conflicts(resolution);
CREATE INDEX IF NOT EXISTS osc_entity_idx ON offline_sync_conflicts("entityType", "entityId");
