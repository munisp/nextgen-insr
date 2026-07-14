/// Kafka producer for publishing ledger events to the event bus
/// Used by downstream services (fraud detection, analytics, notifications)

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct LedgerEvent {
    pub event_type: LedgerEventType,
    pub transfer_id: String,
    pub from_account: String,
    pub to_account: String,
    pub amount: f64,
    pub currency: String,
    pub metadata: serde_json::Value,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LedgerEventType {
    TransferCompleted,
    TransferFailed,
    AccountCreated,
    BalanceThresholdReached,
    ReconciliationCompleted,
    SuspiciousActivity,
}

/// Kafka topics for ledger events
pub mod topics {
    pub const TRANSFERS: &str = "ledger.transfers";
    pub const ACCOUNTS: &str = "ledger.accounts";
    pub const ALERTS: &str = "ledger.alerts";
    pub const RECONCILIATION: &str = "ledger.reconciliation";
    pub const FRAUD_SIGNALS: &str = "ledger.fraud-signals";
}

/// Configuration for Kafka producer
pub struct KafkaProducerConfig {
    pub brokers: String,
    pub client_id: String,
    pub acks: String,
    pub retries: u32,
    pub batch_size: usize,
    pub linger_ms: u64,
}

impl Default for KafkaProducerConfig {
    fn default() -> Self {
        Self {
            brokers: std::env::var("KAFKA_BROKERS").unwrap_or_else(|_| "localhost:9092".to_string()),
            client_id: "ledger-sidecar".to_string(),
            acks: "all".to_string(),
            retries: 3,
            batch_size: 16384,
            linger_ms: 5,
        }
    }
}
