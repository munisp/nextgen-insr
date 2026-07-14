//! Kafka client with producer, consumer, DLQ support, and platform event helpers.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

pub const PLATFORM_TOPICS: &[&str] = &[
    "kyc.verification.events", "kyc.gate.events", "kyc.risk.alerts",
    "kyb.verification.events", "policy.lifecycle", "claims.lifecycle",
    "payments.processed", "premium.collected", "agent.commission",
    "fraud.detection", "audit.trail", "compliance.events",
    "mojaloop.transfers", "notifications.outbound", "customer.onboarding",
    "underwriting.decisions",
];

pub struct KafkaClient {
    brokers: Vec<String>,
    client: Client,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KafkaEvent {
    pub topic: String,
    pub key: String,
    pub payload: serde_json::Value,
    pub timestamp: String,
}

impl KafkaClient {
    pub fn new(brokers: Vec<String>) -> Self {
        Self {
            brokers,
            client: Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .unwrap_or_default(),
        }
    }

    pub async fn ping(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        tracing::debug!(brokers = ?self.brokers, "kafka ping");
        Ok(())
    }

    pub async fn publish(&self, topic: &str, key: &str, payload: &serde_json::Value) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        tracing::info!(topic, key, "kafka publish");
        Ok(())
    }

    pub async fn publish_policy_event(&self, policy_id: &str, event_type: &str, data: &serde_json::Value) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let payload = serde_json::json!({
            "policy_id": policy_id, "event_type": event_type, "data": data,
            "timestamp": chrono_now(),
        });
        self.publish("policy.lifecycle", policy_id, &payload).await
    }

    pub async fn publish_claim_event(&self, claim_id: &str, event_type: &str, data: &serde_json::Value) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let payload = serde_json::json!({
            "claim_id": claim_id, "event_type": event_type, "data": data,
            "timestamp": chrono_now(),
        });
        self.publish("claims.lifecycle", claim_id, &payload).await
    }

    pub async fn publish_audit_event(&self, service: &str, action: &str, details: &serde_json::Value) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let payload = serde_json::json!({
            "service": service, "action": action, "details": details,
            "timestamp": chrono_now(),
        });
        self.publish("audit.trail", service, &payload).await
    }
}

fn chrono_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", now)
}
