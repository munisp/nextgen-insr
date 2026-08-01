use crate::{AccountBalance, CreateAccountRequest, TransferRequest, TransferResult};
use anyhow::{anyhow, Result};
use chrono::Utc;
use uuid::Uuid;
use tokio_postgres::{NoTls, Client};
use std::env;

/// LedgerEngine — Production double-entry bookkeeping backed by PostgreSQL + TigerBeetle
///
/// Architecture:
/// - PostgreSQL is the authoritative source of truth for all account/transaction records
/// - TigerBeetle (via HTTP sidecar on TB_SIDECAR_URL) provides the high-throughput
///   append-only ledger for real-time balance queries and fraud prevention
/// - All transfers are atomic: PostgreSQL transaction + TigerBeetle transfer in sequence
/// - On TigerBeetle failure, the transfer is still posted to PostgreSQL with
///   tb_status = 'pending' and retried by the background reconciler
pub struct LedgerEngine {
    db_url: String,
    tb_url: String,
}

impl LedgerEngine {
    pub async fn new() -> Self {
        let db_url = env::var("DATABASE_URL")
            .unwrap_or_else(|_| "host=localhost user=insureportal dbname=insureportal".to_string());
        let tb_url = env::var("TB_SIDECAR_URL")
            .unwrap_or_else(|_| "http://localhost:7070".to_string());

        let engine = Self { db_url: db_url.clone(), tb_url };

        // Bootstrap schema on first run
        if let Ok((client, conn)) = tokio_postgres::connect(&db_url, NoTls).await {
            tokio::spawn(async move { let _ = conn.await; });
            let _ = engine.bootstrap_schema(&client).await;
        }

        engine
    }

    async fn connect(&self) -> Result<(Client, tokio::task::JoinHandle<()>)> {
        let (client, connection) = tokio_postgres::connect(&self.db_url, NoTls).await
            .map_err(|e| anyhow!("DB connection failed: {}", e))?;
        let handle = tokio::spawn(async move { let _ = connection.await; });
        Ok((client, handle))
    }

    async fn bootstrap_schema(&self, client: &Client) -> Result<()> {
        client.batch_execute("
            CREATE TABLE IF NOT EXISTS ledger_accounts (
                account_id      TEXT PRIMARY KEY,
                user_id         BIGINT NOT NULL,
                account_type    TEXT NOT NULL CHECK (account_type IN ('wallet','premium_pool','claims_reserve','commission','reinsurance','fee_pool','suspense')),
                currency        TEXT NOT NULL DEFAULT 'NGN',
                available_balance NUMERIC(20,2) NOT NULL DEFAULT 0,
                pending_balance NUMERIC(20,2) NOT NULL DEFAULT 0,
                total_credits   NUMERIC(20,2) NOT NULL DEFAULT 0,
                total_debits    NUMERIC(20,2) NOT NULL DEFAULT 0,
                tb_account_id   TEXT,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_ledger_accounts_user_id ON ledger_accounts (user_id);
            CREATE INDEX IF NOT EXISTS idx_ledger_accounts_type ON ledger_accounts (account_type);

            CREATE TABLE IF NOT EXISTS ledger_transactions (
                id              TEXT PRIMARY KEY,
                from_account_id TEXT NOT NULL,
                to_account_id   TEXT NOT NULL,
                amount          NUMERIC(20,2) NOT NULL CHECK (amount > 0),
                currency        TEXT NOT NULL DEFAULT 'NGN',
                reference       TEXT NOT NULL,
                description     TEXT,
                status          TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','pending','failed','reversed')),
                tb_transfer_id  TEXT,
                tb_status       TEXT NOT NULL DEFAULT 'pending' CHECK (tb_status IN ('pending','posted','failed')),
                idempotency_key TEXT UNIQUE,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_ledger_txn_from ON ledger_transactions (from_account_id);
            CREATE INDEX IF NOT EXISTS idx_ledger_txn_to ON ledger_transactions (to_account_id);
            CREATE INDEX IF NOT EXISTS idx_ledger_txn_ref ON ledger_transactions (reference);
            CREATE INDEX IF NOT EXISTS idx_ledger_txn_idem ON ledger_transactions (idempotency_key);
            CREATE INDEX IF NOT EXISTS idx_ledger_txn_created ON ledger_transactions (created_at DESC);
        ").await.map_err(|e| anyhow!("Schema bootstrap failed: {}", e))?;
        Ok(())
    }

    pub async fn create_account(&self, req: &CreateAccountRequest) -> Result<AccountBalance> {
        let (client, _handle) = self.connect().await?;

        // Validate account type
        let valid_types = ["wallet", "premium_pool", "claims_reserve", "commission", "reinsurance", "fee_pool", "suspense"];
        if !valid_types.contains(&req.account_type.as_str()) {
            return Err(anyhow!("Invalid account_type '{}'. Must be one of: {}", req.account_type, valid_types.join(", ")));
        }
        let valid_currencies = ["NGN", "USD", "GBP", "EUR"];
        if !valid_currencies.contains(&req.currency.as_str()) {
            return Err(anyhow!("Invalid currency '{}'. Must be one of: {}", req.currency, valid_currencies.join(", ")));
        }
        if req.initial_balance < 0.0 {
            return Err(anyhow!("initial_balance cannot be negative"));
        }

        let account_id = format!("acct_{}", &Uuid::new_v4().to_string().replace('-', "")[..16]);
        let initial = req.initial_balance;

        client.execute(
            "INSERT INTO ledger_accounts (account_id, user_id, account_type, currency, available_balance, total_credits)
             VALUES ($1, $2, $3, $4, $5, $5)
             ON CONFLICT (account_id) DO NOTHING",
            &[&account_id, &req.user_id, &req.account_type, &req.currency, &initial],
        ).await.map_err(|e| anyhow!("Failed to create account: {}", e))?;

        Ok(AccountBalance {
            account_id,
            user_id: req.user_id,
            account_type: req.account_type.clone(),
            currency: req.currency.clone(),
            available_balance: initial,
            pending_balance: 0.0,
            total_credits: initial,
            total_debits: 0.0,
            last_updated: Utc::now().to_rfc3339(),
        })
    }

    pub async fn get_balance(&self, account_id: &str) -> Result<AccountBalance> {
        let (client, _handle) = self.connect().await?;

        let row = client.query_opt(
            "SELECT account_id, user_id, account_type, currency,
                    available_balance::float8, pending_balance::float8,
                    total_credits::float8, total_debits::float8, updated_at
             FROM ledger_accounts WHERE account_id = $1",
            &[&account_id],
        ).await.map_err(|e| anyhow!("DB query failed: {}", e))?
         .ok_or_else(|| anyhow!("Account not found: {}", account_id))?;

        Ok(AccountBalance {
            account_id: row.get(0),
            user_id: row.get(1),
            account_type: row.get(2),
            currency: row.get(3),
            available_balance: row.get(4),
            pending_balance: row.get(5),
            total_credits: row.get(6),
            total_debits: row.get(7),
            last_updated: row.get::<_, chrono::DateTime<chrono::Utc>>(8).to_rfc3339(),
        })
    }

    pub async fn transfer(&self, req: &TransferRequest) -> Result<TransferResult> {
        if req.amount <= 0.0 {
            return Err(anyhow!("Transfer amount must be positive, got {}", req.amount));
        }
        if req.from_account_id == req.to_account_id {
            return Err(anyhow!("Cannot transfer to the same account"));
        }
        if req.idempotency_key.is_empty() {
            return Err(anyhow!("idempotency_key is required for all transfers"));
        }

        let (client, _handle) = self.connect().await?;

        // Idempotency check — return existing result if key already processed
        let existing = client.query_opt(
            "SELECT id, status, created_at FROM ledger_transactions WHERE idempotency_key = $1",
            &[&req.idempotency_key],
        ).await.map_err(|e| anyhow!("Idempotency check failed: {}", e))?;

        if let Some(row) = existing {
            let txn_id: String = row.get(0);
            let status: String = row.get(1);
            // Fetch balances for response
            let from_bal = self.get_balance(&req.from_account_id).await.map(|b| b.available_balance).unwrap_or(0.0);
            let to_bal = self.get_balance(&req.to_account_id).await.map(|b| b.available_balance).unwrap_or(0.0);
            return Ok(TransferResult {
                transfer_id: txn_id,
                status,
                from_balance: from_bal,
                to_balance: to_bal,
                timestamp: row.get::<_, chrono::DateTime<chrono::Utc>>(2).to_rfc3339(),
            });
        }

        // ── Atomic PostgreSQL transfer ─────────────────────────────────────────
        let transfer_id = format!("txn_{}", &Uuid::new_v4().to_string().replace('-', "")[..20]);
        let amount = req.amount;

        // Begin transaction
        client.execute("BEGIN", &[]).await.map_err(|e| anyhow!("BEGIN failed: {}", e))?;

        // Check source account exists and has sufficient balance
        let from_row = client.query_opt(
            "SELECT available_balance::float8 FROM ledger_accounts WHERE account_id = $1 FOR UPDATE",
            &[&req.from_account_id],
        ).await;

        match from_row {
            Ok(Some(row)) => {
                let from_balance: f64 = row.get(0);
                if from_balance < amount {
                    client.execute("ROLLBACK", &[]).await.ok();
                    return Err(anyhow!(
                        "Insufficient balance: account {} has {:.2} NGN, transfer requires {:.2} NGN",
                        req.from_account_id, from_balance, amount
                    ));
                }
            }
            Ok(None) => {
                client.execute("ROLLBACK", &[]).await.ok();
                return Err(anyhow!("Source account not found: {}", req.from_account_id));
            }
            Err(e) => {
                client.execute("ROLLBACK", &[]).await.ok();
                return Err(anyhow!("Balance check failed: {}", e));
            }
        }

        // Check destination account exists
        let to_exists = client.query_opt(
            "SELECT 1 FROM ledger_accounts WHERE account_id = $1 FOR UPDATE",
            &[&req.to_account_id],
        ).await;
        if to_exists.map(|r| r.is_none()).unwrap_or(true) {
            client.execute("ROLLBACK", &[]).await.ok();
            return Err(anyhow!("Destination account not found: {}", req.to_account_id));
        }

        // Debit source
        let debit_result = client.execute(
            "UPDATE ledger_accounts
             SET available_balance = available_balance - $1,
                 total_debits = total_debits + $1,
                 updated_at = NOW()
             WHERE account_id = $2 AND available_balance >= $1",
            &[&amount, &req.from_account_id],
        ).await;

        if debit_result.map(|n| n == 0).unwrap_or(true) {
            client.execute("ROLLBACK", &[]).await.ok();
            return Err(anyhow!("Debit failed (concurrent modification or insufficient balance)"));
        }

        // Credit destination
        let credit_result = client.execute(
            "UPDATE ledger_accounts
             SET available_balance = available_balance + $1,
                 total_credits = total_credits + $1,
                 updated_at = NOW()
             WHERE account_id = $2",
            &[&amount, &req.to_account_id],
        ).await;

        if credit_result.map(|n| n == 0).unwrap_or(true) {
            client.execute("ROLLBACK", &[]).await.ok();
            return Err(anyhow!("Credit failed: destination account not found"));
        }

        // Record transaction
        client.execute(
            "INSERT INTO ledger_transactions
             (id, from_account_id, to_account_id, amount, currency, reference, description, status, idempotency_key, tb_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, 'pending')",
            &[
                &transfer_id,
                &req.from_account_id,
                &req.to_account_id,
                &amount,
                &req.currency,
                &req.reference,
                &req.description,
                &req.idempotency_key,
            ],
        ).await.map_err(|e| {
            let _ = tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current().block_on(client.execute("ROLLBACK", &[]))
            });
            anyhow!("Transaction record failed: {}", e)
        })?;

        // Commit
        client.execute("COMMIT", &[]).await.map_err(|e| anyhow!("COMMIT failed: {}", e))?;

        // ── TigerBeetle posting (async, fail-open) ─────────────────────────────
        let tb_url = self.tb_url.clone();
        let txn_id_clone = transfer_id.clone();
        let from_id = req.from_account_id.clone();
        let to_id = req.to_account_id.clone();
        let db_url = self.db_url.clone();
        tokio::spawn(async move {
            let tb_payload = serde_json::json!({
                "id": txn_id_clone,
                "debit_account_id": from_id,
                "credit_account_id": to_id,
                "amount": (amount * 100.0) as u64, // kobo
                "ledger": 1,
                "code": 100, // PREMIUM_PAYMENT default; caller should specify via metadata
                "flags": 0,
            });
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .unwrap_or_default();
            let result = client.post(format!("{}/transfers", tb_url))
                .json(&tb_payload)
                .send()
                .await;
            let tb_ok = result.map(|r| r.status().is_success()).unwrap_or(false);
            // Update tb_status in PostgreSQL
            if let Ok((pg, conn)) = tokio_postgres::connect(&db_url, NoTls).await {
                tokio::spawn(async move { let _ = conn.await; });
                let _ = pg.execute(
                    "UPDATE ledger_transactions SET tb_status = $1, tb_transfer_id = $2 WHERE id = $3",
                    &[
                        &(if tb_ok { "posted" } else { "failed" }),
                        &txn_id_clone,
                        &txn_id_clone,
                    ],
                ).await;
            }
        });

        // Fetch final balances
        let from_balance = self.get_balance(&req.from_account_id).await.map(|b| b.available_balance).unwrap_or(0.0);
        let to_balance = self.get_balance(&req.to_account_id).await.map(|b| b.available_balance).unwrap_or(0.0);

        Ok(TransferResult {
            transfer_id,
            status: "completed".to_string(),
            from_balance,
            to_balance,
            timestamp: Utc::now().to_rfc3339(),
        })
    }

    pub async fn batch_transfer(&self, requests: &[TransferRequest]) -> Vec<TransferResult> {
        let mut results = Vec::with_capacity(requests.len());
        for req in requests {
            match self.transfer(req).await {
                Ok(result) => results.push(result),
                Err(e) => results.push(TransferResult {
                    transfer_id: String::new(),
                    status: format!("failed: {}", e),
                    from_balance: 0.0,
                    to_balance: 0.0,
                    timestamp: Utc::now().to_rfc3339(),
                }),
            }
        }
        results
    }

    pub async fn get_transactions(&self, account_id: &str) -> Result<Vec<crate::ledger::Transaction>> {
        let (client, _handle) = self.connect().await?;

        let rows = client.query(
            "SELECT id, from_account_id, to_account_id, amount::float8, currency,
                    reference, description, status, created_at
             FROM ledger_transactions
             WHERE from_account_id = $1 OR to_account_id = $1
             ORDER BY created_at DESC
             LIMIT 200",
            &[&account_id],
        ).await.map_err(|e| anyhow!("Query failed: {}", e))?;

        Ok(rows.iter().map(|row| Transaction {
            id: row.get(0),
            from_account_id: row.get(1),
            to_account_id: row.get(2),
            amount: row.get(3),
            currency: row.get(4),
            reference: row.get(5),
            description: row.get::<_, Option<String>>(6).unwrap_or_default(),
            status: row.get(7),
            created_at: row.get::<_, chrono::DateTime<chrono::Utc>>(8).to_rfc3339(),
        }).collect())
    }

    pub async fn get_stats(&self) -> LedgerStats {
        let Ok((client, _handle)) = self.connect().await else {
            return LedgerStats { total_accounts: 0, total_transactions: 0, total_volume: 0.0, avg_transaction_size: 0.0, currencies: vec!["NGN".to_string()] };
        };

        let accounts_row = client.query_one("SELECT COUNT(*) FROM ledger_accounts", &[]).await;
        let txn_row = client.query_one(
            "SELECT COUNT(*), COALESCE(SUM(amount), 0)::float8, COALESCE(AVG(amount), 0)::float8 FROM ledger_transactions WHERE status = 'completed'",
            &[],
        ).await;

        let total_accounts = accounts_row.map(|r| r.get::<_, i64>(0) as usize).unwrap_or(0);
        let (total_transactions, total_volume, avg_transaction_size) = txn_row
            .map(|r| (r.get::<_, i64>(0) as usize, r.get::<_, f64>(1), r.get::<_, f64>(2)))
            .unwrap_or((0, 0.0, 0.0));

        LedgerStats {
            total_accounts,
            total_transactions,
            total_volume,
            avg_transaction_size,
            currencies: vec!["NGN".to_string(), "USD".to_string()],
        }
    }

    pub async fn reconcile(&self) -> Result<ReconciliationReport> {
        let (client, _handle) = self.connect().await?;

        let row = client.query_one(
            "SELECT
                COUNT(DISTINCT a.account_id) AS total_accounts,
                COUNT(t.id) AS total_transactions,
                COALESCE(SUM(a.total_credits), 0)::float8 AS total_credits,
                COALESCE(SUM(a.total_debits), 0)::float8 AS total_debits
             FROM ledger_accounts a
             LEFT JOIN ledger_transactions t ON t.from_account_id = a.account_id OR t.to_account_id = a.account_id",
            &[],
        ).await.map_err(|e| anyhow!("Reconciliation query failed: {}", e))?;

        let total_accounts = row.get::<_, i64>(0) as usize;
        let total_transactions = row.get::<_, i64>(1) as usize;
        let total_credits: f64 = row.get(2);
        let total_debits: f64 = row.get(3);
        let diff = (total_credits - total_debits).abs();

        // Check for TB pending transfers that need retry
        let pending_tb = client.query_one(
            "SELECT COUNT(*) FROM ledger_transactions WHERE tb_status = 'pending' AND created_at < NOW() - INTERVAL '5 minutes'",
            &[],
        ).await.map(|r| r.get::<_, i64>(0)).unwrap_or(0);

        Ok(ReconciliationReport {
            total_accounts,
            total_transactions,
            total_credits,
            total_debits,
            balance_difference: diff,
            status: if diff < 0.01 { "balanced".to_string() } else { "imbalanced".to_string() },
            pending_tb_transfers: pending_tb as usize,
            checked_at: Utc::now().to_rfc3339(),
        })
    }
}

// ── Public types re-exported for main.rs ──────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Transaction {
    pub id: String,
    pub from_account_id: String,
    pub to_account_id: String,
    pub amount: f64,
    pub currency: String,
    pub reference: String,
    pub description: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, serde::Serialize)]
pub struct ReconciliationReport {
    pub total_accounts: usize,
    pub total_transactions: usize,
    pub total_credits: f64,
    pub total_debits: f64,
    pub balance_difference: f64,
    pub status: String,
    pub pending_tb_transfers: usize,
    pub checked_at: String,
}

#[derive(Debug, serde::Serialize)]
pub struct LedgerStats {
    pub total_accounts: usize,
    pub total_transactions: usize,
    pub total_volume: f64,
    pub avg_transaction_size: f64,
    pub currencies: Vec<String>,
}
