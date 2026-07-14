//! TigerBeetle client with KYC-level transfer limits, batch support, and ledger codes.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

pub const LEDGER_PREMIUM: u32 = 1;
pub const LEDGER_CLAIMS: u32 = 2;
pub const LEDGER_COMMISSION: u32 = 3;
pub const LEDGER_PAYOUT: u32 = 4;
pub const LEDGER_RESERVE: u32 = 5;
pub const LEDGER_MOBILE_MONEY: u32 = 6;

pub struct TigerBeetleClient {
    base_url: String,
    client: Client,
    kyc_limits: HashMap<u8, u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Transfer {
    pub id: String,
    pub debit_account_id: String,
    pub credit_account_id: String,
    pub amount: u64,
    pub ledger: u32,
    pub code: u32,
    pub user_data_128: String,
}

#[derive(Debug, thiserror::Error)]
pub enum TigerBeetleError {
    #[error("KYC limit exceeded: amount {amount} exceeds level {level} limit of {limit}")]
    KYCLimitExceeded { amount: u64, level: u8, limit: u64 },
    #[error("Unknown KYC level: {0}")]
    UnknownKYCLevel(u8),
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("API error ({status}): {body}")]
    Api { status: u16, body: String },
}

impl TigerBeetleClient {
    pub fn new(addr: &str) -> Self {
        let mut kyc_limits = HashMap::new();
        kyc_limits.insert(0, 500_000);        // Level 0: NGN 5,000
        kyc_limits.insert(1, 5_000_000);      // Level 1: NGN 50,000
        kyc_limits.insert(2, 50_000_000);     // Level 2: NGN 500,000
        kyc_limits.insert(3, 1_000_000_000);  // Level 3: NGN 10,000,000
        Self {
            base_url: format!("http://{}", addr),
            client: Client::builder().timeout(Duration::from_secs(5)).build().unwrap_or_default(),
            kyc_limits,
        }
    }

    pub async fn ping(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.client.get(format!("{}/health", self.base_url)).send().await?;
        Ok(())
    }

    pub fn validate_kyc_limit(&self, kyc_level: u8, amount: u64) -> Result<(), TigerBeetleError> {
        let limit = self.kyc_limits.get(&kyc_level).ok_or(TigerBeetleError::UnknownKYCLevel(kyc_level))?;
        if amount > *limit {
            return Err(TigerBeetleError::KYCLimitExceeded { amount, level: kyc_level, limit: *limit });
        }
        Ok(())
    }

    pub async fn create_account(&self, id: &str, ledger: u32, code: u32) -> Result<(), TigerBeetleError> {
        let resp = self.client.post(format!("{}/accounts/create", self.base_url))
            .json(&serde_json::json!({ "id": id, "ledger": ledger, "code": code, "flags": 0 }))
            .send().await?;
        if !resp.status().is_success() {
            return Err(TigerBeetleError::Api { status: resp.status().as_u16(), body: resp.text().await.unwrap_or_default() });
        }
        Ok(())
    }

    pub async fn get_balance(&self, account_id: &str) -> Result<serde_json::Value, TigerBeetleError> {
        let resp = self.client.get(format!("{}/accounts/{}", self.base_url, account_id)).send().await?;
        Ok(resp.json().await?)
    }

    pub async fn create_transfer(&self, transfer: &Transfer) -> Result<(), TigerBeetleError> {
        let resp = self.client.post(format!("{}/transfers/create", self.base_url))
            .json(transfer).send().await?;
        if !resp.status().is_success() {
            return Err(TigerBeetleError::Api { status: resp.status().as_u16(), body: resp.text().await.unwrap_or_default() });
        }
        Ok(())
    }

    pub async fn create_batch_transfers(&self, transfers: &[Transfer]) -> Result<(), TigerBeetleError> {
        let resp = self.client.post(format!("{}/transfers/create_batch", self.base_url))
            .json(transfers).send().await?;
        if !resp.status().is_success() {
            return Err(TigerBeetleError::Api { status: resp.status().as_u16(), body: resp.text().await.unwrap_or_default() });
        }
        Ok(())
    }

    pub async fn create_premium_transfer(&self, customer_acct: &str, reserve_acct: &str, amount: u64, kyc_level: u8, policy_id: &str) -> Result<(), TigerBeetleError> {
        self.validate_kyc_limit(kyc_level, amount)?;
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
        self.create_transfer(&Transfer {
            id: format!("prem-{}-{}", policy_id, now),
            debit_account_id: customer_acct.to_string(),
            credit_account_id: reserve_acct.to_string(),
            amount, ledger: LEDGER_PREMIUM, code: 1,
            user_data_128: policy_id.to_string(),
        }).await
    }

    pub async fn create_claim_payout(&self, reserve_acct: &str, customer_acct: &str, amount: u64, claim_id: &str) -> Result<(), TigerBeetleError> {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
        self.create_transfer(&Transfer {
            id: format!("claim-{}-{}", claim_id, now),
            debit_account_id: reserve_acct.to_string(),
            credit_account_id: customer_acct.to_string(),
            amount, ledger: LEDGER_CLAIMS, code: 2,
            user_data_128: claim_id.to_string(),
        }).await
    }

    pub async fn create_commission_transfer(&self, company_acct: &str, agent_acct: &str, amount: u64, agent_id: &str) -> Result<(), TigerBeetleError> {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
        self.create_transfer(&Transfer {
            id: format!("comm-{}-{}", agent_id, now),
            debit_account_id: company_acct.to_string(),
            credit_account_id: agent_acct.to_string(),
            amount, ledger: LEDGER_COMMISSION, code: 3,
            user_data_128: agent_id.to_string(),
        }).await
    }
}
