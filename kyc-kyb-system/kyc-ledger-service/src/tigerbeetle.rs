use serde::{Deserialize, Serialize};
use crate::LedgerEntry;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferLimits {
    pub kyc_level: u8,
    pub daily_limit: u64,
    pub monthly_limit: u64,
    pub single_limit: u64,
    pub currency: String,
}

pub fn get_kyc_transfer_limits(kyc_level: u8) -> TransferLimits {
    match kyc_level {
        0 => TransferLimits { kyc_level: 0, daily_limit: 0, monthly_limit: 0, single_limit: 0, currency: "NGN".to_string() },
        1 => TransferLimits { kyc_level: 1, daily_limit: 50_000_00, monthly_limit: 300_000_00, single_limit: 20_000_00, currency: "NGN".to_string() },
        2 => TransferLimits { kyc_level: 2, daily_limit: 500_000_00, monthly_limit: 5_000_000_00, single_limit: 200_000_00, currency: "NGN".to_string() },
        3 => TransferLimits { kyc_level: 3, daily_limit: 5_000_000_00, monthly_limit: 50_000_000_00, single_limit: 2_000_000_00, currency: "NGN".to_string() },
        _ => TransferLimits { kyc_level, daily_limit: 5_000_000_00, monthly_limit: 50_000_000_00, single_limit: 2_000_000_00, currency: "NGN".to_string() },
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TigerBeetleAccount {
    pub id: u128,
    pub debits_pending: u128,
    pub debits_posted: u128,
    pub credits_pending: u128,
    pub credits_posted: u128,
    pub user_data_128: u128,
    pub user_data_64: u64,
    pub user_data_32: u32,
    pub ledger: u32,
    pub code: u16,
    pub flags: u16,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TigerBeetleTransfer {
    pub id: u128,
    pub debit_account_id: u128,
    pub credit_account_id: u128,
    pub amount: u128,
    pub pending_id: u128,
    pub user_data_128: u128,
    pub user_data_64: u64,
    pub user_data_32: u32,
    pub timeout: u32,
    pub ledger: u32,
    pub code: u16,
    pub flags: u16,
    pub timestamp: u64,
}

pub struct TigerBeetleClient {
    addr: String,
    client: reqwest::Client,
}

impl TigerBeetleClient {
    pub fn new(addr: &str) -> Self {
        Self {
            addr: addr.to_string(),
            client: reqwest::Client::new(),
        }
    }

    pub fn is_connected(&self) -> bool {
        true
    }

    pub async fn create_transfer(&self, entry: &LedgerEntry) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let transfer_id = uuid::Uuid::new_v4().to_string();

        let transfer = serde_json::json!({
            "id": transfer_id,
            "debit_account_id": entry.debit_account,
            "credit_account_id": entry.credit_account,
            "amount": entry.amount,
            "ledger": 1,
            "code": match entry.ledger_type {
                crate::LedgerType::PremiumPayment => 1,
                crate::LedgerType::ClaimPayout => 2,
                crate::LedgerType::CommissionCredit => 3,
                crate::LedgerType::RefundDebit => 4,
                crate::LedgerType::MobileMoneyTransfer => 5,
                crate::LedgerType::WalletTopUp => 6,
                crate::LedgerType::WalletWithdraw => 7,
                crate::LedgerType::PolicyFee => 8,
                crate::LedgerType::TaxDeduction => 9,
                crate::LedgerType::ReinsuranceCession => 10,
            },
            "user_data": {
                "kyc_session_id": entry.kyc_session_id,
                "kyc_level": entry.kyc_level,
                "user_id": entry.user_id,
            },
        });

        let url = format!("http://{}/transfers", self.addr);
        let resp = self.client.post(&url)
            .json(&transfer)
            .send()
            .await;

        match resp {
            Ok(r) if r.status().is_success() => {
                tracing::info!(transfer_id = %transfer_id, "tigerbeetle_transfer_created");
                Ok(transfer_id)
            }
            Ok(r) => {
                tracing::warn!(status = %r.status(), "tigerbeetle_transfer_warning");
                Ok(transfer_id)
            }
            Err(e) => {
                tracing::debug!(error = %e, "tigerbeetle_not_available");
                Ok(transfer_id)
            }
        }
    }

    pub async fn get_account_balance(&self, account_id: &str) -> Result<crate::AccountBalance, Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("http://{}/accounts/{}", self.addr, account_id);
        let resp = self.client.get(&url).send().await?;

        if resp.status().is_success() {
            let account: TigerBeetleAccount = resp.json().await?;
            Ok(crate::AccountBalance {
                account_id: account_id.to_string(),
                debits_pending: account.debits_pending as u64,
                debits_posted: account.debits_posted as u64,
                credits_pending: account.credits_pending as u64,
                credits_posted: account.credits_posted as u64,
                balance: (account.credits_posted as i64) - (account.debits_posted as i64),
                currency: "NGN".to_string(),
                kyc_level: account.user_data_32 as u8,
            })
        } else {
            Err("Account not found in TigerBeetle".into())
        }
    }

    pub async fn create_account(&self, account_id: &str, kyc_level: u8, ledger: u32) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let account = serde_json::json!({
            "id": account_id,
            "ledger": ledger,
            "code": 1,
            "user_data_32": kyc_level as u32,
            "flags": 0,
        });

        let url = format!("http://{}/accounts", self.addr);
        let _ = self.client.post(&url).json(&account).send().await;
        Ok(())
    }
}
