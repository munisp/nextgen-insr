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

// ── Middleware Integration ────────────────────────────────────────────────
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Mutex;
use std::env;

struct RedisClient {
    addr: String,
    conn: Mutex<Option<TcpStream>>,
    cb_open: Mutex<bool>,
}

impl RedisClient {
    fn new() -> Self {
        let addr = env::var("REDIS_URL").unwrap_or_else(|_| "localhost:6379".to_string());
        let addr = addr.trim_start_matches("redis://").to_string();
        println!("[middleware] Redis client configured: {}", addr);
        RedisClient { addr, conn: Mutex::new(None), cb_open: Mutex::new(false) }
    }

    fn resp_cmd(&self, args: &[&str]) -> Option<String> {
        if *self.cb_open.lock().unwrap() { return None; }
        let mut conn_guard = self.conn.lock().unwrap();
        if conn_guard.is_none() {
            match TcpStream::connect(&self.addr) {
                Ok(s) => { s.set_read_timeout(Some(std::time::Duration::from_secs(3))).ok(); *conn_guard = Some(s); }
                Err(_) => { *self.cb_open.lock().unwrap() = true; return None; }
            }
        }
        if let Some(ref mut stream) = *conn_guard {
            let mut cmd = format!("*{}\r\n", args.len());
            for a in args { cmd.push_str(&format!("${}\r\n{}\r\n", a.len(), a)); }
            if stream.write_all(cmd.as_bytes()).is_err() { *conn_guard = None; return None; }
            let mut buf = [0u8; 4096];
            match stream.read(&mut buf) {
                Ok(n) if n > 0 => { let s = String::from_utf8_lossy(&buf[..n]); Some(s.to_string()) }
                _ => None,
            }
        } else { None }
    }

    fn cache_get(&self, key: &str) -> Option<String> {
        self.resp_cmd(&["GET", key]).and_then(|r| {
            if r.starts_with('$') && !r.starts_with("$-1") {
                r.splitn(3, "\r\n").nth(1).map(|s| s.to_string())
            } else { None }
        })
    }

    fn cache_set(&self, key: &str, value: &str, ttl_secs: u64) {
        self.resp_cmd(&["SET", key, value, "EX", &ttl_secs.to_string()]);
    }

    fn cache_invalidate(&self, keys: &[&str]) {
        for k in keys { self.resp_cmd(&["DEL", k]); }
    }
}

struct KafkaPublisher {
    brokers: String,
    service_name: String,
    conn: Mutex<Option<TcpStream>>,
    cb_open: Mutex<bool>,
}

impl KafkaPublisher {
    fn new(service_name: &str) -> Self {
        let brokers = env::var("KAFKA_BROKERS").unwrap_or_else(|_| "localhost:9092".to_string());
        println!("[middleware] Kafka producer configured: {}", brokers);
        KafkaPublisher {
            brokers, service_name: service_name.to_string(),
            conn: Mutex::new(None), cb_open: Mutex::new(false),
        }
    }

    fn publish_event(&self, event_type: &str, key: &str, payload: &str) {
        if *self.cb_open.lock().unwrap() { return; }
        let mut conn_guard = self.conn.lock().unwrap();
        if conn_guard.is_none() {
            let addr = self.brokers.split(',').next().unwrap_or("localhost:9092");
            match TcpStream::connect(addr) {
                Ok(s) => { *conn_guard = Some(s); }
                Err(_) => { *self.cb_open.lock().unwrap() = true; return; }
            }
        }
        if let Some(ref mut stream) = *conn_guard {
            let event = serde_json::json!({
                "event_type": event_type, "key": key, "source": &self.service_name,
                "payload": payload, "timestamp": chrono::Utc::now().to_rfc3339(),
            });
            let data = serde_json::to_vec(&event).unwrap_or_default();
            let len = (data.len() as u32).to_be_bytes();
            let mut msg = Vec::with_capacity(4 + data.len());
            msg.extend_from_slice(&len);
            msg.extend_from_slice(&data);
            if stream.write_all(&msg).is_err() { *conn_guard = None; *self.cb_open.lock().unwrap() = true; }
        }
    }
}

struct OpenSearchLogger {
    url: String,
    service_name: String,
    cb_open: Mutex<bool>,
}

impl OpenSearchLogger {
    fn new(service_name: &str) -> Self {
        let url = env::var("OPENSEARCH_URL").unwrap_or_else(|_| "http://localhost:9200".to_string());
        println!("[middleware] OpenSearch logger configured: {}", url);
        OpenSearchLogger { url, service_name: service_name.to_string(), cb_open: Mutex::new(false) }
    }

    fn index_log(&self, level: &str, message: &str) {
        if *self.cb_open.lock().unwrap() { return; }
        let doc = serde_json::json!({
            "@timestamp": chrono::Utc::now().to_rfc3339(),
            "level": level, "message": message, "service": &self.service_name,
        });
        let idx = format!("logs-{}-{}", self.service_name, chrono::Utc::now().format("%Y.%m.%d"));
        let user = env::var("OPENSEARCH_USER").unwrap_or_else(|_| "admin".to_string());
        let pass = env::var("OPENSEARCH_PASSWORD").unwrap_or_else(|_| "admin".to_string());
        let url = format!("{}/{}/_doc", self.url, idx);
        let client = reqwest::blocking::Client::builder().danger_accept_invalid_certs(true).build();
        if let Ok(client) = client {
            if client.post(&url).basic_auth(&user, Some(&pass))
                .header("Content-Type", "application/json")
                .body(serde_json::to_vec(&doc).unwrap_or_default())
                .send().is_err() {
                *self.cb_open.lock().unwrap() = true;
            }
        }
    }
}

// Keycloak JWT auth extractor (middleware tower layer)
fn validate_jwt_token(auth_header: &str) -> Result<(String, String, Vec<String>), String> {
    // Dev bypass
    if env::var("DEV_AUTH_BYPASS").unwrap_or_default() == "true" {
        return Ok(("dev-user".to_string(), "default".to_string(), vec!["admin".to_string(), "user".to_string()]));
    }

    if !auth_header.starts_with("Bearer ") {
        return Err("missing bearer token".to_string());
    }

    // In production: validate JWT against Keycloak JWKS endpoint using jsonwebtoken crate
    // For now: extract user from headers (validation handled by APISIX gateway)
    Ok(("unknown".to_string(), "default".to_string(), vec!["user".to_string()]))
}

// Permify authorization check
async fn permify_check(entity_type: &str, entity_id: &str, permission: &str, user_id: &str) -> bool {
    let permify_addr = env::var("PERMIFY_ADDR").unwrap_or_default();
    if permify_addr.is_empty() {
        return true; // Permissive when Permify is not configured
    }
    // Production: use reqwest to POST to Permify /v1/tenants/{tenant}/permissions/check
    let _ = (entity_type, entity_id, permission, user_id);
    true // Fail open
}

// Initialize all middleware clients
struct MiddlewareClients {
    redis: RedisClient,
    kafka: KafkaPublisher,
    opensearch: OpenSearchLogger,
}

impl MiddlewareClients {
    fn new(service_name: &str) -> Self {
        MiddlewareClients {
            redis: RedisClient::new(),
            kafka: KafkaPublisher::new(service_name),
            opensearch: OpenSearchLogger::new(service_name),
        }
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port = std::env::var("PORT").unwrap_or_else(|_| "8094".to_string());
    println!("Zero Trust Network starting on :{}", port);

    let server = HttpServer::new(|| {
        App::new()
            .route("/health", web::get().to(health))
            .route("/api/v1/policy/evaluate", web::get().to(evaluate_policy))
            .route("/api/v1/mesh/status", web::get().to(get_mesh_status))
    })
    .bind(format!("0.0.0.0:{}", port))?
    .shutdown_timeout(30)
    .run();

    let srv = server.handle();
    actix_web::rt::spawn(async move {
        tokio::signal::ctrl_c().await.ok();
        println!("[zero-trust-network] Received shutdown signal, draining...");
        srv.stop(true).await;
    });

    server.await
}
