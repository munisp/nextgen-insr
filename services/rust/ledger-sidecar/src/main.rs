use actix_web::{web, App, HttpServer, HttpResponse, middleware};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

mod ledger;
mod tigerbeetle;
mod kafka_producer;

#[derive(Clone)]
pub struct AppState {
    pub ledger: Arc<RwLock<ledger::LedgerEngine>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateAccountRequest {
    pub user_id: i64,
    pub account_type: String, // wallet, premium_pool, claims_reserve, commission
    pub currency: String,     // NGN, USD
    pub initial_balance: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TransferRequest {
    pub from_account_id: String,
    pub to_account_id: String,
    pub amount: f64,
    pub currency: String,
    pub reference: String,
    pub description: String,
    pub idempotency_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AccountBalance {
    pub account_id: String,
    pub user_id: i64,
    pub account_type: String,
    pub currency: String,
    pub available_balance: f64,
    pub pending_balance: f64,
    pub total_credits: f64,
    pub total_debits: f64,
    pub last_updated: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TransferResult {
    pub transfer_id: String,
    pub status: String, // completed, pending, failed
    pub from_balance: f64,
    pub to_balance: f64,
    pub timestamp: String,
}

async fn create_account(
    state: web::Data<AppState>,
    req: web::Json<CreateAccountRequest>,
) -> HttpResponse {
    let ledger = state.ledger.write().await;
    match ledger.create_account(&req).await {
        Ok(account) => HttpResponse::Created().json(account),
        Err(e) => HttpResponse::BadRequest().json(serde_json::json!({"error": e.to_string()})),
    }
}

async fn get_balance(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let account_id = path.into_inner();
    let ledger = state.ledger.read().await;
    match ledger.get_balance(&account_id).await {
        Ok(balance) => HttpResponse::Ok().json(balance),
        Err(e) => HttpResponse::NotFound().json(serde_json::json!({"error": e.to_string()})),
    }
}

async fn transfer(
    state: web::Data<AppState>,
    req: web::Json<TransferRequest>,
) -> HttpResponse {
    let ledger = state.ledger.write().await;
    match ledger.transfer(&req).await {
        Ok(result) => HttpResponse::Ok().json(result),
        Err(e) => HttpResponse::BadRequest().json(serde_json::json!({"error": e.to_string()})),
    }
}

async fn get_transactions(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let account_id = path.into_inner();
    let ledger = state.ledger.read().await;
    match ledger.get_transactions(&account_id).await {
        Ok(txns) => HttpResponse::Ok().json(serde_json::json!({"transactions": txns})),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()})),
    }
}

async fn batch_transfer(
    state: web::Data<AppState>,
    req: web::Json<Vec<TransferRequest>>,
) -> HttpResponse {
    let ledger = state.ledger.write().await;
    let results = ledger.batch_transfer(&req).await;
    HttpResponse::Ok().json(serde_json::json!({
        "processed": results.len(),
        "results": results
    }))
}

async fn get_ledger_stats(state: web::Data<AppState>) -> HttpResponse {
    let ledger = state.ledger.read().await;
    HttpResponse::Ok().json(ledger.get_stats().await)
}

async fn reconcile(state: web::Data<AppState>) -> HttpResponse {
    let ledger = state.ledger.read().await;
    match ledger.reconcile().await {
        Ok(report) => HttpResponse::Ok().json(report),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()})),
    }
}

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "ledger-sidecar",
        "engine": "tigerbeetle"
    }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt::init();

    let ledger_engine = ledger::LedgerEngine::new().await;
    let state = AppState {
        ledger: Arc::new(RwLock::new(ledger_engine)),
    };

    let port = std::env::var("PORT").unwrap_or_else(|_| "8090".to_string());
    let bind_addr = format!("0.0.0.0:{}", port);

    tracing::info!("ledger-sidecar starting on {}", bind_addr);

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(state.clone()))
            .route("/health", web::get().to(health))
            .service(
                web::scope("/api/v1/ledger")
                    .route("/accounts", web::post().to(create_account))
                    .route("/accounts/{id}/balance", web::get().to(get_balance))
                    .route("/transfer", web::post().to(transfer))
                    .route("/transfer/batch", web::post().to(batch_transfer))
                    .route("/transactions/{account_id}", web::get().to(get_transactions))
                    .route("/stats", web::get().to(get_ledger_stats))
                    .route("/reconcile", web::post().to(reconcile))
            )
    })
    .bind(&bind_addr)?
    .run()
    .await
}
