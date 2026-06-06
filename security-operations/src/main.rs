use std::env;

fn database_url() -> String {
    env::var("DATABASE_URL").unwrap_or_else(|_| "postgresql://ngapp:ngapp@localhost:5432/ngapp".to_string())
}

use actix_web::{web, App, HttpServer, HttpResponse, middleware};
use serde::{Deserialize, Serialize};

/// Security Operations / SIEM — threat detection and incident response
/// Business Rules:
/// - Log sources: API gateway, authentication, transactions, infrastructure
/// - Detection rules: Brute force (5 failed logins/5min), privilege escalation, data exfil
/// - Alert severity: Critical (P1), High (P2), Medium (P3), Low (P4)
/// - Response SLA: P1 = 15min, P2 = 1hr, P3 = 4hr, P4 = 24hr
/// - Integration: OpenAppSec WAF, OpenSearch for log analytics
/// - Compliance: CBN cybersecurity framework, NDPR breach detection

#[derive(Serialize, Deserialize)]
struct SecurityAlert {
    id: String,
    severity: String,
    rule: String,
    source_ip: String,
    description: String,
    status: String,
}

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({"status": "healthy", "service": "security-operations"}))
}

async fn get_alerts() -> HttpResponse {
    let alerts = vec![
        serde_json::json!({"id": "ALT-001", "severity": "high", "rule": "brute_force", "source_ip": "192.168.1.100", "description": "5 failed logins in 2 minutes", "status": "investigating"}),
        serde_json::json!({"id": "ALT-002", "severity": "medium", "rule": "unusual_access_pattern", "source_ip": "10.0.0.50", "description": "Access from new location", "status": "acknowledged"}),
    ];
    HttpResponse::Ok().json(serde_json::json!({"alerts": alerts, "total": 2}))
}

async fn get_threat_intel() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "blocked_ips": 245, "active_threats": 3, "rules_active": 150,
        "last_incident": "2026-05-25T10:30:00Z", "waf_blocks_24h": 1200,
    }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port = std::env::var("PORT").unwrap_or_else(|_| "8093".to_string());
    println!("Security Operations starting on :{}", port);
    HttpServer::new(|| {
        App::new()
            .route("/health", web::get().to(health))
            .route("/api/v1/alerts", web::get().to(get_alerts))
            .route("/api/v1/threat-intel", web::get().to(get_threat_intel))
    })
    .bind(format!("0.0.0.0:{}", port))?
    .run()
    .await
}
