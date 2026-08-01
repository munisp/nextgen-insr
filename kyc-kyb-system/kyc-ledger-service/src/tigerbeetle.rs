use serde::{Deserialize, Serialize};
use crate::LedgerEntry;

/// CBN KYC Transfer Limits (Tier 1/2/3 per CBN Circular FPR/DIR/GEN/CIR/06/010)
/// Amounts in NGN kobo (1 NGN = 100 kobo)
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
        // Tier 0: No KYC — no transfers allowed
        0 => TransferLimits {
            kyc_level: 0,
            daily_limit: 0,
            monthly_limit: 0,
            single_limit: 0,
            currency: "NGN".to_string(),
        },
        // Tier 1: BVN only — ₦50,000/day, ₦300,000/month, ₦20,000/single
        1 => TransferLimits {
            kyc_level: 1,
            daily_limit: 5_000_000,     // ₦50,000 in kobo
            monthly_limit: 30_000_000,  // ₦300,000 in kobo
            single_limit: 2_000_000,    // ₦20,000 in kobo
            currency: "NGN".to_string(),
        },
        // Tier 2: BVN + ID — ₦500,000/day, ₦5M/month, ₦200,000/single
        2 => TransferLimits {
            kyc_level: 2,
            daily_limit: 50_000_000,    // ₦500,000 in kobo
            monthly_limit: 500_000_000, // ₦5,000,000 in kobo
            single_limit: 20_000_000,   // ₦200,000 in kobo
            currency: "NGN".to_string(),
        },
        // Tier 3: Full KYC — ₦5M/day, ₦50M/month, ₦2M/single
        3 | _ => TransferLimits {
            kyc_level: 3,
            daily_limit: 500_000_000,     // ₦5,000,000 in kobo
            monthly_limit: 5_000_000_000, // ₦50,000,000 in kobo
            single_limit: 200_000_000,    // ₦2,000,000 in kobo
            currency: "NGN".to_string(),
        },
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

/// Result of a TigerBeetle transfer attempt
#[derive(Debug)]
pub enum TbTransferResult {
    /// Transfer was successfully posted to TigerBeetle
    Posted { transfer_id: String },
    /// TigerBeetle is unavailable — transfer is queued for retry
    Pending { transfer_id: String, reason: String },
    /// TigerBeetle rejected the transfer (e.g. insufficient balance, duplicate)
    Rejected { transfer_id: String, reason: String },
}

pub struct TigerBeetleClient {
    addr: String,
    client: reqwest::Client,
}

impl TigerBeetleClient {
    pub fn new(addr: &str) -> Self {
        Self {
            addr: addr.to_string(),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .unwrap_or_default(),
        }
    }

    /// Check if TigerBeetle is reachable by calling the health endpoint.
    /// Returns false if the sidecar is down — callers should queue for retry.
    pub async fn is_connected(&self) -> bool {
        let url = format!("http://{}/health", self.addr);
        self.client.get(&url).send().await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }

    /// Create a transfer in TigerBeetle.
    ///
    /// Returns:
    /// - `TbTransferResult::Posted` on success (TB returned 2xx)
    /// - `TbTransferResult::Rejected` if TB returned 4xx (business rule violation)
    /// - `TbTransferResult::Pending` if TB is unreachable (network error or 5xx)
    ///
    /// IMPORTANT: This is NOT fail-open. The caller must check the result and
    /// only mark the ledger entry as 'completed' when Posted. On Pending, the
    /// entry must be retried. On Rejected, the entry must be rolled back.
    pub async fn create_transfer(
        &self,
        entry: &LedgerEntry,
    ) -> Result<TbTransferResult, Box<dyn std::error::Error + Send + Sync>> {
        let transfer_id = uuid::Uuid::new_v4().to_string();

        let transfer_code: u16 = match entry.ledger_type {
            crate::LedgerType::PremiumPayment => 100,
            crate::LedgerType::ClaimPayout => 200,
            crate::LedgerType::CommissionCredit => 300,
            crate::LedgerType::RefundDebit => 400,
            crate::LedgerType::MobileMoneyTransfer => 500,
            crate::LedgerType::WalletTopUp => 600,
            crate::LedgerType::WalletWithdraw => 601,
            crate::LedgerType::PolicyFee => 700,
            crate::LedgerType::TaxDeduction => 800,
            crate::LedgerType::ReinsuranceCession => 900,
        };

        let transfer = serde_json::json!({
            "id": transfer_id,
            "debit_account_id": entry.debit_account,
            "credit_account_id": entry.credit_account,
            "amount": (entry.amount * 100.0) as u64, // kobo
            "ledger": 1,
            "code": transfer_code,
            "flags": 0,
            "user_data": {
                "kyc_session_id": entry.kyc_session_id,
                "kyc_level": entry.kyc_level,
                "user_id": entry.user_id,
                "reference": entry.reference,
            },
        });

        let url = format!("http://{}/transfers", self.addr);
        let resp = self.client.post(&url)
            .json(&transfer)
            .send()
            .await;

        match resp {
            Ok(r) if r.status().is_success() => {
                tracing::info!(
                    transfer_id = %transfer_id,
                    amount = entry.amount,
                    ledger_type = ?entry.ledger_type,
                    "tigerbeetle_transfer_posted"
                );
                Ok(TbTransferResult::Posted { transfer_id })
            }
            Ok(r) if r.status().is_client_error() => {
                // 4xx = TB rejected the transfer (business rule: duplicate, insufficient balance, etc.)
                let status = r.status().as_u16();
                let body = r.text().await.unwrap_or_default();
                tracing::warn!(
                    transfer_id = %transfer_id,
                    status = status,
                    body = %body,
                    "tigerbeetle_transfer_rejected"
                );
                Ok(TbTransferResult::Rejected {
                    transfer_id,
                    reason: format!("TB rejected with HTTP {}: {}", status, body),
                })
            }
            Ok(r) => {
                // 5xx = TB server error — treat as unavailable
                let status = r.status().as_u16();
                tracing::warn!(
                    transfer_id = %transfer_id,
                    status = status,
                    "tigerbeetle_server_error_queuing_for_retry"
                );
                Ok(TbTransferResult::Pending {
                    transfer_id,
                    reason: format!("TB server error HTTP {}", status),
                })
            }
            Err(e) => {
                // Network error — TB sidecar is down
                tracing::warn!(
                    transfer_id = %transfer_id,
                    error = %e,
                    "tigerbeetle_unavailable_queuing_for_retry"
                );
                Ok(TbTransferResult::Pending {
                    transfer_id,
                    reason: format!("TB unreachable: {}", e),
                })
            }
        }
    }

    pub async fn get_account_balance(
        &self,
        account_id: &str,
    ) -> Result<crate::AccountBalance, Box<dyn std::error::Error + Send + Sync>> {
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
            Err(format!("Account not found in TigerBeetle: HTTP {}", resp.status()).into())
        }
    }

    /// Create an account in TigerBeetle.
    /// Returns an error if TB is unavailable or rejects the account creation.
    pub async fn create_account(
        &self,
        account_id: &str,
        kyc_level: u8,
        ledger: u32,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let account = serde_json::json!({
            "id": account_id,
            "ledger": ledger,
            "code": 1,
            "user_data_32": kyc_level as u32,
            "flags": 0,
        });

        let url = format!("http://{}/accounts", self.addr);
        let resp = self.client.post(&url).json(&account).send().await
            .map_err(|e| format!("TB create_account network error: {}", e))?;

        if resp.status().is_success() || resp.status().as_u16() == 409 {
            // 409 = account already exists — idempotent, treat as success
            Ok(())
        } else {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            Err(format!("TB create_account failed HTTP {}: {}", status, body).into())
        }
    }
}
