/// # InsurePortal Fraud Enricher SmartModule
///
/// Fluvio map SmartModule that enriches raw fraud alert events with:
/// - Computed risk score (0-100) based on amount, velocity, and alert type
/// - Severity classification (low/medium/high/critical)
/// - Recommended action (monitor/review/block/escalate)
/// - Processing timestamp
///
/// ## Usage
/// ```bash
/// fluvio smartmodule create fraud-enricher \
///   --wasm-file wasm/fraud_enricher.wasm \
///   --type map
/// ```
use fluvio_smartmodule::{smartmodule, Record, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct RawFraudAlert {
    id: Option<String>,
    #[serde(rename = "agentCode")]
    agent_code: String,
    #[serde(rename = "alertType")]
    alert_type: String,
    amount: f64,
    #[serde(rename = "customerId")]
    customer_id: Option<String>,
    reason: Option<String>,
    status: Option<String>,
    timestamp: Option<u64>,
}

#[derive(Debug, Serialize)]
struct EnrichedFraudAlert {
    id: Option<String>,
    #[serde(rename = "agentCode")]
    agent_code: String,
    #[serde(rename = "alertType")]
    alert_type: String,
    amount: f64,
    #[serde(rename = "customerId")]
    customer_id: Option<String>,
    reason: Option<String>,
    status: String,
    timestamp: Option<u64>,
    // Enriched fields
    #[serde(rename = "riskScore")]
    risk_score: u8,
    severity: String,
    #[serde(rename = "recommendedAction")]
    recommended_action: String,
    #[serde(rename = "enrichedAt")]
    enriched_at: u64,
    #[serde(rename = "processingNode")]
    processing_node: String,
}

/// Compute a risk score (0-100) based on alert type and amount.
fn compute_risk_score(alert_type: &str, amount: f64) -> u8 {
    let base_score: u8 = match alert_type {
        "velocity_breach" => 70,
        "amount_threshold" => 60,
        "suspicious_pattern" => 75,
        "duplicate_transaction" => 55,
        "geo_anomaly" => 65,
        "device_mismatch" => 80,
        "pin_retry_exceeded" => 85,
        "account_takeover" => 95,
        "money_laundering" => 90,
        _ => 40,
    };

    // Boost score for high amounts
    let amount_boost: u8 = if amount >= 1_000_000.0 {
        15
    } else if amount >= 500_000.0 {
        10
    } else if amount >= 100_000.0 {
        5
    } else {
        0
    };

    base_score.saturating_add(amount_boost).min(100)
}

/// Classify severity from risk score.
fn classify_severity(risk_score: u8) -> &'static str {
    match risk_score {
        90..=100 => "critical",
        70..=89 => "high",
        50..=69 => "medium",
        _ => "low",
    }
}

/// Recommend action based on severity.
fn recommend_action(severity: &str) -> &'static str {
    match severity {
        "critical" => "escalate",
        "high" => "block",
        "medium" => "review",
        _ => "monitor",
    }
}

/// Map: enrich each fraud alert record with computed risk metadata.
#[smartmodule(map)]
pub fn enrich_fraud_alert(record: Record) -> Result<Record> {
    let raw: RawFraudAlert = match serde_json::from_slice(record.value.as_ref()) {
        Ok(r) => r,
        Err(e) => {
            // Return the original record unchanged if parsing fails
            return Ok(record);
        }
    };

    let risk_score = compute_risk_score(&raw.alert_type, raw.amount);
    let severity = classify_severity(risk_score);
    let recommended_action = recommend_action(severity);

    let enriched = EnrichedFraudAlert {
        id: raw.id,
        agent_code: raw.agent_code,
        alert_type: raw.alert_type,
        amount: raw.amount,
        customer_id: raw.customer_id,
        reason: raw.reason,
        status: raw.status.unwrap_or_else(|| "open".to_string()),
        timestamp: raw.timestamp,
        risk_score,
        severity: severity.to_string(),
        recommended_action: recommended_action.to_string(),
        enriched_at: 0, // In WASM context, use 0; downstream can add real timestamp
        processing_node: "fluvio-smartmodule-fraud-enricher-v1.0".to_string(),
    };

    let json = serde_json::to_vec(&enriched)?;
    Ok(Record::new(json))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_risk_score_account_takeover() {
        assert_eq!(compute_risk_score("account_takeover", 50000.0), 95);
    }

    #[test]
    fn test_risk_score_with_high_amount_boost() {
        let score = compute_risk_score("velocity_breach", 1_500_000.0);
        assert_eq!(score, 85); // 70 + 15
    }

    #[test]
    fn test_risk_score_capped_at_100() {
        let score = compute_risk_score("account_takeover", 2_000_000.0);
        assert_eq!(score, 100); // 95 + 15 capped at 100
    }

    #[test]
    fn test_severity_critical() {
        assert_eq!(classify_severity(95), "critical");
    }

    #[test]
    fn test_severity_high() {
        assert_eq!(classify_severity(75), "high");
    }

    #[test]
    fn test_severity_medium() {
        assert_eq!(classify_severity(55), "medium");
    }

    #[test]
    fn test_severity_low() {
        assert_eq!(classify_severity(30), "low");
    }

    #[test]
    fn test_recommend_escalate_for_critical() {
        assert_eq!(recommend_action("critical"), "escalate");
    }

    #[test]
    fn test_recommend_block_for_high() {
        assert_eq!(recommend_action("high"), "block");
    }
}
