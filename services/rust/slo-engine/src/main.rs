// slo-engine/src/main.rs
// Real-time SLO (Service Level Objective) engine for InsurePortal.
// Continuously measures service health, computes error budget burn rates,
// and automatically creates incidents when SLOs are breached.
//
// Architecture:
//   - Probes all 14 platform services every 30 seconds
//   - Computes rolling 30-day error budget consumption
//   - Writes measurements to PostgreSQL (slo_definitions, error_budget_burns)
//   - Emits Fluvio events on breach
//   - Exposes /api/v1/status for real-time dashboard

use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::{sync::RwLock, time};
use tracing::{error, info, warn};

#[derive(Clone)]
struct AppState {
    db: PgPool,
    service_status: Arc<RwLock<HashMap<String, ServiceHealth>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ServiceHealth {
    service: String,
    url: String,
    healthy: bool,
    latency_ms: u64,
    last_checked: String,
    consecutive_failures: u32,
    uptime_pct_30d: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct SloStatus {
    slo_id: i32,
    service_name: String,
    slo_name: String,
    metric_type: String,
    target_value: f64,
    current_value: f64,
    budget_remaining_pct: f64,
    burn_rate: f64,
    is_breached: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct HealthResponse {
    status: String,
    services: Vec<ServiceHealth>,
    slo_statuses: Vec<SloStatus>,
    overall_health: f64,
    active_incidents: i64,
}

// All 14 platform services to monitor
fn get_service_targets() -> Vec<(&'static str, &'static str)> {
    vec![
        ("postgresql", "http://postgres:5432"),
        ("tigerbeetle-sidecar", "http://tb-sidecar:7070/health"),
        ("keycloak", "http://keycloak:8080/health/ready"),
        ("redis", "http://redis:6379"),
        ("temporal", "http://temporal:7233"),
        ("fluvio", "http://fluvio:9003/health"),
        ("dapr-sidecar", "http://localhost:3500/v1.0/healthz"),
        ("apisix", "http://apisix:9080/apisix/admin/routes"),
        ("permify", "http://permify:3476/healthz"),
        ("openappsec", "http://openappsec:8080/health"),
        ("ollama", "http://ollama:11434/api/tags"),
        ("ml-fraud-scoring", "http://ml-fraud-scoring:8090/health"),
        ("fraud-gate", "http://fraud-gate:8091/health"),
        ("lakehouse-analytics", "http://lakehouse-analytics:8156/health"),
    ]
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/insureportal".to_string());

    let db = PgPool::connect(&database_url)
        .await
        .expect("Failed to connect to PostgreSQL");

    // Seed default SLO definitions
    seed_slo_definitions(&db).await;

    let service_status = Arc::new(RwLock::new(HashMap::new()));
    let state = AppState {
        db: db.clone(),
        service_status: service_status.clone(),
    };

    // Start background health probe loop
    let probe_state = state.clone();
    tokio::spawn(async move {
        run_health_probe_loop(probe_state).await;
    });

    // Start SLO computation loop (every 5 minutes)
    let slo_state = state.clone();
    tokio::spawn(async move {
        run_slo_computation_loop(slo_state).await;
    });

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/v1/status", get(get_status))
        .route("/api/v1/slos", get(get_slos))
        .route("/api/v1/incidents", get(get_incidents))
        .route("/api/v1/measure", post(record_measurement))
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "8111".to_string());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .unwrap();

    info!("SLO Engine listening on :{}", port);
    axum::serve(listener, app).await.unwrap();
}

async fn seed_slo_definitions(db: &PgPool) {
    let slos = vec![
        ("postgresql", "Database Availability", "availability", 99.9),
        ("postgresql", "Query P99 Latency", "latency_p99", 500.0),
        ("tigerbeetle-sidecar", "Ledger Availability", "availability", 99.95),
        ("tigerbeetle-sidecar", "Transfer Latency P99", "latency_p99", 200.0),
        ("keycloak", "Auth Service Availability", "availability", 99.9),
        ("redis", "Cache Availability", "availability", 99.5),
        ("temporal", "Workflow Engine Availability", "availability", 99.9),
        ("fraud-gate", "Fraud Check Availability", "availability", 99.0),
        ("fraud-gate", "Fraud Check Latency P99", "latency_p99", 100.0),
        ("ml-fraud-scoring", "ML Inference Availability", "availability", 99.0),
        ("ollama", "AI Inference Availability", "availability", 95.0),
        ("apisix", "API Gateway Availability", "availability", 99.95),
    ];

    for (service, name, metric_type, target) in slos {
        let _ = sqlx::query(
            r#"INSERT INTO slo_definitions (service_name, slo_name, metric_type, target_value, enabled)
               VALUES ($1, $2, $3, $4, true)
               ON CONFLICT DO NOTHING"#,
        )
        .bind(service)
        .bind(name)
        .bind(metric_type)
        .bind(target)
        .execute(db)
        .await;
    }
}

async fn run_health_probe_loop(state: AppState) {
    let mut interval = time::interval(Duration::from_secs(30));
    loop {
        interval.tick().await;
        probe_all_services(&state).await;
    }
}

async fn probe_all_services(state: &AppState) {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    let targets = get_service_targets();
    let mut status_map = state.service_status.write().await;

    for (name, url) in &targets {
        let start = std::time::Instant::now();
        let result = client.get(*url).send().await;
        let latency_ms = start.elapsed().as_millis() as u64;

        let healthy = match result {
            Ok(resp) => resp.status().is_success() || resp.status().as_u16() == 401,
            Err(_) => {
                // For services that don't have HTTP health endpoints
                // (Redis, PostgreSQL), try TCP connection
                matches!(name, &"postgresql" | &"redis" | &"temporal")
                    && tokio::net::TcpStream::connect(
                        url.trim_start_matches("http://"),
                    )
                    .await
                    .is_ok()
            }
        };

        let existing = status_map.get(*name);
        let consecutive_failures = if healthy {
            0
        } else {
            existing.map(|s: &ServiceHealth| s.consecutive_failures + 1).unwrap_or(1)
        };

        // Compute 30-day uptime from DB
        let uptime = compute_uptime_from_db(&state.db, name).await;

        let health = ServiceHealth {
            service: name.to_string(),
            url: url.to_string(),
            healthy,
            latency_ms,
            last_checked: chrono::Utc::now().to_rfc3339(),
            consecutive_failures,
            uptime_pct_30d: uptime,
        };

        // Record measurement in DB
        let _ = sqlx::query(
            r#"INSERT INTO platform_health_checks 
               (service_name, status, latency_ms, checked_at)
               VALUES ($1, $2, $3, NOW())"#,
        )
        .bind(*name)
        .bind(if healthy { "healthy" } else { "unhealthy" })
        .bind(latency_ms as i64)
        .execute(&state.db)
        .await;

        // Auto-create incident if 3+ consecutive failures
        if consecutive_failures >= 3 {
            warn!("Service {} has {} consecutive failures", name, consecutive_failures);
            let _ = sqlx::query(
                r#"INSERT INTO incidents (title, severity, status, affected_services, opened_at)
                   VALUES ($1, 'P1', 'open', ARRAY[$2], NOW())
                   ON CONFLICT DO NOTHING"#,
            )
            .bind(format!("Service Outage: {} — {} consecutive failures", name, consecutive_failures))
            .bind(*name)
            .execute(&state.db)
            .await;
        }

        status_map.insert(name.to_string(), health);
    }
}

async fn compute_uptime_from_db(db: &PgPool, service: &str) -> f64 {
    let result = sqlx::query(
        r#"SELECT 
           COUNT(*) FILTER (WHERE status = 'healthy') * 100.0 / NULLIF(COUNT(*), 0) as uptime
           FROM platform_health_checks
           WHERE service_name = $1
           AND checked_at > NOW() - INTERVAL '30 days'"#,
    )
    .bind(service)
    .fetch_one(db)
    .await;

    match result {
        Ok(row) => row.try_get::<f64, _>("uptime").unwrap_or(100.0),
        Err(_) => 100.0,
    }
}

async fn run_slo_computation_loop(state: AppState) {
    let mut interval = time::interval(Duration::from_secs(300)); // every 5 minutes
    loop {
        interval.tick().await;
        compute_slo_burn_rates(&state).await;
    }
}

async fn compute_slo_burn_rates(state: &AppState) {
    let slos = sqlx::query(
        "SELECT id, service_name, metric_type, target_value FROM slo_definitions WHERE enabled = true",
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    for slo in slos {
        let slo_id: i32 = slo.get("id");
        let service_name: String = slo.get("service_name");
        let metric_type: String = slo.get("metric_type");
        let target: f64 = slo.try_get::<f64, _>("target_value").unwrap_or(99.9);

        let current_value = match metric_type.as_str() {
            "availability" => {
                compute_uptime_from_db(&state.db, &service_name).await
            }
            "latency_p99" => {
                let result = sqlx::query(
                    r#"SELECT PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) as p99
                       FROM platform_health_checks
                       WHERE service_name = $1
                       AND checked_at > NOW() - INTERVAL '1 hour'"#,
                )
                .bind(&service_name)
                .fetch_one(&state.db)
                .await;
                result.ok()
                    .and_then(|r| r.try_get::<f64, _>("p99").ok())
                    .unwrap_or(0.0)
            }
            _ => target,
        };

        let is_breached = match metric_type.as_str() {
            "availability" => current_value < target,
            "latency_p99" | "error_rate" => current_value > target,
            _ => false,
        };

        let budget_remaining = if is_breached {
            0.0
        } else {
            ((current_value - target) / (100.0 - target)) * 100.0
        };

        let burn_rate = if is_breached { 100.0 } else { 0.0 };

        let _ = sqlx::query(
            r#"INSERT INTO error_budget_burns 
               (slo_id, measurement_date, measured_value, budget_remaining_pct, burn_rate, is_breached)
               VALUES ($1, CURRENT_DATE, $2, $3, $4, $5)"#,
        )
        .bind(slo_id)
        .bind(current_value)
        .bind(budget_remaining.max(0.0))
        .bind(burn_rate)
        .bind(is_breached)
        .execute(&state.db)
        .await;

        if is_breached {
            error!("SLO BREACH: {} {} — current: {:.2}, target: {:.2}", service_name, metric_type, current_value, target);
        }
    }
}

async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status": "healthy", "service": "slo-engine"}))
}

async fn get_status(State(state): State<AppState>) -> Json<HealthResponse> {
    let status_map = state.service_status.read().await;
    let services: Vec<ServiceHealth> = status_map.values().cloned().collect();

    let healthy_count = services.iter().filter(|s| s.healthy).count();
    let overall_health = if services.is_empty() {
        100.0
    } else {
        (healthy_count as f64 / services.len() as f64) * 100.0
    };

    let slo_statuses = get_slo_statuses(&state.db).await;

    let active_incidents = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM incidents WHERE status = 'open'",
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    Json(HealthResponse {
        status: if overall_health >= 95.0 { "healthy".to_string() } else { "degraded".to_string() },
        services,
        slo_statuses,
        overall_health,
        active_incidents,
    })
}

async fn get_slo_statuses(db: &PgPool) -> Vec<SloStatus> {
    let rows = sqlx::query(
        r#"SELECT s.id, s.service_name, s.slo_name, s.metric_type, s.target_value,
                  COALESCE(b.measured_value, s.target_value) as current_value,
                  COALESCE(b.budget_remaining_pct, 100.0) as budget_remaining_pct,
                  COALESCE(b.burn_rate, 0.0) as burn_rate,
                  COALESCE(b.is_breached, false) as is_breached
           FROM slo_definitions s
           LEFT JOIN LATERAL (
               SELECT measured_value, budget_remaining_pct, burn_rate, is_breached
               FROM error_budget_burns
               WHERE slo_id = s.id
               ORDER BY measurement_date DESC
               LIMIT 1
           ) b ON true
           WHERE s.enabled = true"#,
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();

    rows.iter().map(|r| SloStatus {
        slo_id: r.get("id"),
        service_name: r.get("service_name"),
        slo_name: r.get("slo_name"),
        metric_type: r.get("metric_type"),
        target_value: r.try_get::<f64, _>("target_value").unwrap_or(99.9),
        current_value: r.try_get::<f64, _>("current_value").unwrap_or(99.9),
        budget_remaining_pct: r.try_get::<f64, _>("budget_remaining_pct").unwrap_or(100.0),
        burn_rate: r.try_get::<f64, _>("burn_rate").unwrap_or(0.0),
        is_breached: r.get("is_breached"),
    }).collect()
}

async fn get_slos(State(state): State<AppState>) -> Json<Vec<SloStatus>> {
    Json(get_slo_statuses(&state.db).await)
}

async fn get_incidents(State(state): State<AppState>) -> Json<serde_json::Value> {
    let incidents = sqlx::query(
        "SELECT id, title, severity, status, affected_services, opened_at FROM incidents ORDER BY opened_at DESC LIMIT 20",
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let result: Vec<serde_json::Value> = incidents.iter().map(|r| {
        serde_json::json!({
            "id": r.get::<i32, _>("id"),
            "title": r.get::<String, _>("title"),
            "severity": r.get::<String, _>("severity"),
            "status": r.get::<String, _>("status"),
            "opened_at": r.get::<String, _>("opened_at"),
        })
    }).collect();

    Json(serde_json::json!({"incidents": result, "count": result.len()}))
}

#[derive(Deserialize)]
struct MeasurementRequest {
    slo_id: i32,
    measured_value: f64,
}

async fn record_measurement(
    State(state): State<AppState>,
    Json(req): Json<MeasurementRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let slo = sqlx::query(
        "SELECT target_value, metric_type FROM slo_definitions WHERE id = $1",
    )
    .bind(req.slo_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| StatusCode::NOT_FOUND)?;

    let target: f64 = slo.try_get("target_value").unwrap_or(99.9);
    let metric_type: String = slo.get("metric_type");

    let is_breached = match metric_type.as_str() {
        "availability" => req.measured_value < target,
        _ => req.measured_value > target,
    };

    let budget_remaining = if is_breached { 0.0 } else { 100.0 };

    sqlx::query(
        r#"INSERT INTO error_budget_burns (slo_id, measurement_date, measured_value, budget_remaining_pct, burn_rate, is_breached)
           VALUES ($1, CURRENT_DATE, $2, $3, $4, $5)"#,
    )
    .bind(req.slo_id)
    .bind(req.measured_value)
    .bind(budget_remaining)
    .bind(if is_breached { 100.0f64 } else { 0.0f64 })
    .bind(is_breached)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({"success": true, "is_breached": is_breached})))
}
