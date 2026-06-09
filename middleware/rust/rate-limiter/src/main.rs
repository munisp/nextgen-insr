//! POS-54Link Rate Limiter — High-performance sliding window rate limiter
//! Built in Rust for maximum throughput with minimal latency overhead.
//! Supports per-IP, per-API-key, and per-tenant rate limiting.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

/// Sliding window counter for rate limiting
#[derive(Clone)]
struct SlidingWindow {
    window_size: Duration,
    max_requests: u64,
    buckets: Vec<(Instant, u64)>,
}

impl SlidingWindow {
    fn new(window_size: Duration, max_requests: u64) -> Self {
        Self {
            window_size,
            max_requests,
            buckets: Vec::new(),
        }
    }

    fn allow(&mut self) -> bool {
        let now = Instant::now();
        let cutoff = now - self.window_size;

        // Remove expired buckets
        self.buckets.retain(|(t, _)| *t > cutoff);

        let total: u64 = self.buckets.iter().map(|(_, c)| c).sum();
        if total >= self.max_requests {
            return false;
        }

        // Add to current bucket (1-second granularity)
        if let Some(last) = self.buckets.last_mut() {
            if now.duration_since(last.0) < Duration::from_secs(1) {
                last.1 += 1;
                return true;
            }
        }
        self.buckets.push((now, 1));
        true
    }

    fn remaining(&self) -> u64 {
        let now = Instant::now();
        let cutoff = now - self.window_size;
        let total: u64 = self.buckets.iter()
            .filter(|(t, _)| *t > cutoff)
            .map(|(_, c)| c)
            .sum();
        self.max_requests.saturating_sub(total)
    }
}

/// Rate limit configuration per tier
#[derive(Clone)]
struct TierConfig {
    requests_per_minute: u64,
    burst_size: u64,
}

/// Rate limiter with multi-tier support
struct RateLimiter {
    limiters: RwLock<HashMap<String, SlidingWindow>>,
    tiers: HashMap<String, TierConfig>,
    default_tier: TierConfig,
}

impl RateLimiter {
    fn new() -> Self {
        let mut tiers = HashMap::new();
        // POS-54Link tier definitions
        tiers.insert("free".to_string(), TierConfig { requests_per_minute: 60, burst_size: 10 });
        tiers.insert("basic".to_string(), TierConfig { requests_per_minute: 300, burst_size: 50 });
        tiers.insert("pro".to_string(), TierConfig { requests_per_minute: 1000, burst_size: 200 });
        tiers.insert("enterprise".to_string(), TierConfig { requests_per_minute: 5000, burst_size: 1000 });
        tiers.insert("internal".to_string(), TierConfig { requests_per_minute: 10000, burst_size: 2000 });

        Self {
            limiters: RwLock::new(HashMap::new()),
            tiers,
            default_tier: TierConfig { requests_per_minute: 100, burst_size: 20 },
        }
    }

    fn check(&self, key: &str, tier: &str) -> (bool, u64, u64) {
        let config = self.tiers.get(tier).unwrap_or(&self.default_tier);

        let mut limiters = self.limiters.write().unwrap();
        let window = limiters.entry(key.to_string()).or_insert_with(|| {
            SlidingWindow::new(Duration::from_secs(60), config.requests_per_minute)
        });

        let allowed = window.allow();
        let remaining = window.remaining();
        (allowed, remaining, config.requests_per_minute)
    }

    fn cleanup(&self) {
        let mut limiters = self.limiters.write().unwrap();
        let cutoff = Instant::now() - Duration::from_secs(120);
        limiters.retain(|_, w| {
            w.buckets.last().map_or(false, |(t, _)| *t > cutoff)
        });
    }
}

/// Endpoint-specific rate limits
struct EndpointLimits {
    limits: HashMap<String, u64>,
}

impl EndpointLimits {
    fn new() -> Self {
        let mut limits = HashMap::new();
        // POS-54Link endpoint-specific limits (per minute)
        limits.insert("/api/v1/transactions".to_string(), 500);
        limits.insert("/api/v1/auth/login".to_string(), 10);
        limits.insert("/api/v1/auth/register".to_string(), 5);
        limits.insert("/api/v1/kyc/verify".to_string(), 20);
        limits.insert("/api/v1/kyc/liveness".to_string(), 30);
        limits.insert("/api/v1/settlements".to_string(), 100);
        limits.insert("/api/v1/agents".to_string(), 200);
        limits.insert("/api/v1/reports/export".to_string(), 10);
        limits.insert("/api/v1/webhooks".to_string(), 1000);
        Self { limits }
    }

    fn get_limit(&self, path: &str) -> Option<u64> {
        // Exact match first
        if let Some(limit) = self.limits.get(path) {
            return Some(*limit);
        }
        // Prefix match
        for (prefix, limit) in &self.limits {
            if path.starts_with(prefix) {
                return Some(*limit);
            }
        }
        None
    }
}

/// Response headers for rate limit info
struct RateLimitHeaders {
    limit: u64,
    remaining: u64,
    retry_after: Option<u64>,
}

impl RateLimitHeaders {
    fn to_headers(&self) -> Vec<(String, String)> {
        let mut headers = vec![
            ("X-RateLimit-Limit".to_string(), self.limit.to_string()),
            ("X-RateLimit-Remaining".to_string(), self.remaining.to_string()),
            ("X-RateLimit-Reset".to_string(), "60".to_string()),
        ];
        if let Some(retry) = self.retry_after {
            headers.push(("Retry-After".to_string(), retry.to_string()));
        }
        headers
    }
}


// ── Middleware Integration ────────────────────────────────────────────────
// Redis cache client for caching and session management
struct RedisClient {
    addr: String,
}

impl RedisClient {
    fn new() -> Self {
        let addr = env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".to_string());
        println!("[middleware] Redis client configured: {}", addr);
        RedisClient { addr }
    }

    fn cache_get(&self, key: &str) -> Option<String> {
        // Production: use redis-rs crate with connection pool
        let _ = key;
        None
    }

    fn cache_set(&self, key: &str, value: &str, ttl_secs: u64) {
        // Production: use redis-rs SET EX
        let _ = (key, value, ttl_secs);
    }

    fn cache_invalidate(&self, keys: &[&str]) {
        // Production: use redis-rs DEL
        let _ = keys;
    }
}

// Kafka event publisher for async event streaming
struct KafkaPublisher {
    brokers: String,
    service_name: String,
}

impl KafkaPublisher {
    fn new(service_name: &str) -> Self {
        let brokers = env::var("KAFKA_BROKERS").unwrap_or_else(|_| "localhost:9092".to_string());
        println!("[middleware] Kafka producer configured: {} topic={}-events", brokers, service_name);
        KafkaPublisher {
            brokers,
            service_name: service_name.to_string(),
        }
    }

    fn publish_event(&self, event_type: &str, key: &str, payload: &str) {
        // Production: use rdkafka crate with producer
        println!(
            "[kafka] event={} key={} source={} size={}",
            event_type, key, self.service_name, payload.len()
        );
    }
}

// OpenSearch structured logger for centralized logging
struct OpenSearchLogger {
    url: String,
    service_name: String,
}

impl OpenSearchLogger {
    fn new(service_name: &str) -> Self {
        let url = env::var("OPENSEARCH_URL").unwrap_or_else(|_| "http://localhost:9200".to_string());
        println!("[middleware] OpenSearch logger configured: {}", url);
        OpenSearchLogger {
            url,
            service_name: service_name.to_string(),
        }
    }

    fn index_log(&self, level: &str, message: &str) {
        // Production: use opensearch-rs crate
        println!(
            "[opensearch] service={} level={} msg={}",
            self.service_name, level, message
        );
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

fn main() {
    let limiter = Arc::new(RateLimiter::new());
    let endpoint_limits = Arc::new(EndpointLimits::new());

    // Cleanup thread
    let limiter_clone = Arc::clone(&limiter);
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(60));
            limiter_clone.cleanup();
        }
    });

    let addr: SocketAddr = std::env::var("LISTEN_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8092".to_string())
        .parse()
        .expect("Invalid listen address");

    println!("[RateLimiter] Starting on {}", addr);
    println!("[RateLimiter] Tiers: free(60/m), basic(300/m), pro(1000/m), enterprise(5000/m), internal(10000/m)");
    println!("[RateLimiter] Endpoint-specific limits configured for {} paths", endpoint_limits.limits.len());

    // In production, this would use hyper/axum/actix-web
    // For now, demonstrate the core rate limiting logic
    let test_keys = vec![
        ("192.168.1.1", "free", "/api/v1/auth/login"),
        ("192.168.1.2", "pro", "/api/v1/transactions"),
        ("10.0.0.1", "enterprise", "/api/v1/agents"),
        ("10.0.0.2", "internal", "/api/v1/webhooks"),
    ];

    for (ip, tier, path) in &test_keys {
        let key = format!("{}:{}", ip, path);
        let (allowed, remaining, limit) = limiter.check(&key, tier);
        let headers = RateLimitHeaders {
            limit,
            remaining,
            retry_after: if allowed { None } else { Some(60) },
        };
        println!(
            "  {} {} tier={} allowed={} remaining={}/{}",
            ip, path, tier, allowed, remaining, limit
        );
        for (k, v) in headers.to_headers() {
            println!("    {}: {}", k, v);
        }
    }
}
