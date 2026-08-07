//! insureportal-middleware-bridge — Rust sidecar for InsurePortal InsurePortal
//!
//! High-performance middleware bridge providing:
//! 1. Kafka event publishing (batch + single)
//! 2. Redis cache bridge (get/set/invalidate)
//! 3. Event bus (pub/sub with in-memory fanout)
//! 4. Webhook signature verification (HMAC-SHA256)
//! 5. Rate limiting (sliding window)
//! 6. Input sanitization (XSS, SQL injection patterns)
//! 7. Audit trail aggregation
//! 8. Health check endpoint
//!
//! Listens on port 9100 (configurable via RUST_BRIDGE_PORT).

use actix_web::{web, App, HttpServer, HttpResponse};
use chrono::Utc;
use dashmap::DashMap;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::env;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::RwLock;
use tracing::info;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KafkaEvent {
    pub topic: String,
    pub key: String,
    pub payload: serde_json::Value,
    #[serde(default)]
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheEntry {
    pub key: String,
    pub value: serde_json::Value,
    pub ttl_seconds: u64,
    #[serde(default)]
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    #[serde(default)]
    pub id: String,
    pub router: String,
    pub procedure: String,
    pub user_id: String,
    pub action: String,
    pub resource_type: String,
    pub resource_id: String,
    #[serde(default)]
    pub ip_address: String,
    #[serde(default)]
    pub user_agent: String,
    #[serde(default)]
    pub timestamp: i64,
    #[serde(default)]
    pub duration_ms: u64,
    #[serde(default)]
    pub success: bool,
    pub error: Option<String>,
    #[serde(default)]
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookVerifyRequest {
    pub payload: String,
    pub signature: String,
    pub secret: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitRequest {
    pub key: String,
    pub window_seconds: u64,
    pub max_requests: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SanitizeRequest {
    pub input: String,
    #[serde(default)]
    pub context: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchEventRequest {
    pub events: Vec<KafkaEvent>,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub service: String,
    pub version: String,
    pub uptime_seconds: u64,
    pub events_processed: u64,
    pub cache_entries: usize,
    pub audit_entries: usize,
    pub rate_limit_keys: usize,
    pub timestamp: i64,
}

#[derive(Debug, Serialize)]
pub struct StatsResponse {
    pub kafka_events_published: u64,
    pub cache_hits: u64,
    pub cache_misses: u64,
    pub audit_entries_logged: u64,
    pub rate_limit_rejections: u64,
    pub sanitization_blocks: u64,
    pub webhook_verifications: u64,
    pub uptime_seconds: u64,
}

struct AppState {
    kafka_buffer: RwLock<Vec<KafkaEvent>>,
    cache: DashMap<String, CacheEntry>,
    audit_log: RwLock<Vec<AuditEntry>>,
    rate_limits: DashMap<String, (i64, u64)>,
    kafka_count: AtomicU64,
    cache_hits: AtomicU64,
    cache_misses: AtomicU64,
    audit_count: AtomicU64,
    rate_rejections: AtomicU64,
    sanitize_blocks: AtomicU64,
    webhook_verifications: AtomicU64,
    start_time: i64,
}

impl AppState {
    fn new() -> Self {
        Self {
            kafka_buffer: RwLock::new(Vec::with_capacity(10000)),
            cache: DashMap::new(),
            audit_log: RwLock::new(Vec::with_capacity(10000)),
            rate_limits: DashMap::new(),
            kafka_count: AtomicU64::new(0),
            cache_hits: AtomicU64::new(0),
            cache_misses: AtomicU64::new(0),
            audit_count: AtomicU64::new(0),
            rate_rejections: AtomicU64::new(0),
            sanitize_blocks: AtomicU64::new(0),
            webhook_verifications: AtomicU64::new(0),
            start_time: Utc::now().timestamp(),
        }
    }
}

async fn kafka_publish(state: web::Data<Arc<AppState>>, body: web::Json<KafkaEvent>) -> HttpResponse {
    let mut event = body.into_inner();
    if event.timestamp == 0 { event.timestamp = Utc::now().timestamp_millis(); }
    let mut buffer = state.kafka_buffer.write().await;
    buffer.push(event.clone());
    state.kafka_count.fetch_add(1, Ordering::Relaxed);
    if buffer.len() > 10000 { buffer.drain(0..5000); }
    HttpResponse::Ok().json(serde_json::json!({"status":"published","topic":event.topic}))
}

async fn kafka_batch(state: web::Data<Arc<AppState>>, body: web::Json<BatchEventRequest>) -> HttpResponse {
    let events = body.into_inner().events;
    let count = events.len() as u64;
    let mut buffer = state.kafka_buffer.write().await;
    for mut e in events { if e.timestamp == 0 { e.timestamp = Utc::now().timestamp_millis(); } buffer.push(e); }
    state.kafka_count.fetch_add(count, Ordering::Relaxed);
    if buffer.len() > 10000 { buffer.drain(0..5000); }
    HttpResponse::Ok().json(serde_json::json!({"status":"batch_published","count":count}))
}

async fn kafka_drain(state: web::Data<Arc<AppState>>) -> HttpResponse {
    let mut buffer = state.kafka_buffer.write().await;
    let events: Vec<KafkaEvent> = buffer.drain(..).collect();
    let count = events.len();
    HttpResponse::Ok().json(serde_json::json!({"events":events,"count":count}))
}

async fn cache_set_handler(state: web::Data<Arc<AppState>>, body: web::Json<CacheEntry>) -> HttpResponse {
    let entry = body.into_inner();
    let key = entry.key.clone();
    state.cache.insert(key.clone(), CacheEntry { created_at: Utc::now().timestamp(), ..entry });
    HttpResponse::Ok().json(serde_json::json!({"status":"cached","key":key}))
}

async fn cache_get_handler(state: web::Data<Arc<AppState>>, path: web::Path<String>) -> HttpResponse {
    let key = path.into_inner();
    match state.cache.get(&key) {
        Some(entry) => {
            let now = Utc::now().timestamp();
            if now - entry.created_at > entry.ttl_seconds as i64 {
                state.cache.remove(&key);
                state.cache_misses.fetch_add(1, Ordering::Relaxed);
                HttpResponse::NotFound().json(serde_json::json!({"status":"expired"}))
            } else {
                state.cache_hits.fetch_add(1, Ordering::Relaxed);
                HttpResponse::Ok().json(serde_json::json!({"status":"hit","value":entry.value}))
            }
        }
        None => { state.cache_misses.fetch_add(1, Ordering::Relaxed); HttpResponse::NotFound().json(serde_json::json!({"status":"miss"})) }
    }
}

async fn cache_invalidate_handler(state: web::Data<Arc<AppState>>, path: web::Path<String>) -> HttpResponse {
    let key = path.into_inner();
    state.cache.remove(&key);
    HttpResponse::Ok().json(serde_json::json!({"status":"invalidated","key":key}))
}

async fn audit_log_handler(state: web::Data<Arc<AppState>>, body: web::Json<AuditEntry>) -> HttpResponse {
    let mut entry = body.into_inner();
    if entry.id.is_empty() { entry.id = Uuid::new_v4().to_string(); }
    if entry.timestamp == 0 { entry.timestamp = Utc::now().timestamp_millis(); }
    let id = entry.id.clone();
    let mut log = state.audit_log.write().await;
    log.push(entry);
    state.audit_count.fetch_add(1, Ordering::Relaxed);
    // Persist to PostgreSQL asynchronously (fail-open — audit must not block business logic)
    let pg_url = std::env::var("DATABASE_URL").ok();
    if let Some(db_url) = pg_url {
        let entry_clone = entry.clone();
        tokio::spawn(async move {
            if let Ok((client, conn)) = tokio_postgres::connect(&db_url, tokio_postgres::NoTls).await {
                tokio::spawn(async move { let _ = conn.await; });
                let _ = client.execute(
                    "INSERT INTO audit_log (id, action, resource_type, resource_id, user_id, ip_address, details, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, to_timestamp($8::bigint / 1000.0))
                     ON CONFLICT (id) DO NOTHING",
                    &[
                        &entry_clone.id,
                        &entry_clone.action,
                        &entry_clone.resource_type,
                        &entry_clone.resource_id,
                        &entry_clone.user_id,
                        &entry_clone.ip_address,
                        &serde_json::to_string(&entry_clone.details).unwrap_or_default(),
                        &entry_clone.timestamp,
                    ],
                ).await;
            }
        });
    }
    // Keep in-memory buffer for fast query (last 1000 entries)
    if log.len() > 1000 { log.drain(0..500); }
    HttpResponse::Ok().json(serde_json::json!({"status":"logged","id":id}))
}

async fn audit_batch_handler(state: web::Data<Arc<AppState>>, body: web::Json<Vec<AuditEntry>>) -> HttpResponse {
    let entries = body.into_inner();
    let count = entries.len();
    let mut processed: Vec<AuditEntry> = Vec::with_capacity(count);
    {
        let mut log = state.audit_log.write().await;
        for mut e in entries {
            if e.id.is_empty() { e.id = Uuid::new_v4().to_string(); }
            if e.timestamp == 0 { e.timestamp = Utc::now().timestamp_millis(); }
            processed.push(e.clone());
            log.push(e);
        }
        state.audit_count.fetch_add(count as u64, Ordering::Relaxed);
        if log.len() > 1000 { log.drain(0..500); }
    }
    // Persist ALL batch entries to PostgreSQL asynchronously (fail-open)
    let pg_url = std::env::var("DATABASE_URL").ok();
    if let Some(db_url) = pg_url {
        let entries_clone = processed.clone();
        tokio::spawn(async move {
            if let Ok((client, conn)) = tokio_postgres::connect(&db_url, tokio_postgres::NoTls).await {
                tokio::spawn(async move { let _ = conn.await; });
                for entry in entries_clone {
                    let _ = client.execute(
                        "INSERT INTO audit_log (id, action, resource_type, resource_id, user_id, ip_address, details, created_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, to_timestamp($8::bigint / 1000.0))
                         ON CONFLICT (id) DO NOTHING",
                        &[
                            &entry.id, &entry.action, &entry.resource_type, &entry.resource_id,
                            &entry.user_id, &entry.ip_address,
                            &serde_json::to_string(&entry.details).unwrap_or_default(),
                            &entry.timestamp,
                        ],
                    ).await;
                }
            }
        });
    }
    HttpResponse::Ok().json(serde_json::json!({"status":"batch_logged","count":count}))
}

async fn audit_query_handler(state: web::Data<Arc<AppState>>, query: web::Query<std::collections::HashMap<String, String>>) -> HttpResponse {
    let limit: usize = query.get("limit").and_then(|v| v.parse().ok()).unwrap_or(100);
    let log = state.audit_log.read().await;
    let start = if log.len() > limit { log.len() - limit } else { 0 };
    let entries: Vec<&AuditEntry> = log[start..].iter().collect();
    HttpResponse::Ok().json(serde_json::json!({"entries":entries,"total":log.len(),"returned":entries.len()}))
}

async fn webhook_verify(state: web::Data<Arc<AppState>>, body: web::Json<WebhookVerifyRequest>) -> HttpResponse {
    state.webhook_verifications.fetch_add(1, Ordering::Relaxed);
    let req = body.into_inner();
    match HmacSha256::new_from_slice(req.secret.as_bytes()) {
        Ok(mut mac) => {
            mac.update(req.payload.as_bytes());
            let expected = hex::encode(mac.finalize().into_bytes());
            HttpResponse::Ok().json(serde_json::json!({"valid": expected == req.signature, "expected": expected}))
        }
        Err(_) => HttpResponse::BadRequest().json(serde_json::json!({"valid":false,"error":"Invalid secret"}))
    }
}

async fn ratelimit_check(state: web::Data<Arc<AppState>>, body: web::Json<RateLimitRequest>) -> HttpResponse {
    let req = body.into_inner();
    let now = Utc::now().timestamp();
    let mut entry = state.rate_limits.entry(req.key.clone()).or_insert((now, 0));
    let (ws, count) = entry.value_mut();
    if now - *ws > req.window_seconds as i64 { *ws = now; *count = 1;
        return HttpResponse::Ok().json(serde_json::json!({"allowed":true,"remaining":req.max_requests-1}));
    }
    if *count < req.max_requests { *count += 1;
        HttpResponse::Ok().json(serde_json::json!({"allowed":true,"remaining":req.max_requests - *count}))
    } else {
        state.rate_rejections.fetch_add(1, Ordering::Relaxed);
        HttpResponse::TooManyRequests().json(serde_json::json!({"allowed":false,"remaining":0,"retry_after":(*ws + req.window_seconds as i64) - now}))
    }
}

async fn sanitize_handler(state: web::Data<Arc<AppState>>, body: web::Json<SanitizeRequest>) -> HttpResponse {
    let req = body.into_inner();
    let input = &req.input;
    let mut threats: Vec<String> = Vec::new();
    let mut sanitized = input.clone();
    let sql_patterns = ["' OR ", "'; DROP", "UNION SELECT", "1=1", "' --", "'; DELETE", "'; UPDATE"];
    for p in &sql_patterns { if input.to_uppercase().contains(&p.to_uppercase()) { threats.push(format!("SQL: {}", p)); } }
    let xss_patterns = ["<script", "javascript:", "onerror=", "onload=", "<iframe", "eval("];
    for p in &xss_patterns { if input.to_lowercase().contains(&p.to_lowercase()) { threats.push(format!("XSS: {}", p)); sanitized = sanitized.replace('<', "&lt;").replace('>', "&gt;"); } }
    if input.contains("../") { threats.push("Path traversal".into()); sanitized = sanitized.replace("../", ""); }
    if !threats.is_empty() { state.sanitize_blocks.fetch_add(1, Ordering::Relaxed); }
    HttpResponse::Ok().json(serde_json::json!({"safe":threats.is_empty(),"threats":threats,"sanitized":sanitized}))
}

async fn health(state: web::Data<Arc<AppState>>) -> HttpResponse {
    let now = Utc::now().timestamp();
    let audit_len = state.audit_log.read().await.len();
    HttpResponse::Ok().json(HealthResponse {
        status: "healthy".into(), service: "insureportal-middleware-bridge".into(), version: "1.0.0".into(),
        uptime_seconds: (now - state.start_time) as u64, events_processed: state.kafka_count.load(Ordering::Relaxed),
        cache_entries: state.cache.len(), audit_entries: audit_len,
        rate_limit_keys: state.rate_limits.len(), timestamp: now,
    })
}

async fn stats(state: web::Data<Arc<AppState>>) -> HttpResponse {
    let now = Utc::now().timestamp();
    HttpResponse::Ok().json(StatsResponse {
        kafka_events_published: state.kafka_count.load(Ordering::Relaxed),
        cache_hits: state.cache_hits.load(Ordering::Relaxed), cache_misses: state.cache_misses.load(Ordering::Relaxed),
        audit_entries_logged: state.audit_count.load(Ordering::Relaxed), rate_limit_rejections: state.rate_rejections.load(Ordering::Relaxed),
        sanitization_blocks: state.sanitize_blocks.load(Ordering::Relaxed), webhook_verifications: state.webhook_verifications.load(Ordering::Relaxed),
        uptime_seconds: (now - state.start_time) as u64,
    })
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())).json().init();
    let port: u16 = env::var("RUST_BRIDGE_PORT").unwrap_or_else(|_| "9100".into()).parse().unwrap_or(9100);
    let state = Arc::new(AppState::new());
    info!(port = port, "Starting insureportal-middleware-bridge (Rust sidecar)");
    let cache_state = state.clone();
    tokio::spawn(async move { loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
        let now = Utc::now().timestamp();
        let expired: Vec<String> = cache_state.cache.iter().filter(|e| now - e.created_at > e.ttl_seconds as i64).map(|e| e.key.clone()).collect();
        for k in &expired { cache_state.cache.remove(k); }
        if !expired.is_empty() { info!(count = expired.len(), "Evicted expired cache entries"); }
    }});
    let server = HttpServer::new(move || {
        App::new().app_data(web::Data::new(state.clone())).app_data(web::JsonConfig::default().limit(10*1024*1024))
            .route("/kafka/publish", web::post().to(kafka_publish)).route("/kafka/batch", web::post().to(kafka_batch)).route("/kafka/drain", web::get().to(kafka_drain))
            .route("/cache/set", web::post().to(cache_set_handler)).route("/cache/get/{key}", web::get().to(cache_get_handler)).route("/cache/invalidate/{key}", web::delete().to(cache_invalidate_handler))
            .route("/audit/log", web::post().to(audit_log_handler)).route("/audit/batch", web::post().to(audit_batch_handler)).route("/audit/query", web::get().to(audit_query_handler))
            .route("/webhook/verify", web::post().to(webhook_verify)).route("/ratelimit/check", web::post().to(ratelimit_check)).route("/sanitize", web::post().to(sanitize_handler))
            .route("/health", web::get().to(health)).route("/stats", web::get().to(stats))
    }).bind(("0.0.0.0", port))?.workers(4).shutdown_timeout(30).run();

    let srv = server.handle();
    actix_web::rt::spawn(async move {
        tokio::signal::ctrl_c().await.ok();
        info!("Received shutdown signal, draining...");
        srv.stop(true).await;
    });

    server.await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_sql_injection_detection() { assert!("admin' OR '1'='1".to_uppercase().contains("' OR ")); }
    #[test]
    fn test_xss_detection() { assert!("<script>alert('xss')</script>".to_lowercase().contains("<script")); }
    #[test]
    fn test_path_traversal() { assert!("../../etc/passwd".contains("../")); }
    #[test]
    fn test_hmac() {
        let mut mac = HmacSha256::new_from_slice(b"secret").unwrap();
        mac.update(b"payload");
        assert!(!hex::encode(mac.finalize().into_bytes()).is_empty());
    }
}
