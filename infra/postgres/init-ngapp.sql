-- ─────────────────────────────────────────────────────────────────────────────
-- NGApp Platform — PostgreSQL Initialisation (all microservices)
-- Runs on first container start (docker-entrypoint-initdb.d)
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Create application schemas for microservices
CREATE SCHEMA IF NOT EXISTS ngapp_core;       -- Core platform entities
CREATE SCHEMA IF NOT EXISTS claims;           -- Claims adjudication
CREATE SCHEMA IF NOT EXISTS fraud;            -- Fraud detection
CREATE SCHEMA IF NOT EXISTS kyc;              -- KYC/KYB verification
CREATE SCHEMA IF NOT EXISTS policies;         -- Policy management
CREATE SCHEMA IF NOT EXISTS payments;         -- Premium & collections
CREATE SCHEMA IF NOT EXISTS notifications;    -- Notification service
CREATE SCHEMA IF NOT EXISTS udt;              -- User defined types
CREATE SCHEMA IF NOT EXISTS audit;            -- Audit logging
CREATE SCHEMA IF NOT EXISTS temporal;         -- Temporal workflow state

-- Grant privileges
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ngapp') THEN
        CREATE ROLE ngapp WITH LOGIN PASSWORD 'CHANGE_ME_IN_PRODUCTION';
    END IF;
END $$;

GRANT CONNECT ON DATABASE "ngapp_staging" TO ngapp;
GRANT USAGE ON SCHEMA ngapp_core TO ngapp;
GRANT USAGE ON SCHEMA claims TO ngapp;
GRANT USAGE ON SCHEMA fraud TO ngapp;
GRANT USAGE ON SCHEMA kyc TO ngapp;
GRANT USAGE ON SCHEMA policies TO ngapp;
GRANT USAGE ON SCHEMA payments TO ngapp;
GRANT USAGE ON SCHEMA notifications TO ngapp;
GRANT USAGE ON SCHEMA audit TO ngapp;
GRANT USAGE ON SCHEMA temporal TO ngapp;
GRANT CREATE ON SCHEMA ngapp_core TO ngapp;
GRANT CREATE ON SCHEMA claims TO ngapp;
GRANT CREATE ON SCHEMA fraud TO ngapp;
GRANT CREATE ON SCHEMA kyc TO ngapp;
GRANT CREATE ON SCHEMA policies TO ngapp;
GRANT CREATE ON SCHEMA payments TO ngapp;
GRANT CREATE ON SCHEMA notifications TO ngapp;

-- Performance settings
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
ALTER SYSTEM SET max_connections = 300;
ALTER SYSTEM SET shared_buffers = '512MB';
ALTER SYSTEM SET effective_cache_size = '2GB';
ALTER SYSTEM SET work_mem = '32MB';
ALTER SYSTEM SET maintenance_work_mem = '256MB';
ALTER SYSTEM SET wal_level = 'replica';
ALTER SYSTEM SET max_wal_senders = 5;
ALTER SYSTEM SET wal_keep_size = '512MB';
ALTER SYSTEM SET log_min_duration_statement = 1000;
ALTER SYSTEM SET log_checkpoints = on;
ALTER SYSTEM SET log_connections = on;
ALTER SYSTEM SET log_disconnections = on;
ALTER SYSTEM SET log_lock_waits = on;
ALTER SYSTEM SET deadlock_timeout = '1s';
ALTER SYSTEM SET max_parallel_workers_per_gather = 4;
ALTER SYSTEM SET max_parallel_workers = 8;

SELECT pg_reload_conf();
