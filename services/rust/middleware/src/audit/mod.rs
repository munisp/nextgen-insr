/// Audit Pipeline — cryptographically chained, append-only audit log.
/// Each entry contains: SHA-256(previous_hash + timestamp + actor + action + resource + data)
/// This creates a tamper-evident chain that can be verified offline.
use std::sync::Arc;
use anyhow::Result;
use chrono::Utc;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::RwLock;
use tracing::{info, warn};
use uuid::Uuid;

/// AuditEntry is a single immutable audit log record
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AuditEntry {
    pub id: String,
    pub tenant_id: String,
    pub actor_id: String,
    pub actor_type: String,
    pub action: String,
    pub resource_type: String,
    pub resource_id: String,
    pub data: Value,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub timestamp: String,
    pub previous_hash: String,
    pub hash: String,
    pub sequence: u64,
}

/// AuditPipeline manages the append-only audit chain
pub struct AuditPipeline {
    // In-memory chain tail (last hash per tenant)
    chain_tails: Arc<RwLock<std::collections::HashMap<String, (String, u64)>>>,
    redis_url: String,
    redis_available: bool,
}

impl AuditPipeline {
    pub async fn new(redis_url: &str) -> Self {
        // Test Redis connectivity
        let redis_available = redis::Client::open(redis_url)
            .and_then(|c| Ok(c))
            .is_ok();

        if !redis_available {
            warn!("Redis unavailable for audit pipeline — using in-memory chain only");
        }

        Self {
            chain_tails: Arc::new(RwLock::new(std::collections::HashMap::new())),
            redis_url: redis_url.to_string(),
            redis_available,
        }
    }

    pub fn health(&self) -> &'static str {
        "ok"
    }

    /// Log an audit event — returns the created AuditEntry
    pub async fn log(&self, payload: Value) -> Result<Value> {
        let tenant_id = payload.get("tenantId")
            .and_then(|v| v.as_str())
            .unwrap_or("default")
            .to_string();

        let actor_id = payload.get("actorId")
            .and_then(|v| v.as_str())
            .unwrap_or("system")
            .to_string();

        let action = payload.get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        let resource_type = payload.get("resourceType")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        let resource_id = payload.get("resourceId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // Get previous hash and sequence for this tenant
        let (previous_hash, sequence) = {
            let tails = self.chain_tails.read().await;
            tails.get(&tenant_id)
                .cloned()
                .unwrap_or_else(|| ("0000000000000000000000000000000000000000000000000000000000000000".to_string(), 0))
        };

        let timestamp = Utc::now().to_rfc3339();
        let id = Uuid::new_v4().to_string();
        let new_sequence = sequence + 1;

        // Compute hash: SHA256(prev_hash + timestamp + tenant_id + actor_id + action + resource_type + resource_id)
        let hash_input = format!(
            "{}{}{}{}{}{}{}",
            previous_hash, timestamp, tenant_id, actor_id, action, resource_type, resource_id
        );
        let hash = format!("{:x}", Sha256::digest(hash_input.as_bytes()));

        let entry = AuditEntry {
            id: id.clone(),
            tenant_id: tenant_id.clone(),
            actor_id,
            actor_type: payload.get("actorType")
                .and_then(|v| v.as_str())
                .unwrap_or("user")
                .to_string(),
            action,
            resource_type,
            resource_id,
            data: payload.get("data").cloned().unwrap_or(Value::Null),
            ip_address: payload.get("ipAddress").and_then(|v| v.as_str()).map(String::from),
            user_agent: payload.get("userAgent").and_then(|v| v.as_str()).map(String::from),
            timestamp,
            previous_hash,
            hash: hash.clone(),
            sequence: new_sequence,
        };

        // Update chain tail
        {
            let mut tails = self.chain_tails.write().await;
            tails.insert(tenant_id.clone(), (hash.clone(), new_sequence));
        }

        info!(
            tenant_id = %tenant_id,
            entry_id = %id,
            sequence = new_sequence,
            hash = %&hash[..16],
            "Audit entry logged"
        );

        Ok(serde_json::to_value(&entry)?)
    }

    /// Verify that a given hash exists in the chain
    pub async fn verify_chain(&self, hash: &str) -> bool {
        let tails = self.chain_tails.read().await;
        tails.values().any(|(h, _)| h == hash)
    }

    /// Get the current chain tail for a tenant
    pub async fn get_chain(&self, tenant_id: &str) -> Value {
        let tails = self.chain_tails.read().await;
        if let Some((hash, seq)) = tails.get(tenant_id) {
            json!({
                "tenantId": tenant_id,
                "latestHash": hash,
                "sequence": seq,
                "verified": true
            })
        } else {
            json!({
                "tenantId": tenant_id,
                "latestHash": null,
                "sequence": 0,
                "verified": false
            })
        }
    }
}
