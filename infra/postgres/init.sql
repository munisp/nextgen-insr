-- ─────────────────────────────────────────────────────────────────────────────
-- InsurePortal Insurance Platform — PostgreSQL Initialisation
-- Runs once on first container start (docker-entrypoint-initdb.d)
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Create application schemas
CREATE SCHEMA IF NOT EXISTS insurance;
CREATE SCHEMA IF NOT EXISTS ledger;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS temporal;

-- Grant privileges to application user (already created by POSTGRES_USER env)
GRANT ALL PRIVILEGES ON DATABASE "insureportal" TO "insureportal";
GRANT ALL PRIVILEGES ON SCHEMA insurance TO "insureportal";
GRANT ALL PRIVILEGES ON SCHEMA ledger TO "insureportal";
GRANT ALL PRIVILEGES ON SCHEMA audit TO "insureportal";
GRANT ALL PRIVILEGES ON SCHEMA temporal TO "insureportal";

-- Performance settings (applied at session level for init)
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET work_mem = '16MB';
ALTER SYSTEM SET maintenance_work_mem = '128MB';
ALTER SYSTEM SET wal_level = 'replica';
ALTER SYSTEM SET max_wal_senders = 3;
ALTER SYSTEM SET wal_keep_size = '256MB';
ALTER SYSTEM SET log_min_duration_statement = 1000;
ALTER SYSTEM SET log_checkpoints = on;
ALTER SYSTEM SET log_connections = on;
ALTER SYSTEM SET log_disconnections = on;
ALTER SYSTEM SET log_lock_waits = on;
ALTER SYSTEM SET deadlock_timeout = '1s';

SELECT pg_reload_conf();
