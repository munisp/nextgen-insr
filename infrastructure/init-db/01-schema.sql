-- NGApp Insurance Platform — Database Schema
-- Consolidated schema for all service groups

-- Core: Customers
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id VARCHAR(64) UNIQUE,
    first_name VARCHAR(128) NOT NULL,
    last_name VARCHAR(128) NOT NULL,
    email VARCHAR(256),
    phone VARCHAR(32),
    kyc_status VARCHAR(32) DEFAULT 'pending',
    kyc_level INT DEFAULT 0,
    risk_score DECIMAL(5,4),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Core: Policies
CREATE TABLE IF NOT EXISTS policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_number VARCHAR(64) UNIQUE NOT NULL,
    customer_id UUID REFERENCES customers(id),
    product_type VARCHAR(64) NOT NULL,
    status VARCHAR(32) DEFAULT 'draft',
    premium_amount DECIMAL(18,2),
    coverage_limit DECIMAL(18,2),
    currency VARCHAR(3) DEFAULT 'NGN',
    start_date DATE,
    end_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Core: Claims
CREATE TABLE IF NOT EXISTS claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_number VARCHAR(64) UNIQUE NOT NULL,
    policy_id UUID REFERENCES policies(id),
    customer_id UUID REFERENCES customers(id),
    status VARCHAR(32) DEFAULT 'submitted',
    claim_amount DECIMAL(18,2),
    approved_amount DECIMAL(18,2),
    currency VARCHAR(3) DEFAULT 'NGN',
    description TEXT,
    fraud_score DECIMAL(5,4),
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- KYC: Verifications
CREATE TABLE IF NOT EXISTS kyc_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES customers(id),
    verification_type VARCHAR(32) NOT NULL,
    status VARCHAR(32) DEFAULT 'pending',
    provider VARCHAR(64),
    confidence DECIMAL(5,4),
    result JSONB,
    document_type VARCHAR(64),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- KYC: KYB Entities
CREATE TABLE IF NOT EXISTS kyb_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_name VARCHAR(256) NOT NULL,
    registration_number VARCHAR(128),
    entity_type VARCHAR(64),
    status VARCHAR(32) DEFAULT 'pending',
    risk_level VARCHAR(32),
    country VARCHAR(3),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Financial: Payments
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference VARCHAR(64) UNIQUE NOT NULL,
    customer_id UUID REFERENCES customers(id),
    policy_id UUID REFERENCES policies(id),
    amount DECIMAL(18,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'NGN',
    method VARCHAR(32),
    provider VARCHAR(64),
    status VARCHAR(32) DEFAULT 'pending',
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Financial: Premium Finance Plans
CREATE TABLE IF NOT EXISTS premium_finance_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id UUID REFERENCES policies(id),
    total_premium DECIMAL(18,2),
    installments INT,
    interest_rate DECIMAL(5,4),
    next_due_date DATE,
    status VARCHAR(32) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Compliance: Audit Trail
CREATE TABLE IF NOT EXISTS audit_trail (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action VARCHAR(128) NOT NULL,
    actor VARCHAR(256) NOT NULL,
    resource_type VARCHAR(64),
    resource_id VARCHAR(256),
    details JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_trail_action ON audit_trail(action);
CREATE INDEX IF NOT EXISTS idx_audit_trail_actor ON audit_trail(actor);
CREATE INDEX IF NOT EXISTS idx_audit_trail_created_at ON audit_trail(created_at);

-- Compliance: NDPR Consent
CREATE TABLE IF NOT EXISTS ndpr_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES customers(id),
    purpose VARCHAR(256) NOT NULL,
    granted BOOLEAN DEFAULT false,
    granted_at TIMESTAMPTZ,
    withdrawn_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Communication: Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES customers(id),
    template_id VARCHAR(64),
    channel VARCHAR(32) NOT NULL,
    status VARCHAR(32) DEFAULT 'queued',
    content TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI/ML: Model Registry
CREATE TABLE IF NOT EXISTS ml_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(128) NOT NULL,
    version VARCHAR(32) NOT NULL,
    framework VARCHAR(64),
    accuracy DECIMAL(5,4),
    status VARCHAR(32) DEFAULT 'staging',
    artifact_path VARCHAR(512),
    metadata JSONB,
    trained_at TIMESTAMPTZ,
    deployed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(name, version)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_customers_kyc_status ON customers(kyc_status);
CREATE INDEX IF NOT EXISTS idx_policies_status ON policies(status);
CREATE INDEX IF NOT EXISTS idx_policies_customer ON policies(customer_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_policy ON claims(policy_id);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_customer ON kyc_verifications(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_notifications_customer ON notifications(customer_id);
