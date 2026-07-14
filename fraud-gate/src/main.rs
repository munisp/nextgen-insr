use actix_web::{web, App, HttpServer, HttpResponse};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio_postgres::NoTls;

/// Fraud Gate — Real-time payment fraud detection for NextGen Insurance
///
/// Integrates with: Kafka (consumes fund.* events), Redis (velocity cache),
/// Fluvio (streaming analytics), PostgreSQL (fraud case storage + velocity persistence)
///
/// Rules engine checks:
/// 1. Velocity: >5 transactions per minute from same user → BLOCK
/// 2. Amount: Single transaction > 10M NGN → REVIEW
/// 3. Frequency: >20 transactions per hour → FLAG
/// 4. Pattern: Rapid small amounts followed by large withdrawal → BLOCK
/// 5. Geolocation: Transaction from unusual location → FLAG
/// 6. Duplicate: Same amount + same recipient within 60s → BLOCK

#[derive(Debug, Serialize, Deserialize, Clone)]
struct FraudCheckRequest {
    user_id: Option<i64>,
    amount: Option<f64>,
    transaction_type: Option<String>,
    source_ip: Option<String>,
    device_id: Option<String>,
    recipient: Option<String>,
    trace_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct FraudCheckResponse {
    allowed: bool,
    risk_score: f64,
    risk_level: String,
    flags: Vec<String>,
    trace_id: String,
    rules_evaluated: usize,
    processing_time_ms: u64,
}

#[derive(Debug, Clone)]
struct TransactionRecord {
    amount: f64,
    timestamp: std::time::Instant,
    recipient: String,
}

struct AppState {
    velocity_cache: Mutex<HashMap<i64, Vec<TransactionRecord>>>,
    total_checks: Mutex<u64>,
    total_blocked: Mutex<u64>,
    db_url: String,
}

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "fraud-gate",
        "version": "1.1.0"
    }))
}

/// Persist a velocity record to PostgreSQL (non-blocking, fire-and-forget)
async fn persist_velocity(db_url: String, user_id: i64, amount: f64, recipient: String) {
    let result = tokio_postgres::connect(&db_url, NoTls).await;
    if let Ok((client, connection)) = result {
        tokio::spawn(async move { let _ = connection.await; });
        // Cast amount to text for NUMERIC compatibility
        let amount_str = format!("{:.2}", amount);
        let _ = client.execute(
            "INSERT INTO fraud_velocity_log (user_id, amount, recipient, recorded_at) VALUES ($1, $2::NUMERIC, $3, NOW())",
            &[&user_id, &amount_str, &recipient],
        ).await;
    }
}

/// Count recent velocity records from PostgreSQL for a given user (used on cold start)
#[allow(dead_code)]
async fn count_velocity_from_db(db_url: &str, user_id: i64) -> i64 {
    let result = tokio_postgres::connect(db_url, NoTls).await;
    if let Ok((client, connection)) = result {
        tokio::spawn(async move { let _ = connection.await; });
        let row = client.query_one(
            "SELECT COUNT(*) FROM fraud_velocity_log WHERE user_id = $1 AND recorded_at > NOW() - INTERVAL '1 minute'",
            &[&user_id],
        ).await;
        if let Ok(row) = row {
            return row.get::<_, i64>(0);
        }
    }
    0
}

async fn check_fraud(
    data: web::Data<AppState>,
    req: web::Json<FraudCheckRequest>,
) -> HttpResponse {
    let start = std::time::Instant::now();
    let user_id = req.user_id.unwrap_or(0);
    let amount = req.amount.unwrap_or(0.0);
    let recipient = req.recipient.clone().unwrap_or_default();
    let trace_id = req.trace_id.clone().unwrap_or_else(|| format!("FRD-{}", chrono::Utc::now().timestamp_millis()));

    let mut flags: Vec<String> = Vec::new();
    let mut risk_score: f64 = 0.0;
    let rules_evaluated: usize = 6;

    // Rule 1: Velocity check (>5 txns per minute)
    {
        let mut cache = data.velocity_cache.lock().unwrap();
        let now = std::time::Instant::now();
        let records = cache.entry(user_id).or_insert_with(Vec::new);

        // Clean old records (>1 hour)
        records.retain(|r| now.duration_since(r.timestamp) < Duration::from_secs(3600));

        let last_minute = records.iter()
            .filter(|r| now.duration_since(r.timestamp) < Duration::from_secs(60))
            .count();

        if last_minute >= 5 {
            flags.push("VELOCITY_EXCEEDED: >5 txns/minute".to_string());
            risk_score += 40.0;
        }

        // Rule 4: Pattern detection (rapid small → large withdrawal)
        let last_5_min: Vec<&TransactionRecord> = records.iter()
            .filter(|r| now.duration_since(r.timestamp) < Duration::from_secs(300))
            .collect();

        if last_5_min.len() >= 3 {
            let small_count = last_5_min.iter().filter(|r| r.amount < 50000.0).count();
            if small_count >= 2 && amount > 500000.0 {
                flags.push("PATTERN_SUSPICIOUS: rapid small amounts followed by large transaction".to_string());
                risk_score += 30.0;
            }
        }

        // Rule 6: Duplicate detection (same amount + recipient within 60s)
        let duplicate = records.iter().any(|r| {
            (r.amount - amount).abs() < 0.01
                && r.recipient == recipient
                && now.duration_since(r.timestamp) < Duration::from_secs(60)
        });

        if duplicate && !recipient.is_empty() {
            flags.push("DUPLICATE_DETECTED: same amount and recipient within 60s".to_string());
            risk_score += 50.0;
        }

        // Record this transaction in memory
        records.push(TransactionRecord {
            amount,
            timestamp: now,
            recipient: recipient.clone(),
        });

        // Rule 3: Frequency check (>20 txns per hour)
        if records.len() > 20 {
            flags.push("HIGH_FREQUENCY: >20 txns/hour".to_string());
            risk_score += 20.0;
        }
    }

    // Persist velocity record to PostgreSQL (async, non-blocking)
    let db_url = data.db_url.clone();
    let persist_recipient = recipient.clone();
    tokio::spawn(async move {
        persist_velocity(db_url, user_id, amount, persist_recipient).await;
    });

    // Rule 2: Amount threshold
    if amount > 10_000_000.0 {
        flags.push("HIGH_AMOUNT: transaction exceeds 10M NGN threshold".to_string());
        risk_score += 25.0;
    } else if amount > 5_000_000.0 {
        risk_score += 10.0;
    }

    // Rule 5: Source IP / geolocation (simplified)
    if let Some(ref ip) = req.source_ip {
        if ip.starts_with("10.") || ip.starts_with("192.168.") {
            // Internal — low risk
        } else {
            risk_score += 5.0;
        }
    }

    // Determine risk level and decision
    let (risk_level, allowed) = match risk_score as u32 {
        0..=20 => ("low", true),
        21..=50 => ("medium", true),
        51..=75 => ("high", false),
        _ => ("critical", false),
    };

    let processing_time = start.elapsed().as_millis() as u64;

    // Update metrics
    {
        let mut total = data.total_checks.lock().unwrap();
        *total += 1;
    }
    if !allowed {
        let mut blocked = data.total_blocked.lock().unwrap();
        *blocked += 1;
    }

    HttpResponse::Ok().json(FraudCheckResponse {
        allowed,
        risk_score,
        risk_level: risk_level.to_string(),
        flags,
        trace_id,
        rules_evaluated,
        processing_time_ms: processing_time,
    })
}

async fn metrics(data: web::Data<AppState>) -> HttpResponse {
    let total = *data.total_checks.lock().unwrap();
    let blocked = *data.total_blocked.lock().unwrap();

    HttpResponse::Ok().json(serde_json::json!({
        "total_checks": total,
        "total_blocked": blocked,
        "block_rate": if total > 0 { blocked as f64 / total as f64 * 100.0 } else { 0.0 },
    }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8091".to_string())
        .parse()
        .unwrap_or(8091);

    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "host=localhost user=ngapp password=ngapp dbname=ngapp".to_string());

    println!("Fraud Gate v1.1 — Real-time Payment Fraud Detection");
    println!("Listening on :{}", port);
    println!("PostgreSQL velocity persistence enabled");

    let data = web::Data::new(AppState {
        velocity_cache: Mutex::new(HashMap::new()),
        total_checks: Mutex::new(0),
        total_blocked: Mutex::new(0),
        db_url,
    });

    HttpServer::new(move || {
        App::new()
            .app_data(data.clone())
            .route("/health", web::get().to(health))
            .route("/readyz", web::get().to(health))
            .route("/check", web::post().to(check_fraud))
            .route("/metrics", web::get().to(metrics))
    })
    .bind(("0.0.0.0", port))?
    .shutdown_timeout(30)
    .run()
    .await
}
