/// Kafka consumer stub — placeholder for future Kafka/Fluvio integration.
/// The primary streaming integration uses Fluvio via the Go infra service.
/// This module provides the Kafka consumer for legacy event bridge compatibility.

pub struct KafkaConsumer {
    pub broker: String,
}

impl KafkaConsumer {
    pub fn new(broker: &str) -> Self {
        Self { broker: broker.to_string() }
    }

    pub fn health(&self) -> &'static str {
        "ok"
    }
}
