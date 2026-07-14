/// InsurePortal Rust Middleware Service
///
/// High-performance middleware components written in Rust:
/// - **Audit Pipeline**: Append-only audit log with cryptographic chaining (SHA-256 hash chain)
/// - **Rate Limiter**: Token bucket rate limiting per tenant/IP/endpoint with Redis backing
/// - **WAF Bridge**: OpenAppSec integration — request inspection, threat scoring, IP blocking
/// - **Metrics**: Prometheus metrics aggregation and exposure
/// - **Request Signing**: HMAC-SHA256 request signing for internal service-to-service auth
use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use serde_json::{json, Value};
use tokio::signal;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::{info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

mod audit;
mod ratelimit;
mod waf;
mod metrics;

use audit::AuditPipeline;
use ratelimit::RateLimiter;
use waf::WafBridge;
use metrics::MetricsRegistry;

/// Application state shared across all handlers
#[derive(Clone)]
pub struct AppState {
    pub audit: Arc<AuditPipeline>,
    pub rate_limiter: Arc<RateLimiter>,
    pub waf: Arc<WafBridge>,
    pub metrics: Arc<MetricsRegistry>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // ── Tracing ───────────────────────────────────────────────────────────────
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    info!("InsurePortal Rust Middleware starting...");

    // ── Initialize components ─────────────────────────────────────────────────
    let redis_url = std::env::var("REDIS_URL")
        .unwrap_or_else(|_| "redis://redis:6379".to_string());

    let audit = Arc::new(AuditPipeline::new(&redis_url).await);
    let rate_limiter = Arc::new(RateLimiter::new(&redis_url).await);
    let waf = Arc::new(WafBridge::new());
    let metrics = Arc::new(MetricsRegistry::new());

    let state = AppState { audit, rate_limiter, waf, metrics };

    // ── Router ────────────────────────────────────────────────────────────────
    let app = Router::new()
        // Health
        .route("/health", get(health_handler))
        .route("/metrics", get(metrics_handler))
        // Audit pipeline
        .route("/audit/log", post(audit_log_handler))
        .route("/audit/verify", post(audit_verify_handler))
        .route("/audit/chain/:tenant_id", get(audit_chain_handler))
        // Rate limiting
        .route("/ratelimit/check", post(ratelimit_check_handler))
        .route("/ratelimit/reset/:key", post(ratelimit_reset_handler))
        .route("/ratelimit/stats", get(ratelimit_stats_handler))
        // WAF
        .route("/waf/inspect", post(waf_inspect_handler))
        .route("/waf/block", post(waf_block_handler))
        .route("/waf/unblock/:ip", post(waf_unblock_handler))
        .route("/waf/blocked", get(waf_blocked_list_handler))
        .route("/waf/threats", get(waf_threats_handler))
        // Request signing
        .route("/sign/request", post(sign_request_handler))
        .route("/sign/verify", post(verify_signature_handler))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let port = std::env::var("RUST_MIDDLEWARE_PORT")
        .unwrap_or_else(|_| "8091".to_string())
        .parse::<u16>()
        .unwrap_or(8091);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Rust middleware listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    info!("Rust middleware stopped cleanly");
    Ok(())
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn health_handler(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "insureportal-rust-middleware",
        "components": {
            "audit": state.audit.health(),
            "rate_limiter": state.rate_limiter.health(),
            "waf": state.waf.health(),
            "metrics": "ok"
        }
    }))
}

async fn metrics_handler(State(state): State<AppState>) -> (StatusCode, String) {
    match state.metrics.render() {
        Ok(output) => (StatusCode::OK, output),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

async fn audit_log_handler(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    match state.audit.log(payload).await {
        Ok(entry) => (StatusCode::CREATED, Json(entry)),
        Err(e) => {
            warn!("Audit log failed: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()})))
        }
    }
}

async fn audit_verify_handler(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    let hash = payload.get("hash").and_then(|h| h.as_str()).unwrap_or("");
    let valid = state.audit.verify_chain(hash).await;
    Json(json!({"valid": valid, "hash": hash}))
}

async fn audit_chain_handler(
    State(state): State<AppState>,
    axum::extract::Path(tenant_id): axum::extract::Path<String>,
) -> Json<Value> {
    let chain = state.audit.get_chain(&tenant_id).await;
    Json(json!({"tenantId": tenant_id, "chain": chain}))
}

async fn ratelimit_check_handler(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let key = payload.get("key").and_then(|k| k.as_str()).unwrap_or("default");
    let limit = payload.get("limit").and_then(|l| l.as_u64()).unwrap_or(100);
    let window_secs = payload.get("windowSecs").and_then(|w| w.as_u64()).unwrap_or(60);

    match state.rate_limiter.check(key, limit, window_secs).await {
        Ok(result) => {
            let status = if result.allowed { StatusCode::OK } else { StatusCode::TOO_MANY_REQUESTS };
            (status, Json(json!({
                "allowed": result.allowed,
                "remaining": result.remaining,
                "resetAt": result.reset_at,
                "limit": limit
            })))
        }
        Err(e) => {
            // Fail-open: allow request if rate limiter is unavailable
            (StatusCode::OK, Json(json!({"allowed": true, "error": e.to_string()})))
        }
    }
}

async fn ratelimit_reset_handler(
    State(state): State<AppState>,
    axum::extract::Path(key): axum::extract::Path<String>,
) -> Json<Value> {
    state.rate_limiter.reset(&key).await;
    Json(json!({"status": "reset", "key": key}))
}

async fn ratelimit_stats_handler(State(state): State<AppState>) -> Json<Value> {
    Json(state.rate_limiter.stats().await)
}

async fn waf_inspect_handler(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let result = state.waf.inspect(&payload).await;
    let status = if result.blocked { StatusCode::FORBIDDEN } else { StatusCode::OK };
    (status, Json(serde_json::to_value(result).unwrap_or_default()))
}

async fn waf_block_handler(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    let ip = payload.get("ip").and_then(|i| i.as_str()).unwrap_or("");
    let reason = payload.get("reason").and_then(|r| r.as_str()).unwrap_or("manual block");
    state.waf.block_ip(ip, reason).await;
    Json(json!({"status": "blocked", "ip": ip}))
}

async fn waf_unblock_handler(
    State(state): State<AppState>,
    axum::extract::Path(ip): axum::extract::Path<String>,
) -> Json<Value> {
    state.waf.unblock_ip(&ip).await;
    Json(json!({"status": "unblocked", "ip": ip}))
}

async fn waf_blocked_list_handler(State(state): State<AppState>) -> Json<Value> {
    Json(json!({"blocked": state.waf.blocked_ips().await}))
}

async fn waf_threats_handler(State(state): State<AppState>) -> Json<Value> {
    Json(json!({"threats": state.waf.recent_threats().await}))
}

async fn sign_request_handler(
    State(_state): State<AppState>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let secret = std::env::var("INTERNAL_SIGNING_SECRET")
        .unwrap_or_else(|_| "insureportal-dev-secret".to_string());
    let body = payload.get("body").and_then(|b| b.as_str()).unwrap_or("");
    let timestamp = chrono::Utc::now().timestamp().to_string();

    let message = format!("{}.{}", timestamp, body);
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(message.as_bytes());
    let signature = hex::encode(mac.finalize().into_bytes());

    Json(json!({
        "signature": signature,
        "timestamp": timestamp,
        "algorithm": "HMAC-SHA256"
    }))
}

async fn verify_signature_handler(
    State(_state): State<AppState>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let secret = std::env::var("INTERNAL_SIGNING_SECRET")
        .unwrap_or_else(|_| "insureportal-dev-secret".to_string());
    let body = payload.get("body").and_then(|b| b.as_str()).unwrap_or("");
    let timestamp = payload.get("timestamp").and_then(|t| t.as_str()).unwrap_or("");
    let provided_sig = payload.get("signature").and_then(|s| s.as_str()).unwrap_or("");

    let message = format!("{}.{}", timestamp, body);
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(message.as_bytes());
    let expected_sig = hex::encode(mac.finalize().into_bytes());

    Json(json!({
        "valid": expected_sig == provided_sig,
        "algorithm": "HMAC-SHA256"
    }))
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c().await.expect("failed to install Ctrl+C handler");
    };
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    info!("Shutdown signal received");
}
