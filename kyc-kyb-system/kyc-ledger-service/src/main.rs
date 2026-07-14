use actix_web::{web, App, HttpServer, HttpRequest, HttpResponse, middleware};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use chrono::{DateTime, Utc};
use uuid::Uuid;

mod tigerbeetle;
mod dapr;
mod security;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerEntry {
    pub id: String,
    pub debit_account: String,
    pub credit_account: String,
    pub amount: u64,
    pub currency: String,
    pub ledger_type: LedgerType,
    pub kyc_session_id: String,
    pub kyc_level: u8,
    pub user_id: String,
    pub description: String,
    pub status: EntryStatus,
    pub metadata: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LedgerType {
    PremiumPayment,
    ClaimPayout,
    CommissionCredit,
    RefundDebit,
    MobileMoneyTransfer,
    WalletTopUp,
    WalletWithdraw,
    PolicyFee,
    TaxDeduction,
    ReinsuranceCession,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum EntryStatus {
    Pending,
    Approved,
    Rejected,
    KYCRequired,
    KYCInProgress,
    Completed,
    Failed,
    Reversed,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateEntryRequest {
    pub debit_account: String,
    pub credit_account: String,
    pub amount: u64,
    pub currency: String,
    pub ledger_type: LedgerType,
    pub kyc_session_id: Option<String>,
    pub kyc_level: Option<u8>,
    pub user_id: String,
    pub description: String,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KYCGateCheck {
    pub user_id: String,
    pub required_level: u8,
    pub current_level: u8,
    pub passed: bool,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AccountBalance {
    pub account_id: String,
    pub debits_pending: u64,
    pub debits_posted: u64,
    pub credits_pending: u64,
    pub credits_posted: u64,
    pub balance: i64,
    pub currency: String,
    pub kyc_level: u8,
}

pub struct AppState {
    pub entries: Mutex<Vec<LedgerEntry>>,
    pub tigerbeetle: tigerbeetle::TigerBeetleClient,
    pub dapr: dapr::DaprClient,
    pub security: security::OpenAppSecClient,
}

async fn health(data: web::Data<AppState>) -> HttpResponse {
    let entries = match data.entries.lock() {
        Ok(e) => e,
        Err(_) => return HttpResponse::InternalServerError().json(serde_json::json!({"error": "Internal state lock poisoned"})),
    };
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "kyc-ledger-service",
        "version": "1.0.0",
        "entries_count": entries.len(),
        "middleware": {
            "tigerbeetle": data.tigerbeetle.is_connected(),
            "dapr": data.dapr.is_connected(),
            "openappsec": data.security.is_enabled(),
        }
    }))
}

async fn create_entry(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<CreateEntryRequest>,
) -> HttpResponse {
    // OpenAppSec WAF check
    if let Err(e) = data.security.validate_request(&req).await {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "error": "Request blocked by WAF",
            "detail": e.to_string(),
        }));
    }

    let kyc_level = body.kyc_level.unwrap_or(0);
    let min_level = match body.ledger_type {
        LedgerType::PremiumPayment => 1,
        LedgerType::ClaimPayout => 2,
        LedgerType::MobileMoneyTransfer => 1,
        LedgerType::WalletTopUp => 1,
        LedgerType::WalletWithdraw => 2,
        LedgerType::CommissionCredit => 2,
        LedgerType::ReinsuranceCession => 3,
        _ => 1,
    };

    if kyc_level < min_level {
        let gate_check = KYCGateCheck {
            user_id: body.user_id.clone(),
            required_level: min_level,
            current_level: kyc_level,
            passed: false,
            reason: format!(
                "KYC Level {} required for {:?}, current level: {}",
                min_level, body.ledger_type, kyc_level
            ),
        };

        // Publish gate failure via Dapr
        let _ = data.dapr.publish_event("kyc-gate", "ledger.gate.failed", &gate_check).await;

        return HttpResponse::Forbidden().json(serde_json::json!({
            "error": "KYC verification required",
            "kyc_check": gate_check,
            "action": "complete_kyc",
            "redirect": "/kyc-status",
        }));
    }

    let entry = LedgerEntry {
        id: Uuid::new_v4().to_string(),
        debit_account: body.debit_account.clone(),
        credit_account: body.credit_account.clone(),
        amount: body.amount,
        currency: body.currency.clone(),
        ledger_type: body.ledger_type.clone(),
        kyc_session_id: body.kyc_session_id.clone().unwrap_or_default(),
        kyc_level,
        user_id: body.user_id.clone(),
        description: body.description.clone(),
        status: EntryStatus::Pending,
        metadata: body.metadata.clone().unwrap_or(serde_json::json!({})),
        created_at: Utc::now(),
    };

    // Submit to TigerBeetle
    let tb_result = data.tigerbeetle.create_transfer(&entry).await;

    let final_status = match tb_result {
        Ok(_) => EntryStatus::Completed,
        Err(_) => EntryStatus::Pending,
    };

    let mut completed_entry = entry.clone();
    completed_entry.status = final_status;

    // Save via Dapr state store
    let _ = data.dapr.save_state("ledger-store", &completed_entry.id, &completed_entry).await;

    // Publish event via Dapr pub/sub
    let _ = data.dapr.publish_event("kyc-events", "ledger.entry.created", &completed_entry).await;

    if let Ok(mut entries) = data.entries.lock() {
        entries.push(completed_entry.clone());
    }

    HttpResponse::Created().json(completed_entry)
}

async fn get_entry(data: web::Data<AppState>, path: web::Path<String>) -> HttpResponse {
    let id = path.into_inner();

    // Try Dapr state store first
    if let Ok(Some(entry)) = data.dapr.get_state::<LedgerEntry>("ledger-store", &id).await {
        return HttpResponse::Ok().json(entry);
    }

    let entries = match data.entries.lock() {
        Ok(e) => e,
        Err(_) => return HttpResponse::InternalServerError().json(serde_json::json!({"error": "Internal state error"})),
    };
    match entries.iter().find(|e| e.id == id) {
        Some(entry) => HttpResponse::Ok().json(entry),
        None => HttpResponse::NotFound().json(serde_json::json!({"error": "Entry not found"})),
    }
}

async fn get_user_entries(data: web::Data<AppState>, path: web::Path<String>) -> HttpResponse {
    let user_id = path.into_inner();
    let entries = match data.entries.lock() {
        Ok(e) => e,
        Err(_) => return HttpResponse::InternalServerError().json(serde_json::json!({"error": "Internal state error"})),
    };
    let user_entries: Vec<&LedgerEntry> = entries.iter().filter(|e| e.user_id == user_id).collect();
    HttpResponse::Ok().json(user_entries)
}

async fn get_account_balance(data: web::Data<AppState>, path: web::Path<String>) -> HttpResponse {
    let account_id = path.into_inner();

    // Try TigerBeetle first
    if let Ok(balance) = data.tigerbeetle.get_account_balance(&account_id).await {
        return HttpResponse::Ok().json(balance);
    }

    let entries = match data.entries.lock() {
        Ok(e) => e,
        Err(_) => return HttpResponse::InternalServerError().json(serde_json::json!({"error": "Internal state error"})),
    };
    let mut debits: u64 = 0;
    let mut credits: u64 = 0;

    for entry in entries.iter() {
        if entry.status == EntryStatus::Completed {
            if entry.debit_account == account_id {
                debits += entry.amount;
            }
            if entry.credit_account == account_id {
                credits += entry.amount;
            }
        }
    }

    HttpResponse::Ok().json(AccountBalance {
        account_id,
        debits_pending: 0,
        debits_posted: debits,
        credits_pending: 0,
        credits_posted: credits,
        balance: credits as i64 - debits as i64,
        currency: "NGN".to_string(),
        kyc_level: 0,
    })
}

async fn validate_kyc_transfer(
    data: web::Data<AppState>,
    body: web::Json<serde_json::Value>,
) -> HttpResponse {
    let user_id = body.get("user_id").and_then(|v| v.as_str()).unwrap_or("");
    let amount = body.get("amount").and_then(|v| v.as_u64()).unwrap_or(0);
    let kyc_level = body.get("kyc_level").and_then(|v| v.as_u64()).unwrap_or(0) as u8;

    let limits = tigerbeetle::get_kyc_transfer_limits(kyc_level);

    let passed = amount <= limits.single_limit;
    let reason = if passed {
        format!("Transfer of {} within KYC Level {} limit of {}", amount, kyc_level, limits.single_limit)
    } else {
        format!("Transfer of {} exceeds KYC Level {} single limit of {}", amount, kyc_level, limits.single_limit)
    };

    let check = KYCGateCheck {
        user_id: user_id.to_string(),
        required_level: if amount > 200_000_00 { 3 } else if amount > 20_000_00 { 2 } else { 1 },
        current_level: kyc_level,
        passed,
        reason,
    };

    HttpResponse::Ok().json(check)
}

async fn get_ledger_stats(data: web::Data<AppState>) -> HttpResponse {
    let entries = match data.entries.lock() {
        Ok(e) => e,
        Err(_) => return HttpResponse::InternalServerError().json(serde_json::json!({"error": "Internal state error"})),
    };

    let total = entries.len();
    let completed = entries.iter().filter(|e| e.status == EntryStatus::Completed).count();
    let pending = entries.iter().filter(|e| e.status == EntryStatus::Pending).count();
    let rejected = entries.iter().filter(|e| e.status == EntryStatus::Rejected).count();
    let kyc_blocked = entries.iter().filter(|e| e.status == EntryStatus::KYCRequired).count();

    let total_amount: u64 = entries.iter()
        .filter(|e| e.status == EntryStatus::Completed)
        .map(|e| e.amount)
        .sum();

    HttpResponse::Ok().json(serde_json::json!({
        "total_entries": total,
        "completed": completed,
        "pending": pending,
        "rejected": rejected,
        "kyc_blocked": kyc_blocked,
        "total_amount": total_amount,
        "currency": "NGN",
    }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt::init();

    let port: u16 = std::env::var("PORT").unwrap_or_else(|_| "8113".to_string()).parse().unwrap_or(8113);

    let tb_addr = std::env::var("TIGERBEETLE_ADDR").unwrap_or_else(|_| "localhost:3000".to_string());
    let dapr_port = std::env::var("DAPR_HTTP_PORT").unwrap_or_else(|_| "3500".to_string());
    let openappsec_url = std::env::var("OPENAPPSEC_URL").unwrap_or_else(|_| "http://localhost:8117".to_string());

    let tb_client = tigerbeetle::TigerBeetleClient::new(&tb_addr);
    let dapr_client = dapr::DaprClient::new(&dapr_port);
    let sec_client = security::OpenAppSecClient::new(&openappsec_url);

    let state = web::Data::new(AppState {
        entries: Mutex::new(Vec::new()),
        tigerbeetle: tb_client,
        dapr: dapr_client,
        security: sec_client,
    });

    tracing::info!("KYC Ledger Service starting on port {}", port);

    HttpServer::new(move || {
        App::new()
            .app_data(state.clone())
            .route("/health", web::get().to(health))
            .route("/api/v1/ledger/entry", web::post().to(create_entry))
            .route("/api/v1/ledger/entry/{id}", web::get().to(get_entry))
            .route("/api/v1/ledger/user/{user_id}", web::get().to(get_user_entries))
            .route("/api/v1/ledger/balance/{account_id}", web::get().to(get_account_balance))
            .route("/api/v1/ledger/validate-transfer", web::post().to(validate_kyc_transfer))
            .route("/api/v1/ledger/stats", web::get().to(get_ledger_stats))
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
