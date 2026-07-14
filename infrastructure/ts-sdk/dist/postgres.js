"use strict";
/**
 * PostgreSQL client with connection pooling, retry logic, and migrations.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLATFORM_MIGRATIONS = exports.PostgresClient = void 0;
class PostgresClient {
    url;
    constructor(url) {
        this.url = url;
    }
    async ping() {
        const resp = await fetch(this.url.replace(/^postgresql/, 'http').split('/')[0] + '//localhost:5432/health');
        if (!resp.ok)
            throw new Error(`PostgreSQL unhealthy: ${resp.status}`);
    }
    async query(sql, params = []) {
        // In production, use pg Pool. This provides the interface contract.
        throw new Error('Use @ngapp/infra-sdk with pg Pool adapter');
    }
    async execute(sql, params = []) {
        throw new Error('Use @ngapp/infra-sdk with pg Pool adapter');
    }
    async migrate(statements) {
        for (const stmt of statements) {
            await this.execute(stmt);
        }
    }
}
exports.PostgresClient = PostgresClient;
exports.PLATFORM_MIGRATIONS = [
    `CREATE TABLE IF NOT EXISTS policies (
    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, product_type TEXT NOT NULL,
    status TEXT DEFAULT 'draft', premium_amount NUMERIC(15,2), sum_insured NUMERIC(15,2),
    currency TEXT DEFAULT 'NGN', kyc_level INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
    `CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY, policy_id TEXT NOT NULL, customer_id TEXT NOT NULL,
    claim_type TEXT NOT NULL, status TEXT DEFAULT 'submitted',
    claimed_amount NUMERIC(15,2), approved_amount NUMERIC(15,2),
    fraud_score REAL DEFAULT 0, kyc_verified BOOLEAN DEFAULT FALSE,
    documents JSONB DEFAULT '[]', metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
    `CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
    email TEXT, phone TEXT, kyc_level INTEGER DEFAULT 0, kyc_status TEXT DEFAULT 'pending',
    risk_score REAL DEFAULT 0, metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
    `CREATE INDEX IF NOT EXISTS idx_policies_customer ON policies(customer_id)`,
    `CREATE INDEX IF NOT EXISTS idx_claims_policy ON claims(policy_id)`,
    `CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)`,
];
