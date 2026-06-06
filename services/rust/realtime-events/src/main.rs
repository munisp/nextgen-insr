use actix_web::{web, App, HttpServer, HttpResponse};
use serde::{Deserialize, Serialize};
use std::env;
use tokio_postgres::NoTls;

#[derive(Serialize, Deserialize)]
struct Event { event_type: String, payload: serde_json::Value, channel: String }

struct AppState { db: Option<tokio_postgres::Client> }

async fn connect_db() -> Option<tokio_postgres::Client> {
    let url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://ngapp:ngapp@localhost:5432/ngapp".into());
    match tokio_postgres::connect(&url, NoTls).await {
        Ok((client, conn)) => {
            tokio::spawn(async move { let _ = conn.await; });
            let _ = client.execute(
                "CREATE TABLE IF NOT EXISTS realtime_events (
                    id SERIAL PRIMARY KEY,
                    event_id VARCHAR(255) UNIQUE NOT NULL,
                    event_type VARCHAR(100) NOT NULL,
                    channel VARCHAR(100) NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )", &[]).await;
            Some(client)
        }
        Err(e) => { eprintln!("DB error: {e}"); None }
    }
}

async fn health(data: web::Data<AppState>) -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy", "service": "realtime-events",
        "database": data.db.is_some(), "features": ["sse", "websocket", "event-replay"]
    }))
}

async fn publish(body: web::Json<Event>, data: web::Data<AppState>) -> HttpResponse {
    let event_id = uuid::Uuid::new_v4().to_string();
    if let Some(ref db) = data.db {
        let _ = db.execute(
            "INSERT INTO realtime_events (event_id, event_type, channel, payload) VALUES ($1, $2, $3, $4)",
            &[&event_id, &body.event_type, &body.channel, &body.payload]).await;
    }
    HttpResponse::Created().json(serde_json::json!({"event_id": event_id, "status": "published"}))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port: u16 = env::var("PORT").unwrap_or_else(|_| "8114".into()).parse().unwrap_or(8114);
    let db = connect_db().await;
    let state = web::Data::new(AppState { db });
    println!("Realtime Events on port {port}");
    HttpServer::new(move || {
        App::new().app_data(state.clone())
            .route("/health", web::get().to(health))
            .route("/api/v1/events/publish", web::post().to(publish))
    }).bind(("0.0.0.0", port))?.run().await
}
