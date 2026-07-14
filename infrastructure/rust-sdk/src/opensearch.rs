//! OpenSearch client with bulk indexing, ILM, audit trail, and compliance reporting.

use reqwest::Client;
use serde_json::json;
use std::time::Duration;

pub const PLATFORM_INDICES: &[&str] = &[
    "audit-trail", "kyc-events", "compliance", "metrics",
    "policies", "claims", "payments", "fraud-alerts", "security-events",
];

pub struct OpenSearchClient {
    base_url: String,
    client: Client,
}

impl OpenSearchClient {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.to_string(),
            client: Client::builder().timeout(Duration::from_secs(10)).build().unwrap_or_default(),
        }
    }

    pub async fn ping(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.client.get(format!("{}/_cluster/health", self.base_url)).send().await?;
        Ok(())
    }

    pub async fn setup_platform_indices(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        for idx in PLATFORM_INDICES {
            self.create_index(idx).await?;
        }
        self.create_ilm_policy().await?;
        Ok(())
    }

    pub async fn create_index(&self, name: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let body = json!({
            "settings": { "number_of_shards": 1, "number_of_replicas": 1 },
            "mappings": { "properties": {
                "timestamp": { "type": "date" }, "service": { "type": "keyword" },
                "action": { "type": "keyword" }, "entity_type": { "type": "keyword" },
                "entity_id": { "type": "keyword" }, "user_id": { "type": "keyword" },
                "details": { "type": "object", "enabled": true }, "severity": { "type": "keyword" },
            }},
        });
        self.client.put(format!("{}/{}", self.base_url, name)).json(&body).send().await?;
        Ok(())
    }

    pub async fn create_ilm_policy(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let body = json!({
            "policy": { "description": "NGApp data retention", "default_state": "hot",
                "states": [
                    { "name": "hot", "actions": [], "transitions": [{ "state_name": "warm", "conditions": { "min_index_age": "30d" } }] },
                    { "name": "warm", "actions": [{ "replica_count": { "number_of_replicas": 0 } }], "transitions": [{ "state_name": "delete", "conditions": { "min_index_age": "365d" } }] },
                    { "name": "delete", "actions": [{ "delete": {} }], "transitions": [] },
                ],
            },
        });
        self.client.put(format!("{}/_plugins/_ism/policies/ngapp-retention", self.base_url))
            .json(&body).send().await?;
        Ok(())
    }

    pub async fn index_document(&self, index: &str, id: &str, doc: &serde_json::Value) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.client.put(format!("{}/{}/_doc/{}", self.base_url, index, id))
            .json(doc).send().await?;
        Ok(())
    }

    pub async fn bulk_index(&self, index: &str, docs: &[(&str, serde_json::Value)]) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut body = String::new();
        for (id, doc) in docs {
            body.push_str(&serde_json::to_string(&json!({ "index": { "_index": index, "_id": id } }))?);
            body.push('\n');
            body.push_str(&serde_json::to_string(doc)?);
            body.push('\n');
        }
        self.client.post(format!("{}/_bulk", self.base_url))
            .header("Content-Type", "application/x-ndjson")
            .body(body).send().await?;
        Ok(())
    }

    pub async fn index_audit(&self, service: &str, action: &str, entity_type: &str, entity_id: &str, user_id: &str, details: &serde_json::Value) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
        let id = format!("{}-{}-{}", service, now, rand_suffix());
        let doc = json!({ "timestamp": format!("{}", now), "service": service, "action": action, "entity_type": entity_type, "entity_id": entity_id, "user_id": user_id, "details": details });
        self.index_document("audit-trail", &id, &doc).await
    }

    pub async fn search(&self, index: &str, query: &serde_json::Value, size: u32, from: u32) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        let body = json!({ "query": query, "size": size, "from": from, "sort": [{ "timestamp": { "order": "desc" } }] });
        let resp = self.client.post(format!("{}/{}/_search", self.base_url, index))
            .json(&body).send().await?;
        Ok(resp.json().await?)
    }
}

fn rand_suffix() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    std::time::SystemTime::now().hash(&mut hasher);
    format!("{:x}", hasher.finish() & 0xFFFFFF)
}
