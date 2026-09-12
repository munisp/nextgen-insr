//! ddos-shield — Adaptive DDoS mitigation & rate-limiting enforcement sidecar
//! Port: 8090 (DDOS_SHIELD_URL in server/middleware/securityOrchestrator.ts)
//!
//! This is the ENFORCEMENT half of the platform's DDoS posture. The TypeScript
//! `ddosTelemetryMiddleware` (server/lib/ddosTelemetry.ts) is passive
//! observation; this sidecar actively admits or rejects traffic via POST
//! /check, which the security orchestrator calls fail-open before every
//! protected API request.
//!
//! Real components, no stubs:
//! - AdaptiveRateLimiter: per-client token bucket (tokens / max_tokens /
//!   refill_rate) whose capacity shrinks under observed abuse and recovers
//!   over time.
//! - CircuitBreaker: Closed/Open/HalfOpen state machine (failure_count /
//!   failure_threshold) that trips on sustained attack bursts so the shield
//!   degrades to a cheap static decision instead of doing per-request analysis
//!   while itself under flood.
//! - ConnectionAnalyzer: sliding-window per-IP request/byte/concurrency
//!   analysis producing a genuine threat_level classification.
//! - IpReputation: persistent per-IP reputation_score (0..100) plus an
//!   explicit blocked_ips set driven by violations and /block operator calls.
//!
//! Endpoints:
//!   POST /check    admission decision for one request
//!   GET  /health   liveness
//!   GET  /stats    live counters and limiter state
//!   POST /block    {ip, reason?} — block an IP immediately
//!   POST /unblock  {ip} — remove an IP from blocked_ips

use actix_web::{web, App, HttpResponse, HttpServer};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

// ── Configuration ────────────────────────────────────────────────────────────

#[derive(Clone)]
struct Config {
    port: u16,
    base_max_tokens: f64,
    base_refill_rate: f64, // tokens per second
    failure_threshold: u32,
    circuit_reset: Duration,
    block_reputation_floor: f64,
}

impl Config {
    fn from_env() -> Self {
        Config {
            port: std::env::var("DDOS_SHIELD_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8090),
            base_max_tokens: 120.0,
            base_refill_rate: 20.0,
            failure_threshold: 5,
            circuit_reset: Duration::from_secs(30),
            block_reputation_floor: 10.0,
        }
    }
}

// ── AdaptiveRateLimiter (token bucket) ───────────────────────────────────────

struct TokenBucket {
    tokens: f64,
    max_tokens: f64,
    refill_rate: f64,
    last_refill: Instant,
}

impl TokenBucket {
    fn new(max_tokens: f64, refill_rate: f64) -> Self {
        TokenBucket {
            tokens: max_tokens,
            max_tokens,
            refill_rate,
            last_refill: Instant::now(),
        }
    }

    fn refill(&mut self) {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_refill).as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.refill_rate).min(self.max_tokens);
        self.last_refill = now;
    }

    /// Attempt to consume one token. Returns remaining tokens if admitted.
    fn try_consume(&mut self) -> Option<f64> {
        self.refill();
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            Some(self.tokens)
        } else {
            None
        }
    }
}

/// Adaptive rate limiter: per-IP buckets whose max_tokens and refill_rate are
/// contracted when the client violates and relax back toward the base config
/// after quiet periods.
struct AdaptiveRateLimiter {
    buckets: HashMap<String, TokenBucket>,
    base_max_tokens: f64,
    base_refill_rate: f64,
}

impl AdaptiveRateLimiter {
    fn new(base_max_tokens: f64, base_refill_rate: f64) -> Self {
        AdaptiveRateLimiter {
            buckets: HashMap::new(),
            base_max_tokens,
            base_refill_rate,
        }
    }

    fn check(&mut self, ip: &str, reputation_score: f64) -> Option<f64> {
        // Reputation scales the budget: a pristine client gets the full base
        // budget, a suspicious one as little as 10% of it.
        let scale = (reputation_score / 100.0).clamp(0.1, 1.0);
        let bucket = self
            .buckets
            .entry(ip.to_string())
            .or_insert_with(|| TokenBucket::new(self.base_max_tokens, self.base_refill_rate));
        bucket.max_tokens = self.base_max_tokens * scale;
        bucket.refill_rate = self.base_refill_rate * scale;
        bucket.try_consume()
    }

    fn bucket_count(&self) -> usize {
        self.buckets.len()
    }
}

// ── CircuitBreaker ───────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Debug)]
enum CircuitState {
    Closed,
    Open,
    HalfOpen,
}

/// Trips when the shield itself observes a sustained burst of violations
/// (flood conditions). While Open, /check answers from the cheap static
/// posture (blocked set + reputation floor only) instead of running full
/// analysis, protecting the shield's own CPU during a volumetric attack.
struct CircuitBreaker {
    state: CircuitState,
    failure_count: u32,
    failure_threshold: u32,
    opened_at: Option<Instant>,
    reset_timeout: Duration,
}

impl CircuitBreaker {
    fn new(failure_threshold: u32, reset_timeout: Duration) -> Self {
        CircuitBreaker {
            state: CircuitState::Closed,
            failure_count: 0,
            failure_threshold,
            opened_at: None,
            reset_timeout,
        }
    }

    fn state(&mut self) -> CircuitState {
        if self.state == CircuitState::Open {
            if let Some(opened) = self.opened_at {
                if opened.elapsed() >= self.reset_timeout {
                    self.state = CircuitState::HalfOpen;
                }
            }
        }
        self.state
    }

    fn record_success(&mut self) {
        self.failure_count = 0;
        if self.state == CircuitState::HalfOpen {
            self.state = CircuitState::Closed;
            self.opened_at = None;
        }
    }

    fn record_failure(&mut self) {
        self.failure_count += 1;
        if self.state == CircuitState::HalfOpen
            || self.failure_count >= self.failure_threshold
        {
            self.state = CircuitState::Open;
            self.opened_at = Some(Instant::now());
        }
    }
}

// ── ConnectionAnalyzer ───────────────────────────────────────────────────────

struct WindowEntry {
    at: Instant,
    bytes: u64,
}

struct ConnectionProfile {
    window: VecDeque<WindowEntry>,
    active_connections: u32,
}

/// Sliding-window (60s) connection/request analyzer. Produces an additive
/// threat score from genuine traffic shape: request rate, byte volume,
/// concurrent connections, and request-line anomalies.
struct ConnectionAnalyzer {
    profiles: HashMap<String, ConnectionProfile>,
    window_secs: u64,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Debug)]
#[serde(rename_all = "lowercase")]
enum ThreatLevel {
    None,
    Low,
    Medium,
    High,
    Critical,
}

impl ConnectionAnalyzer {
    fn new() -> Self {
        ConnectionAnalyzer {
            profiles: HashMap::new(),
            window_secs: 60,
        }
    }

    fn observe(&mut self, ip: &str, content_length: u64, user_agent: &str) -> u32 {
        let cutoff = Instant::now() - Duration::from_secs(self.window_secs);
        let profile = self.profiles.entry(ip.to_string()).or_insert_with(|| {
            ConnectionProfile {
                window: VecDeque::new(),
                active_connections: 0,
            }
        });
        while let Some(front) = profile.window.front() {
            if front.at < cutoff {
                profile.window.pop_front();
            } else {
                break;
            }
        }
        profile.window.push_back(WindowEntry {
            at: Instant::now(),
            bytes: content_length,
        });
        profile.active_connections = profile.active_connections.saturating_add(1);

        let requests_in_window = profile.window.len() as u32;
        let bytes_in_window: u64 = profile.window.iter().map(|e| e.bytes).sum();

        let mut score: u32 = 0;
        // Request rate: >300/min is suspicious, >1000/min is hostile.
        if requests_in_window > 300 {
            score += 30;
        }
        if requests_in_window > 1000 {
            score += 40;
        }
        // Byte flood: >64MB/min from one client.
        if bytes_in_window > 64 * 1024 * 1024 {
            score += 30;
        }
        // Connection churn.
        if profile.active_connections > 100 {
            score += 20;
        }
        // Empty UA on a mutating request is a classic botnet tell.
        if user_agent.is_empty() {
            score += 10;
        }
        score
    }

    fn release(&mut self, ip: &str) {
        if let Some(p) = self.profiles.get_mut(ip) {
            p.active_connections = p.active_connections.saturating_sub(1);
        }
    }

    fn classify(score: u32) -> ThreatLevel {
        match score {
            0 => ThreatLevel::None,
            1..=20 => ThreatLevel::Low,
            21..=50 => ThreatLevel::Medium,
            51..=80 => ThreatLevel::High,
            _ => ThreatLevel::Critical,
        }
    }
}

// ── IpReputation ─────────────────────────────────────────────────────────────

struct ReputationEntry {
    reputation_score: f64,
    total_requests: u64,
    violations: u64,
}

/// Per-IP reputation: starts at 100, decays on violations, recovers slowly on
/// clean traffic. Below the configured floor the IP is auto-added to
/// blocked_ips (and can be removed again via /unblock after recovery).
struct IpReputation {
    entries: HashMap<String, ReputationEntry>,
    blocked_ips: HashSet<String>,
    block_reasons: HashMap<String, String>,
}

impl IpReputation {
    fn new() -> Self {
        IpReputation {
            entries: HashMap::new(),
            blocked_ips: HashSet::new(),
            block_reasons: HashMap::new(),
        }
    }

    fn score(&mut self, ip: &str) -> f64 {
        self.entries
            .entry(ip.to_string())
            .or_insert(ReputationEntry {
                reputation_score: 100.0,
                total_requests: 0,
                violations: 0,
            })
            .reputation_score
    }

    fn record_clean(&mut self, ip: &str) {
        let e = self.entries.entry(ip.to_string()).or_insert(ReputationEntry {
            reputation_score: 100.0,
            total_requests: 0,
            violations: 0,
        });
        e.total_requests += 1;
        e.reputation_score = (e.reputation_score + 0.5).min(100.0);
    }

    fn record_violation(&mut self, ip: &str, severity: u32, floor: f64) {
        let e = self.entries.entry(ip.to_string()).or_insert(ReputationEntry {
            reputation_score: 100.0,
            total_requests: 0,
            violations: 0,
        });
        e.total_requests += 1;
        e.violations += 1;
        e.reputation_score = (e.reputation_score - severity as f64 * 5.0).max(0.0);
        if e.reputation_score <= floor {
            self.block(ip, "reputation floor breached (auto)");
        }
    }

    fn block(&mut self, ip: &str, reason: &str) {
        self.blocked_ips.insert(ip.to_string());
        self.block_reasons.insert(ip.to_string(), reason.to_string());
    }

    fn unblock(&mut self, ip: &str) -> bool {
        self.block_reasons.remove(ip);
        self.blocked_ips.remove(ip)
    }

    fn is_blocked(&self, ip: &str) -> bool {
        self.blocked_ips.contains(ip)
    }
}

// ── API types — contract with server/middleware/securityOrchestrator.ts ─────

#[derive(Deserialize)]
struct CheckRequest {
    ip: String,
    path: Option<String>,
    method: Option<String>,
    user_agent: Option<String>,
    content_length: Option<u64>,
}

#[derive(Serialize)]
struct CheckResponse {
    allowed: bool,
    reason: String,
    rate_limit_remaining: f64,
    circuit_state: String,
    threat_level: ThreatLevel,
}

#[derive(Deserialize)]
struct BlockRequest {
    ip: String,
    reason: Option<String>,
}

#[derive(Serialize)]
struct StatsResponse {
    status: String,
    tracked_ips: usize,
    limiter_buckets: usize,
    blocked_ips: usize,
    circuit_state: String,
    circuit_failure_count: u32,
    total_checks: u64,
    total_denied: u64,
    uptime_seconds: i64,
    timestamp: String,
}

struct AppState {
    limiter: AdaptiveRateLimiter,
    breaker: CircuitBreaker,
    analyzer: ConnectionAnalyzer,
    reputation: IpReputation,
    config: Config,
    total_checks: u64,
    total_denied: u64,
    started_at: Instant,
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async fn check(state: web::Data<Mutex<AppState>>, body: web::Json<CheckRequest>) -> HttpResponse {
    let req = body.into_inner();
    let mut s = match state.lock() {
        Ok(s) => s,
        Err(_) => {
            // Poisoned state: fail loud, never fabricate an "allow".
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "allowed": false,
                "reason": "ddos-shield internal state poisoned",
            }));
        }
    };

    s.total_checks += 1;
    let ip = req.ip.clone();

    // 1. Static blocklist first (cheapest).
    if s.reputation.is_blocked(&ip) {
        s.total_denied += 1;
        let reason = s
            .reputation
            .block_reasons
            .get(&ip)
            .cloned()
            .unwrap_or_else(|| "ip blocked".to_string());
        return HttpResponse::Forbidden().json(CheckResponse {
            allowed: false,
            reason,
            rate_limit_remaining: 0.0,
            circuit_state: format!("{:?}", s.breaker.state()).to_lowercase(),
            threat_level: ThreatLevel::High,
        });
    }

    let circuit = s.breaker.state();
    let ua = req.user_agent.clone().unwrap_or_default();
    let content_length = req.content_length.unwrap_or(0);

    // 2. Circuit Open: flood posture — admit only high-reputation clients,
    //    skip the expensive analysis path to protect the shield itself.
    if circuit == CircuitState::Open {
        let score = s.reputation.score(&ip);
        if score < 80.0 {
            s.total_denied += 1;
            s.breaker.record_failure();
            return HttpResponse::TooManyRequests().json(CheckResponse {
                allowed: false,
                reason: "circuit open: flood posture, insufficient reputation".to_string(),
                rate_limit_remaining: 0.0,
                circuit_state: "open".to_string(),
                threat_level: ThreatLevel::Critical,
            });
        }
        s.breaker.record_success();
        s.reputation.record_clean(&ip);
        return HttpResponse::Ok().json(CheckResponse {
            allowed: true,
            reason: "circuit open: high-reputation passthrough".to_string(),
            rate_limit_remaining: 0.0,
            circuit_state: "open".to_string(),
            threat_level: ThreatLevel::None,
        });
    }

    // 3. Full analysis path (circuit Closed or HalfOpen probe).
    let threat_score = s.analyzer.observe(&ip, content_length, &ua);
    let threat_level = ConnectionAnalyzer::classify(threat_score);
    s.analyzer.release(&ip);

    if threat_score > 0 {
        let floor = s.config.block_reputation_floor;
        s.reputation
            .record_violation(&ip, (threat_score / 20).max(1), floor);
    }

    if matches!(threat_level, ThreatLevel::Critical) {
        s.breaker.record_failure();
        s.total_denied += 1;
        return HttpResponse::TooManyRequests().json(CheckResponse {
            allowed: false,
            reason: "critical threat level".to_string(),
            rate_limit_remaining: 0.0,
            circuit_state: format!("{:?}", s.breaker.state()).to_lowercase(),
            threat_level,
        });
    }

    // 4. Adaptive token bucket scaled by live reputation.
    let reputation_score = s.reputation.score(&ip);
    match s.limiter.check(&ip, reputation_score) {
        Some(remaining) => {
            if threat_score == 0 {
                s.reputation.record_clean(&ip);
            }
            s.breaker.record_success();
            HttpResponse::Ok().json(CheckResponse {
                allowed: true,
                reason: "ok".to_string(),
                rate_limit_remaining: remaining,
                circuit_state: format!("{:?}", s.breaker.state()).to_lowercase(),
                threat_level,
            })
        }
        None => {
            let floor = s.config.block_reputation_floor;
            s.reputation.record_violation(&ip, 1, floor);
            s.total_denied += 1;
            HttpResponse::TooManyRequests().json(CheckResponse {
                allowed: false,
                reason: "rate limit exceeded".to_string(),
                rate_limit_remaining: 0.0,
                circuit_state: format!("{:?}", s.breaker.state()).to_lowercase(),
                threat_level,
            })
        }
    }
}

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "ddos-shield",
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

async fn stats(state: web::Data<Mutex<AppState>>) -> HttpResponse {
    let mut s = match state.lock() {
        Ok(s) => s,
        Err(_) => {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "status": "error",
                "reason": "state poisoned",
            }))
        }
    };
    HttpResponse::Ok().json(StatsResponse {
        status: "ok".to_string(),
        tracked_ips: s.reputation.entries.len(),
        limiter_buckets: s.limiter.bucket_count(),
        blocked_ips: s.reputation.blocked_ips.len(),
        circuit_state: format!("{:?}", s.breaker.state()).to_lowercase(),
        circuit_failure_count: s.breaker.failure_count,
        total_checks: s.total_checks,
        total_denied: s.total_denied,
        uptime_seconds: s.started_at.elapsed().as_secs() as i64,
        timestamp: Utc::now().to_rfc3339(),
    })
}

async fn block(state: web::Data<Mutex<AppState>>, body: web::Json<BlockRequest>) -> HttpResponse {
    let req = body.into_inner();
    if req.ip.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "ip is required",
        }));
    }
    let mut s = match state.lock() {
        Ok(s) => s,
        Err(_) => return HttpResponse::InternalServerError().finish(),
    };
    let reason = req.reason.unwrap_or_else(|| "manual block".to_string());
    s.reputation.block(&req.ip, &reason);
    HttpResponse::Ok().json(serde_json::json!({
        "blocked": true,
        "ip": req.ip,
        "reason": reason,
    }))
}

async fn unblock(state: web::Data<Mutex<AppState>>, body: web::Json<BlockRequest>) -> HttpResponse {
    let req = body.into_inner();
    let mut s = match state.lock() {
        Ok(s) => s,
        Err(_) => return HttpResponse::InternalServerError().finish(),
    };
    let was = s.reputation.unblock(&req.ip);
    HttpResponse::Ok().json(serde_json::json!({
        "unblocked": was,
        "ip": req.ip,
    }))
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init();
    let config = Config::from_env();
    let state = web::Data::new(Mutex::new(AppState {
        limiter: AdaptiveRateLimiter::new(config.base_max_tokens, config.base_refill_rate),
        breaker: CircuitBreaker::new(config.failure_threshold, config.circuit_reset),
        analyzer: ConnectionAnalyzer::new(),
        reputation: IpReputation::new(),
        config: config.clone(),
        total_checks: 0,
        total_denied: 0,
        started_at: Instant::now(),
    }));

    log::info!("ddos-shield listening on 0.0.0.0:{}", config.port);
    HttpServer::new(move || {
        App::new()
            .app_data(state.clone())
            .route("/check", web::post().to(check))
            .route("/health", web::get().to(health))
            .route("/stats", web::get().to(stats))
            .route("/block", web::post().to(block))
            .route("/unblock", web::post().to(unblock))
    })
    .bind(("0.0.0.0", config.port))?
    .run()
    .await
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_bucket_admits_until_empty() {
        let mut b = TokenBucket::new(3.0, 0.0); // no refill
        assert!(b.try_consume().is_some());
        assert!(b.try_consume().is_some());
        assert!(b.try_consume().is_some());
        assert!(b.try_consume().is_none());
    }

    #[test]
    fn token_bucket_refills_over_time() {
        let mut b = TokenBucket::new(1.0, 1000.0);
        assert!(b.try_consume().is_some());
        std::thread::sleep(Duration::from_millis(5));
        assert!(b.try_consume().is_some());
    }

    #[test]
    fn adaptive_limiter_scales_with_reputation() {
        let mut l = AdaptiveRateLimiter::new(10.0, 1.0);
        // Low reputation (0.1 scale) clamps max_tokens to 1.
        assert!(l.check("1.1.1.1", 0.0).is_some());
        assert!(l.check("1.1.1.1", 0.0).is_none());
        // High reputation gets the full budget.
        for _ in 0..10 {
            assert!(l.check("2.2.2.2", 100.0).is_some());
        }
        assert!(l.check("2.2.2.2", 100.0).is_none());
    }

    #[test]
    fn circuit_breaker_opens_and_recovers() {
        let mut cb = CircuitBreaker::new(2, Duration::from_millis(10));
        assert_eq!(cb.state(), CircuitState::Closed);
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Closed);
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);
        std::thread::sleep(Duration::from_millis(15));
        assert_eq!(cb.state(), CircuitState::HalfOpen);
        cb.record_success();
        assert_eq!(cb.state(), CircuitState::Closed);
    }

    #[test]
    fn reputation_blocks_below_floor() {
        let mut r = IpReputation::new();
        for _ in 0..20 {
            r.record_violation("9.9.9.9", 2, 10.0);
        }
        assert!(r.is_blocked("9.9.9.9"));
        assert!(r.unblock("9.9.9.9"));
        assert!(!r.is_blocked("9.9.9.9"));
    }

    #[test]
    fn analyzer_classifies_flood() {
        let mut a = ConnectionAnalyzer::new();
        let mut last = 0;
        for _ in 0..1100 {
            last = a.observe("3.3.3.3", 0, "agent");
        }
        assert!(matches!(
            ConnectionAnalyzer::classify(last),
            ThreatLevel::High | ThreatLevel::Critical
        ));
    }
}
