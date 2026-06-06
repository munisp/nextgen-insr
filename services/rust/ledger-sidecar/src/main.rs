use actix_web::{web, App, HttpServer, HttpResponse};
use serde::{Deserialize, Serialize};
use std::env;
use tokio_postgres::NoTls;

#[derive(Serialize, Deserialize)]
struct LedgerEntry {
    id: String,
    debit_account: String,
    credit_account: String,
    amount: i64,
    currency: String,
    description: String,
    status: String,
}

struct AppState { db: Option<tokio_postgres::Client> }

async fn connect_db() -> Option<tokio_postgres::Client> {
    let url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://ngapp:ngapp@localhost:5432/ngapp".into());
    match tokio_postgres::connect(&url, NoTls).await {
        Ok((client, conn)) => {
            tokio::spawn(async move { let _ = conn.await; });
            let _ = client.execute(
                "CREATE TABLE IF NOT EXISTS ledger_entries (
                    id SERIAL PRIMARY KEY,
                    entry_id VARCHAR(255) UNIQUE NOT NULL,
                    debit_account VARCHAR(100) NOT NULL,
                    credit_account VARCHAR(100) NOT NULL,
                    amount BIGINT NOT NULL,
                    currency VARCHAR(3) DEFAULT 'NGN',
                    description TEXT,
                    status VARCHAR(50) DEFAULT 'pending',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )", &[]).await;
            Some(client)
        }
        Err(e) => { eprintln!("DB error: {e}"); None }
    }
}

async fn health(data: web::Data<AppState>) -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy", "service": "ledger-sidecar", "database": data.db.is_some()
    }))
}

async fn create_entry(body: web::Json<LedgerEntry>, data: web::Data<AppState>) -> HttpResponse {
    let entry_id = uuid::Uuid::new_v4().to_string();
    if let Some(ref db) = data.db {
        let _ = db.execute(
            "INSERT INTO ledger_entries (entry_id, debit_account, credit_account, amount, currency, description, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
            &[&entry_id, &body.debit_account, &body.credit_account, &body.amount, &body.currency, &body.description, &"pending".to_string()]
        ).await;
    }
    HttpResponse::Created().json(serde_json::json!({"id": entry_id, "status": "pending"}))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port: u16 = env::var("PORT").unwrap_or_else(|_| "8113".into()).parse().unwrap_or(8113);
    let db = connect_db().await;
    let state = web::Data::new(AppState { db });
    println!("Ledger Sidecar on port {port}");
    HttpServer::new(move || {
        App::new().app_data(state.clone())
            .route("/health", web::get().to(health))
            .route("/api/v1/ledger/entry", web::post().to(create_entry))
    }).bind(("0.0.0.0", port))?.run().await
}
