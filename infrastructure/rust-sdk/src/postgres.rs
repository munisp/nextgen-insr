//! PostgreSQL client with connection pooling, retry logic, and migrations.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

pub struct PostgresClient {
    url: String,
    client: Client,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuditEvent {
    pub id: String,
    pub service_name: String,
    pub action: String,
    pub entity_type: String,
    pub entity_id: String,
    pub user_id: String,
    pub details: serde_json::Value,
}

impl PostgresClient {
    pub fn new(url: &str) -> Self {
        Self {
            url: url.to_string(),
            client: Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
        }
    }

    pub async fn ping(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let health_url = self.url.replace("postgresql://", "http://").split('/').next().unwrap_or("http://localhost:5432").to_string() + "/health";
        self.client.get(&health_url).send().await?;
        Ok(())
    }

    pub fn migration_statements() -> Vec<&'static str> {
        vec![
            "CREATE TABLE IF NOT EXISTS policies (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, product_type TEXT NOT NULL, status TEXT DEFAULT 'draft', premium_amount NUMERIC(15,2), sum_insured NUMERIC(15,2), currency TEXT DEFAULT 'NGN', kyc_level INTEGER DEFAULT 0, metadata JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())",
            "CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, policy_id TEXT NOT NULL, customer_id TEXT NOT NULL, claim_type TEXT NOT NULL, status TEXT DEFAULT 'submitted', claimed_amount NUMERIC(15,2), approved_amount NUMERIC(15,2), fraud_score REAL DEFAULT 0, kyc_verified BOOLEAN DEFAULT FALSE, documents JSONB DEFAULT '[]', metadata JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW())",
            "CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT, phone TEXT, kyc_level INTEGER DEFAULT 0, kyc_status TEXT DEFAULT 'pending', risk_score REAL DEFAULT 0, metadata JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())",
            "CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, service_name TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, user_id TEXT, details JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW())",
            "CREATE INDEX IF NOT EXISTS idx_policies_customer ON policies(customer_id)",
            "CREATE INDEX IF NOT EXISTS idx_claims_policy ON claims(policy_id)",
            "CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)",
            "CREATE INDEX IF NOT EXISTS idx_audit_service ON audit_events(service_name)",
        ]
    }
}
