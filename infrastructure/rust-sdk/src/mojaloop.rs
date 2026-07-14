//! Mojaloop client with KYC-gated transfers, idempotency, and mobile money.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

pub struct MojaloopClient {
    base_url: String,
    fsp_id: String,
    client: Client,
    kyc_limits: HashMap<u8, u64>,
}

#[derive(Debug, thiserror::Error)]
pub enum MojaloopError {
    #[error("KYC limit exceeded: amount {amount} exceeds level {level} limit of {limit}")]
    KYCLimitExceeded { amount: u64, level: u8, limit: u64 },
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("API error ({status}): {body}")]
    Api { status: u16, body: String },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TransferRequest {
    pub transfer_id: String,
    pub payer_fsp: String,
    pub payee_fsp: String,
    pub amount: String,
    pub currency: String,
}

impl MojaloopClient {
    pub fn new(base_url: &str) -> Self {
        let mut kyc_limits = HashMap::new();
        kyc_limits.insert(0, 5_000);
        kyc_limits.insert(1, 50_000);
        kyc_limits.insert(2, 500_000);
        kyc_limits.insert(3, 10_000_000);
        Self {
            base_url: base_url.to_string(),
            fsp_id: "ngapp-insurance".to_string(),
            client: Client::builder().timeout(Duration::from_secs(15)).build().unwrap_or_default(),
            kyc_limits,
        }
    }

    pub async fn ping(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.client.get(format!("{}/health", self.base_url)).send().await?;
        Ok(())
    }

    fn fspiop_headers(&self) -> reqwest::header::HeaderMap {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Ok(ct) = "application/vnd.interoperability.transfers+json;version=1.1".parse() {
            headers.insert("Content-Type", ct);
        }
        if let Ok(src) = self.fsp_id.parse() {
            headers.insert("FSPIOP-Source", src);
        }
        headers
    }

    pub async fn lookup_participant(&self, id_type: &str, id_value: &str) -> Result<String, MojaloopError> {
        let resp = self.client.get(format!("{}/participants/{}/{}", self.base_url, id_type, id_value))
            .headers(self.fspiop_headers()).send().await?;
        let data: serde_json::Value = resp.json().await?;
        Ok(data["fspId"].as_str().unwrap_or("").to_string())
    }

    pub async fn execute_transfer(&self, transfer_id: &str, payer_fsp: &str, payee_fsp: &str, amount: u64, currency: &str, kyc_level: u8, idempotency_key: Option<&str>) -> Result<serde_json::Value, MojaloopError> {
        let limit = self.kyc_limits.get(&kyc_level).copied().unwrap_or(0);
        if amount > limit {
            return Err(MojaloopError::KYCLimitExceeded { amount, level: kyc_level, limit });
        }
        let mut headers = self.fspiop_headers();
        if let Some(key) = idempotency_key {
            if let Ok(v) = key.parse() {
                headers.insert("X-Idempotency-Key", v);
            }
        }
        let body = serde_json::json!({
            "transferId": transfer_id, "payerFsp": payer_fsp, "payeeFsp": payee_fsp,
            "amount": { "amount": amount.to_string(), "currency": currency },
        });
        let resp = self.client.post(format!("{}/transfers", self.base_url))
            .headers(headers).json(&body).send().await?;
        if !resp.status().is_success() {
            return Err(MojaloopError::Api { status: resp.status().as_u16(), body: resp.text().await.unwrap_or_default() });
        }
        Ok(resp.json().await?)
    }

    pub async fn collect_premium_via_mobile_money(&self, amount: u64, currency: &str, kyc_level: u8, policy_id: &str) -> Result<serde_json::Value, MojaloopError> {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
        self.execute_transfer(&format!("prem-{}-{}", policy_id, now), "mobile-money-provider", &self.fsp_id, amount, currency, kyc_level, Some(&format!("prem-{}", policy_id))).await
    }

    pub async fn payout_claim(&self, amount: u64, currency: &str, claim_id: &str) -> Result<serde_json::Value, MojaloopError> {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
        self.execute_transfer(&format!("payout-{}-{}", claim_id, now), &self.fsp_id, "mobile-money-provider", amount, currency, 3, Some(&format!("payout-{}", claim_id))).await
    }
}
