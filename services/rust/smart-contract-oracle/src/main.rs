use actix_web::{web, App, HttpServer, HttpResponse};
use serde::{Deserialize, Serialize};
use std::env;
use tokio_postgres::NoTls;

#[derive(Serialize, Deserialize)]
struct OracleDataFeed {
    feed_name: String,
    data_type: String,
    source_url: String,
    interval_seconds: i32,
}

struct AppState { db: Option<tokio_postgres::Client> }

async fn connect_db() -> Option<tokio_postgres::Client> {
    let url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://ngapp:ngapp@localhost:5432/ngapp".into());
    match tokio_postgres::connect(&url, NoTls).await {
        Ok((client, conn)) => {
            tokio::spawn(async move { let _ = conn.await; });
            let _ = client.execute(
                "CREATE TABLE IF NOT EXISTS oracle_data_feeds (
                    id SERIAL PRIMARY KEY,
                    feed_id VARCHAR(255) UNIQUE NOT NULL,
                    feed_name VARCHAR(255) NOT NULL,
                    data_type VARCHAR(50) NOT NULL,
                    source_url TEXT,
                    latest_value JSONB DEFAULT '{}',
                    interval_seconds INTEGER DEFAULT 300,
                    last_updated TIMESTAMPTZ DEFAULT NOW(),
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )", &[]).await;
            Some(client)
        }
        Err(e) => { eprintln!("DB error: {e}"); None }
    }
}

async fn health(data: web::Data<AppState>) -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy", "service": "smart-contract-oracle",
        "database": data.db.is_some(),
        "feeds": ["weather", "exchange-rate", "seismic", "flood-level"]
    }))
}

async fn create_feed(body: web::Json<OracleDataFeed>, data: web::Data<AppState>) -> HttpResponse {
    let feed_id = uuid::Uuid::new_v4().to_string();
    if let Some(ref db) = data.db {
        let _ = db.execute(
            "INSERT INTO oracle_data_feeds (feed_id, feed_name, data_type, source_url, interval_seconds)
             VALUES ($1, $2, $3, $4, $5)",
            &[&feed_id, &body.feed_name, &body.data_type, &body.source_url, &body.interval_seconds]).await;
    }
    HttpResponse::Created().json(serde_json::json!({"feed_id": feed_id, "status": "active"}))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port: u16 = env::var("PORT").unwrap_or_else(|_| "8116".into()).parse().unwrap_or(8116);
    let db = connect_db().await;
    let state = web::Data::new(AppState { db });
    println!("Smart Contract Oracle on port {port}");
    HttpServer::new(move || {
        App::new().app_data(state.clone())
            .route("/health", web::get().to(health))
            .route("/api/v1/oracle/feed", web::post().to(create_feed))
    }).bind(("0.0.0.0", port))?.run().await
}
