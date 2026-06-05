-- Migration 002: Add multi-tenancy columns to core tables

ALTER TABLE users ADD COLUMN IF NOT EXISTS "tenantId" VARCHAR(50) DEFAULT 'default';
ALTER TABLE policies ADD COLUMN IF NOT EXISTS "tenantId" VARCHAR(50) DEFAULT 'default';
ALTER TABLE claims ADD COLUMN IF NOT EXISTS "tenantId" VARCHAR(50) DEFAULT 'default';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS "tenantId" VARCHAR(50) DEFAULT 'default';

-- Add insurance-specific columns to existing tenants table
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS domain VARCHAR(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users("tenantId");
CREATE INDEX IF NOT EXISTS idx_policies_tenant ON policies("tenantId");
CREATE INDEX IF NOT EXISTS idx_claims_tenant ON claims("tenantId");
CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments("tenantId");

INSERT INTO _migrations (name, checksum) VALUES ('002_add_tenant_columns', 'tenant_v2')
ON CONFLICT (name) DO NOTHING;
