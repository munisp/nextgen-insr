use actix_web::{web, App, HttpServer, HttpResponse};
use serde::{Deserialize, Serialize};
use std::env;
use tokio_postgres::NoTls;

#[derive(Serialize, Deserialize)]
struct StreamMessage { topic: String, key: String, value: serde_json::Value }

struct AppState { db: Option<tokio_postgres::Client> }

async fn connect_db() -> Option<tokio_postgres::Client> {
    let url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://ngapp:ngapp@localhost:5432/ngapp".into());
    match tokio_postgres::connect(&url, NoTls).await {
        Ok((client, conn)) => {
            tokio::spawn(async move { let _ = conn.await; });
            let _ = client.execute(
                "CREATE TABLE IF NOT EXISTS stream_messages (
                    id SERIAL PRIMARY KEY,
                    message_id VARCHAR(255) UNIQUE NOT NULL,
                    topic VARCHAR(100) NOT NULL,
                    key VARCHAR(255),
                    value JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )", &[]).await;
            Some(client)
        }
        Err(e) => { eprintln!("DB error: {e}"); None }
    }
}

async fn health(data: web::Data<AppState>) -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy", "service": "realtime-streaming", "database": data.db.is_some()
    }))
}

async fn produce(body: web::Json<StreamMessage>, data: web::Data<AppState>) -> HttpResponse {
    let msg_id = uuid::Uuid::new_v4().to_string();
    if let Some(ref db) = data.db {
        let _ = db.execute(
            "INSERT INTO stream_messages (message_id, topic, key, value) VALUES ($1, $2, $3, $4)",
            &[&msg_id, &body.topic, &body.key, &body.value]).await;
    }
    HttpResponse::Created().json(serde_json::json!({"message_id": msg_id, "status": "produced"}))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port: u16 = env::var("PORT").unwrap_or_else(|_| "8115".into()).parse().unwrap_or(8115);
    let db = connect_db().await;
    let state = web::Data::new(AppState { db });
    println!("Realtime Streaming on port {port}");
    HttpServer::new(move || {
        App::new().app_data(state.clone())
            .route("/health", web::get().to(health))
            .route("/api/v1/stream/produce", web::post().to(produce))
    }).bind(("0.0.0.0", port))?.run().await
}
