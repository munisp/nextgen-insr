//! Dapr client with state management, pub/sub, service invocation, and secrets.

use reqwest::Client;
use serde_json::json;
use std::time::Duration;

pub struct DaprClient {
    base_url: String,
    state_store: String,
    pubsub_name: String,
    client: Client,
}

impl DaprClient {
    pub fn new(http_port: u16) -> Self {
        Self {
            base_url: format!("http://localhost:{}/v1.0", http_port),
            state_store: "statestore".to_string(),
            pubsub_name: "pubsub".to_string(),
            client: Client::builder().timeout(Duration::from_secs(5)).build().unwrap_or_default(),
        }
    }

    pub async fn ping(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.client.get(format!("{}/healthz", self.base_url)).send().await?;
        Ok(())
    }

    pub async fn save_state(&self, key: &str, value: &serde_json::Value, etag: Option<&str>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut item = json!({ "key": key, "value": value, "options": { "concurrency": "first-write", "consistency": "strong" } });
        if let Some(e) = etag { item["etag"] = json!(e); }
        self.client.post(format!("{}/state/{}", self.base_url, self.state_store))
            .json(&json!([item])).send().await?;
        Ok(())
    }

    pub async fn get_state(&self, key: &str) -> Result<(Option<serde_json::Value>, String), Box<dyn std::error::Error + Send + Sync>> {
        let resp = self.client.get(format!("{}/state/{}/{}", self.base_url, self.state_store, key)).send().await?;
        if !resp.status().is_success() { return Ok((None, String::new())); }
        let etag = resp.headers().get("ETag").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        let value: serde_json::Value = resp.json().await?;
        Ok((Some(value), etag))
    }

    pub async fn delete_state(&self, key: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.client.delete(format!("{}/state/{}/{}", self.base_url, self.state_store, key)).send().await?;
        Ok(())
    }

    pub async fn publish_event(&self, topic: &str, data: &serde_json::Value) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.client.post(format!("{}/publish/{}/{}", self.base_url, self.pubsub_name, topic))
            .json(data).send().await?;
        Ok(())
    }

    pub async fn invoke_service(&self, app_id: &str, method: &str, data: Option<&serde_json::Value>, http_method: &str) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("{}/invoke/{}/method/{}", self.base_url, app_id, method);
        let resp = match http_method {
            "GET" => self.client.get(&url).send().await?,
            "PUT" => self.client.put(&url).json(&data.unwrap_or(&json!({}))).send().await?,
            "DELETE" => self.client.delete(&url).send().await?,
            _ => self.client.post(&url).json(&data.unwrap_or(&json!({}))).send().await?,
        };
        if !resp.status().is_success() {
            return Err(format!("Service invoke failed ({})", resp.status()).into());
        }
        let text = resp.text().await?;
        if text.is_empty() { return Ok(json!(null)); }
        Ok(serde_json::from_str(&text)?)
    }

    pub async fn get_secret(&self, secret_store: &str, secret_name: &str) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        let resp = self.client.get(format!("{}/secrets/{}/{}", self.base_url, secret_store, secret_name)).send().await?;
        if !resp.status().is_success() {
            return Err(format!("Secret retrieval failed ({})", resp.status()).into());
        }
        Ok(resp.json().await?)
    }

    pub async fn save_kyc_session(&self, session_id: &str, data: &serde_json::Value) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
        let mut val = data.clone();
        if let Some(obj) = val.as_object_mut() { obj.insert("updated_at".into(), json!(now)); }
        self.save_state(&format!("kyc:session:{}", session_id), &val, None).await
    }

    pub async fn get_kyc_session(&self, session_id: &str) -> Result<Option<serde_json::Value>, Box<dyn std::error::Error + Send + Sync>> {
        let (value, _) = self.get_state(&format!("kyc:session:{}", session_id)).await?;
        Ok(value)
    }

    pub async fn publish_kyc_event(&self, event_type: &str, customer_id: &str, data: &serde_json::Value) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
        self.publish_event("kyc-events", &json!({ "event_type": event_type, "customer_id": customer_id, "data": data, "timestamp": now })).await
    }

    pub async fn save_policy_state(&self, policy_id: &str, state: &serde_json::Value) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.save_state(&format!("policy:{}", policy_id), state, None).await
    }

    pub async fn save_claim_state(&self, claim_id: &str, state: &serde_json::Value) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.save_state(&format!("claim:{}", claim_id), state, None).await
    }
}
