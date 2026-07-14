/// TigerBeetle client integration for financial-grade double-entry bookkeeping
/// 
/// TigerBeetle provides:
/// - 1M+ transactions per second on a single node
/// - Strict serializability (no double-spending)
/// - Built-in two-phase transfers (pending → posted/voided)
/// - Deterministic execution (no non-determinism from threads/async)
/// - Byzantine fault tolerance in cluster mode

use serde::{Deserialize, Serialize};

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

/// TigerBeetle ledger codes for InsurePortal
pub mod ledger_codes {
    pub const WALLET: u32 = 1;           // Customer wallets (NGN)
    pub const PREMIUM_POOL: u32 = 2;     // Premium collection pool
    pub const CLAIMS_RESERVE: u32 = 3;   // Claims payout reserve
    pub const COMMISSION: u32 = 4;       // Agent/broker commissions
    pub const REINSURANCE: u32 = 5;      // Reinsurance cession
    pub const INVESTMENT: u32 = 6;       // Investment returns
    pub const REGULATORY: u32 = 7;       // NAICOM regulatory fees
    pub const P2P_POOL: u32 = 8;         // Peer-to-peer microinsurance pools
    pub const PARAMETRIC: u32 = 9;       // Parametric insurance payouts
    pub const MOJALOOP: u32 = 10;        // Mojaloop inter-bank transfers
}

/// Transfer codes for categorization
pub mod transfer_codes {
    pub const PREMIUM_PAYMENT: u16 = 100;
    pub const CLAIM_PAYOUT: u16 = 200;
    pub const WALLET_TOPUP: u16 = 300;
    pub const WALLET_WITHDRAWAL: u16 = 301;
    pub const COMMISSION_CREDIT: u16 = 400;
    pub const REINSURANCE_CESSION: u16 = 500;
    pub const P2P_CONTRIBUTION: u16 = 600;
    pub const P2P_CLAIM_PAYOUT: u16 = 601;
    pub const PARAMETRIC_PAYOUT: u16 = 700;
    pub const REFUND: u16 = 800;
    pub const FEE: u16 = 900;
}

/// Configuration for TigerBeetle cluster connection
#[derive(Debug, Clone)]
pub struct TigerBeetleConfig {
    pub cluster_id: u128,
    pub addresses: Vec<String>,
    pub max_concurrency: u32,
}

impl Default for TigerBeetleConfig {
    fn default() -> Self {
        Self {
            cluster_id: 0,
            addresses: vec!["127.0.0.1:3000".to_string()],
            max_concurrency: 32,
        }
    }
}

/// Two-phase transfer for operations requiring confirmation (e.g., wallet topup pending bank verification)
pub struct TwoPhaseTransfer {
    pub pending_transfer: TigerBeetleTransfer,
    pub timeout_seconds: u32,
}

impl TwoPhaseTransfer {
    pub fn new(
        debit_account: u128,
        credit_account: u128,
        amount: u128,
        timeout_seconds: u32,
    ) -> Self {
        let id = uuid_to_u128();
        Self {
            pending_transfer: TigerBeetleTransfer {
                id,
                debit_account_id: debit_account,
                credit_account_id: credit_account,
                amount,
                pending_id: 0,
                user_data_128: 0,
                user_data_64: 0,
                user_data_32: 0,
                timeout: timeout_seconds,
                ledger: ledger_codes::WALLET,
                code: transfer_codes::WALLET_TOPUP,
                flags: 0x0002, // pending flag
                timestamp: 0,
            },
            timeout_seconds,
        }
    }
}

fn uuid_to_u128() -> u128 {
    let uuid = uuid::Uuid::new_v4();
    u128::from_be_bytes(*uuid.as_bytes())
}
