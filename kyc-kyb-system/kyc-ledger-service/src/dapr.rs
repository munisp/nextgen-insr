use serde::{Deserialize, Serialize, de::DeserializeOwned};
use reqwest::Client;

pub struct DaprClient {
    base_url: String,
    client: Client,
}

impl DaprClient {
    pub fn new(dapr_port: &str) -> Self {
        Self {
            base_url: format!("http://localhost:{}", dapr_port),
            client: Client::new(),
        }
    }

    pub fn is_connected(&self) -> bool {
        true
    }

    pub async fn save_state<T: Serialize>(&self, store_name: &str, key: &str, value: &T) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("{}/v1.0/state/{}", self.base_url, store_name);
        let payload = serde_json::json!([{
            "key": key,
            "value": value,
        }]);

        let resp = self.client.post(&url).json(&payload).send().await;
        match resp {
            Ok(r) if r.status().is_success() => {
                tracing::info!(store = store_name, key = key, "dapr_state_saved");
                Ok(())
            }
            Ok(r) => {
                tracing::warn!(status = %r.status(), "dapr_state_save_warning");
                Ok(())
            }
            Err(e) => {
                tracing::debug!(error = %e, "dapr_not_available");
                Ok(())
            }
        }
    }

    pub async fn get_state<T: DeserializeOwned>(&self, store_name: &str, key: &str) -> Result<Option<T>, Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("{}/v1.0/state/{}/{}", self.base_url, store_name, key);
        let resp = self.client.get(&url).send().await;

        match resp {
            Ok(r) if r.status().is_success() => {
                match r.json::<T>().await {
                    Ok(val) => Ok(Some(val)),
                    Err(_) => Ok(None),
                }
            }
            _ => Ok(None),
        }
    }

    pub async fn delete_state(&self, store_name: &str, key: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("{}/v1.0/state/{}/{}", self.base_url, store_name, key);
        let _ = self.client.delete(&url).send().await;
        Ok(())
    }

    pub async fn publish_event<T: Serialize>(&self, pubsub_name: &str, topic: &str, data: &T) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("{}/v1.0/publish/{}/{}", self.base_url, pubsub_name, topic);
        let resp = self.client.post(&url)
            .header("Content-Type", "application/json")
            .json(data)
            .send()
            .await;

        match resp {
            Ok(r) if r.status().is_success() => {
                tracing::info!(pubsub = pubsub_name, topic = topic, "dapr_event_published");
                Ok(())
            }
            Ok(r) => {
                tracing::warn!(status = %r.status(), "dapr_publish_warning");
                Ok(())
            }
            Err(e) => {
                tracing::debug!(error = %e, "dapr_pubsub_not_available");
                Ok(())
            }
        }
    }

    pub async fn invoke_service(&self, app_id: &str, method: &str, data: &serde_json::Value) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("{}/v1.0/invoke/{}/method/{}", self.base_url, app_id, method);
        let resp = self.client.post(&url).json(data).send().await?;

        if resp.status().is_success() {
            Ok(resp.json().await?)
        } else {
            Err(format!("Dapr invoke failed: {}", resp.status()).into())
        }
    }

    pub async fn get_secret(&self, store_name: &str, key: &str) -> Result<Option<String>, Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("{}/v1.0/secrets/{}/{}", self.base_url, store_name, key);
        let resp = self.client.get(&url).send().await;

        match resp {
            Ok(r) if r.status().is_success() => {
                let secrets: std::collections::HashMap<String, String> = r.json().await?;
                Ok(secrets.get(key).cloned())
            }
            _ => Ok(None),
        }
    }

    pub async fn check_kyc_gate(&self, user_id: &str) -> Result<(bool, u8), Box<dyn std::error::Error + Send + Sync>> {
        let result = self.invoke_service(
            "kyc-orchestrator",
            &format!("api/v1/kyc/gate/{}", user_id),
            &serde_json::json!({}),
        ).await;

        match result {
            Ok(data) => {
                let allowed = data.get("allowed").and_then(|v| v.as_bool()).unwrap_or(false);
                let level = data.get("level").and_then(|v| v.as_u64()).unwrap_or(0) as u8;
                Ok((allowed, level))
            }
            Err(_) => Ok((false, 0)),
        }
    }
}
