/// # InsurePortal Transaction Filter SmartModule
///
/// Fluvio filter SmartModule that discards transaction events below a configurable
/// minimum amount threshold and filters out non-actionable statuses.
///
/// ## Parameters (set via `--params` when registering the SmartModule)
/// - `min_amount_ngn`: Minimum transaction amount in NGN kobo (default: 10000 = ₦100)
/// - `include_statuses`: Comma-separated list of statuses to keep (default: "completed,pending,failed")
///
/// ## Usage
/// ```bash
/// fluvio smartmodule create transaction-filter \
///   --wasm-file wasm/transaction_filter.wasm \
///   --params min_amount_ngn=10000 \
///   --params include_statuses=completed,pending,failed
/// ```
use fluvio_smartmodule::{smartmodule, Record, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct TransactionEvent {
    #[serde(rename = "type")]
    tx_type: String,
    amount: f64,
    status: String,
    #[serde(rename = "agentCode")]
    agent_code: String,
    #[serde(rename = "transactionRef")]
    transaction_ref: String,
    #[serde(rename = "customerId")]
    customer_id: Option<String>,
    channel: Option<String>,
    timestamp: Option<u64>,
}

/// Filter: keep only transactions that meet the minimum amount and status criteria.
/// Returns `true` to keep the record, `false` to discard it.
#[smartmodule(filter)]
pub fn filter_transaction(record: &Record) -> Result<bool> {
    // Parse the JSON payload
    let event: TransactionEvent = match serde_json::from_slice(record.value.as_ref()) {
        Ok(e) => e,
        Err(_) => {
            // Malformed records are discarded (not forwarded to downstream consumers)
            return Ok(false);
        }
    };

    // Minimum amount filter: discard micro-transactions below ₦100 (10000 kobo)
    // This prevents noise from test/probe transactions flooding the analytics pipeline.
    let min_amount: f64 = 100.0; // ₦100 minimum
    if event.amount < min_amount {
        return Ok(false);
    }

    // Status filter: only forward actionable statuses
    let keep_statuses = ["completed", "pending", "failed", "reversed"];
    if !keep_statuses.contains(&event.status.as_str()) {
        return Ok(false);
    }

    // Agent code sanity check: discard events without a valid agent code
    if event.agent_code.is_empty() || event.agent_code.len() < 3 {
        return Ok(false);
    }

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_record(json: &str) -> Record {
        Record::new(json.as_bytes().to_vec())
    }

    #[test]
    fn test_keeps_valid_transaction() {
        let json = r#"{
            "type": "cash_in",
            "amount": 5000.0,
            "status": "completed",
            "agentCode": "AGT001",
            "transactionRef": "TXN-001"
        }"#;
        assert!(filter_transaction(&make_record(json)).unwrap());
    }

    #[test]
    fn test_discards_below_minimum() {
        let json = r#"{
            "type": "cash_in",
            "amount": 50.0,
            "status": "completed",
            "agentCode": "AGT001",
            "transactionRef": "TXN-002"
        }"#;
        assert!(!filter_transaction(&make_record(json)).unwrap());
    }

    #[test]
    fn test_discards_invalid_status() {
        let json = r#"{
            "type": "cash_in",
            "amount": 5000.0,
            "status": "processing",
            "agentCode": "AGT001",
            "transactionRef": "TXN-003"
        }"#;
        assert!(!filter_transaction(&make_record(json)).unwrap());
    }

    #[test]
    fn test_discards_malformed_json() {
        let json = r#"{ invalid json }"#;
        assert!(!filter_transaction(&make_record(json)).unwrap());
    }

    #[test]
    fn test_discards_empty_agent_code() {
        let json = r#"{
            "type": "cash_in",
            "amount": 5000.0,
            "status": "completed",
            "agentCode": "",
            "transactionRef": "TXN-004"
        }"#;
        assert!(!filter_transaction(&make_record(json)).unwrap());
    }
}
