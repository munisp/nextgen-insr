-- Migration 001: Initial schema tracking
-- This migration creates the migrations tracking table itself

CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  applied_at TIMESTAMP DEFAULT NOW(),
  checksum VARCHAR(64)
);

-- Record this migration
INSERT INTO _migrations (name, checksum) VALUES ('001_initial_schema', 'initial')
ON CONFLICT (name) DO NOTHING;
