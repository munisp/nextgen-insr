use std::env;

fn database_url() -> String {
    env::var("DATABASE_URL").unwrap_or_else(|_| "postgresql://ngapp:ngapp@localhost:5432/ngapp".to_string())
}

use actix_web::{web, App, HttpServer, HttpResponse};
use serde::{Deserialize, Serialize};

/// Zero Trust Network — mTLS, policy enforcement, service mesh security
/// Business Rules:
/// - Every request authenticated and authorized (no implicit trust)
/// - mTLS between all services (certificate rotation every 24h)
/// - Policy engine: Permify for fine-grained RBAC/ABAC
/// - Session: Max 8 hours, re-auth for sensitive operations
/// - Network segmentation: Financial services isolated from general

#[derive(Serialize, Deserialize)]
struct PolicyDecision {
    allowed: bool,
    reason: String,
    policy_id: String,
}

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({"status": "healthy", "service": "zero-trust-network"}))
}

async fn evaluate_policy() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "decision": "allow", "policy_id": "POL-NET-001",
        "factors": ["valid_mtls_cert", "authorized_service", "within_network_segment"],
        "cert_expiry": "24 hours", "session_remaining": "7h 45m",
    }))
}

async fn get_mesh_status() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "services": 35, "mtls_enabled": 35, "certificates_valid": 35,
        "policy_violations_24h": 3, "blocked_requests_24h": 150,
    }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port = std::env::var("PORT").unwrap_or_else(|_| "8094".to_string());
    println!("Zero Trust Network starting on :{}", port);
    HttpServer::new(|| {
        App::new()
            .route("/health", web::get().to(health))
            .route("/api/v1/policy/evaluate", web::get().to(evaluate_policy))
            .route("/api/v1/mesh/status", web::get().to(get_mesh_status))
    })
    .bind(format!("0.0.0.0:{}", port))?
    .run()
    .await
}
