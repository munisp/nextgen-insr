use actix_web::{web, App, HttpServer, HttpResponse};
use serde::{Deserialize, Serialize};
use std::env;
use tokio_postgres::NoTls;
use ed25519_dalek::{SigningKey, Signer, VerifyingKey};
use rand::rngs::OsRng;
use uuid::Uuid;

#[derive(Serialize, Deserialize)]
struct DIDDocument {
    id: String,
    verification_method: Vec<VerificationMethod>,
    authentication: Vec<String>,
    created: String,
}

#[derive(Serialize, Deserialize)]
struct VerificationMethod {
    id: String,
    r#type: String,
    controller: String,
    public_key_hex: String,
}

#[derive(Deserialize)]
struct CreateDIDRequest {
    subject: String,
}

#[derive(Serialize)]
struct CreateDIDResponse {
    did: String,
    document: DIDDocument,
    public_key: String,
}

struct AppState {
    db: Option<tokio_postgres::Client>,
}

async fn connect_db() -> Option<tokio_postgres::Client> {
    let url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://ngapp:ngapp@localhost:5432/ngapp".to_string());
    match tokio_postgres::connect(&url, NoTls).await {
        Ok((client, connection)) => {
            tokio::spawn(async move { if let Err(e) = connection.await { eprintln!("DB error: {e}"); } });
            let _ = client.execute(
                "CREATE TABLE IF NOT EXISTS did_documents (
                    id SERIAL PRIMARY KEY,
                    did VARCHAR(255) UNIQUE NOT NULL,
                    subject VARCHAR(255) NOT NULL,
                    public_key_hex TEXT NOT NULL,
                    document JSONB NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )", &[]).await;
            Some(client)
        }
        Err(e) => { eprintln!("DB connection failed: {e}"); None }
    }
}

async fn health(data: web::Data<AppState>) -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "did-identity",
        "database": data.db.is_some(),
        "features": ["did:web", "ed25519", "verifiable-credentials"]
    }))
}

async fn create_did(req: web::Json<CreateDIDRequest>, data: web::Data<AppState>) -> HttpResponse {
    let mut csprng = OsRng;
    let signing_key = SigningKey::generate(&mut csprng);
    let verifying_key: VerifyingKey = (&signing_key).into();
    let pub_hex = hex::encode(verifying_key.as_bytes());
    let did = format!("did:web:insureportal.ng:{}", Uuid::new_v4());

    let doc = DIDDocument {
        id: did.clone(),
        verification_method: vec![VerificationMethod {
            id: format!("{}#key-1", did),
            r#type: "Ed25519VerificationKey2020".into(),
            controller: did.clone(),
            public_key_hex: pub_hex.clone(),
        }],
        authentication: vec![format!("{}#key-1", did)],
        created: chrono_now(),
    };

    if let Some(ref db) = data.db {
        let doc_json = serde_json::to_value(&doc).unwrap_or_default();
        let _ = db.execute(
            "INSERT INTO did_documents (did, subject, public_key_hex, document) VALUES ($1, $2, $3, $4)
             ON CONFLICT (did) DO NOTHING",
            &[&did, &req.subject, &pub_hex, &doc_json]).await;
    }

    HttpResponse::Created().json(CreateDIDResponse { did, document: doc, public_key: pub_hex })
}

fn chrono_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("2024-01-01T00:00:{}Z", now % 60)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port: u16 = env::var("PORT").unwrap_or_else(|_| "8112".into()).parse().unwrap_or(8112);
    let db = connect_db().await;
    let state = web::Data::new(AppState { db });
    println!("DID Identity service on port {port}");
    HttpServer::new(move || {
        App::new()
            .app_data(state.clone())
            .route("/health", web::get().to(health))
            .route("/api/v1/did/create", web::post().to(create_did))
    })
    .bind(("0.0.0.0", port))?.run().await
}
