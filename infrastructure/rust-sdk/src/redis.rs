//! Redis client with connection pooling, rate limiting, distributed locks,
//! cache invalidation, KYC gate, session management, and pub/sub.

use redis::aio::ConnectionManager;
use redis::{AsyncCommands, Client, Script};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use uuid::Uuid;

/// Lua script for atomic rate limiting (INCR + EXPIRE in one call).
const RATE_LIMIT_SCRIPT: &str = r#"
local key = KEYS[1]
local max = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local current = redis.call('INCR', key)
if current == 1 then
    redis.call('EXPIRE', key, window)
end
if current > max then
    return 0
end
return 1
"#;

/// Lua script for safe lock release (only owner can release).
const RELEASE_LOCK_SCRIPT: &str = r#"
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
else
    return 0
end
"#;

/// Lua script for cache invalidation with pub/sub notification.
const INVALIDATE_AND_NOTIFY_SCRIPT: &str = r#"
local deleted = 0
local cursor = "0"
repeat
    local result = redis.call('SCAN', cursor, 'MATCH', KEYS[1], 'COUNT', 100)
    cursor = result[1]
    local keys = result[2]
    for _, key in ipairs(keys) do
        redis.call('DEL', key)
        deleted = deleted + 1
    end
until cursor == "0"
if deleted > 0 then
    redis.call('PUBLISH', '__cache_invalidation__', KEYS[1])
end
return deleted
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KYCGate {
    pub allowed: bool,
    pub level: u8,
    pub ts: u64,
}

#[derive(Debug, Clone)]
pub struct LockGuard {
    pub key: String,
    pub owner_id: String,
}

/// Circuit breaker state for Redis operations.
#[derive(Debug, Clone, Copy, PartialEq)]
enum CircuitState {
    Closed,
    Open,
    HalfOpen,
}

struct CircuitBreakerState {
    state: CircuitState,
    failure_count: u32,
    last_failure: std::time::Instant,
    success_count: u32,
}

pub struct RedisClient {
    conn: Arc<RwLock<Option<ConnectionManager>>>,
    addr: String,
    circuit: Arc<RwLock<CircuitBreakerState>>,
    rate_limit_script: Script,
    release_lock_script: Script,
    invalidate_script: Script,
}

impl RedisClient {
    pub fn new(addr: &str) -> Self {
        let client = Self {
            conn: Arc::new(RwLock::new(None)),
            addr: format!("redis://{}", addr),
            circuit: Arc::new(RwLock::new(CircuitBreakerState {
                state: CircuitState::Closed,
                failure_count: 0,
                last_failure: std::time::Instant::now(),
                success_count: 0,
            })),
            rate_limit_script: Script::new(RATE_LIMIT_SCRIPT),
            release_lock_script: Script::new(RELEASE_LOCK_SCRIPT),
            invalidate_script: Script::new(INVALIDATE_AND_NOTIFY_SCRIPT),
        };
        client
    }

    /// Initialize async connection (must be called after construction).
    pub async fn connect(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let client = Client::open(self.addr.as_str())?;
        let mgr = ConnectionManager::new(client).await?;
        let mut conn = self.conn.write().await;
        *conn = Some(mgr);
        tracing::info!(addr = %self.addr, "redis_connected");
        Ok(())
    }

    async fn get_conn(&self) -> Result<ConnectionManager, Box<dyn std::error::Error + Send + Sync>> {
        // Circuit breaker check
        {
            let cb = self.circuit.read().await;
            match cb.state {
                CircuitState::Open => {
                    if cb.last_failure.elapsed() < Duration::from_secs(30) {
                        return Err("Redis circuit breaker is open".into());
                    }
                    // Allow half-open attempt
                }
                _ => {}
            }
        }

        let conn = self.conn.read().await;
        match conn.as_ref() {
            Some(c) => Ok(c.clone()),
            None => {
                drop(conn);
                // Try to reconnect
                self.connect().await?;
                let conn = self.conn.read().await;
                conn.as_ref().cloned().ok_or_else(|| "Redis not connected".into())
            }
        }
    }

    async fn record_success(&self) {
        let mut cb = self.circuit.write().await;
        cb.failure_count = 0;
        cb.success_count += 1;
        if cb.state == CircuitState::HalfOpen && cb.success_count >= 3 {
            cb.state = CircuitState::Closed;
            tracing::info!("redis_circuit_breaker: closed");
        }
    }

    async fn record_failure(&self) {
        let mut cb = self.circuit.write().await;
        cb.failure_count += 1;
        cb.last_failure = std::time::Instant::now();
        cb.success_count = 0;
        if cb.failure_count >= 5 {
            cb.state = CircuitState::Open;
            tracing::warn!("redis_circuit_breaker: opened after {} failures", cb.failure_count);
        }
    }

    pub async fn ping(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut conn = self.get_conn().await?;
        let result: Result<String, _> = redis::cmd("PING").query_async(&mut conn).await;
        match result {
            Ok(_) => { self.record_success().await; Ok(()) }
            Err(e) => { self.record_failure().await; Err(e.into()) }
        }
    }

    /// Cache a JSON-serializable value with TTL.
    pub async fn cache_json(&self, key: &str, value: &serde_json::Value, ttl_seconds: u64) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut conn = self.get_conn().await?;
        let data = serde_json::to_string(value)?;
        let result: Result<(), _> = conn.set_ex(key, &data, ttl_seconds).await;
        match result {
            Ok(_) => { self.record_success().await; Ok(()) }
            Err(e) => { self.record_failure().await; Err(e.into()) }
        }
    }

    /// Get a cached JSON value.
    pub async fn get_cached_json(&self, key: &str) -> Result<Option<serde_json::Value>, Box<dyn std::error::Error + Send + Sync>> {
        let mut conn = self.get_conn().await?;
        let result: Result<Option<String>, _> = conn.get(key).await;
        match result {
            Ok(Some(data)) => {
                self.record_success().await;
                Ok(Some(serde_json::from_str(&data)?))
            }
            Ok(None) => { self.record_success().await; Ok(None) }
            Err(e) => { self.record_failure().await; Err(e.into()) }
        }
    }

    /// Atomic rate limiting using Lua script (no race condition).
    pub async fn rate_limit(&self, key: &str, max_requests: u64, window_seconds: u64) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let mut conn = self.get_conn().await?;
        let result: Result<i64, _> = self.rate_limit_script
            .key(key)
            .arg(max_requests)
            .arg(window_seconds)
            .invoke_async(&mut conn)
            .await;
        match result {
            Ok(v) => { self.record_success().await; Ok(v == 1) }
            Err(e) => { self.record_failure().await; Err(e.into()) }
        }
    }

    /// Acquire a distributed lock with owner ID (safe release).
    pub async fn acquire_lock(&self, key: &str, ttl_seconds: u64) -> Result<Option<LockGuard>, Box<dyn std::error::Error + Send + Sync>> {
        let mut conn = self.get_conn().await?;
        let owner_id = Uuid::new_v4().to_string();
        let lock_key = format!("lock:{}", key);
        let result: Result<Option<()>, _> = redis::cmd("SET")
            .arg(&lock_key)
            .arg(&owner_id)
            .arg("NX")
            .arg("EX")
            .arg(ttl_seconds)
            .query_async(&mut conn)
            .await;
        match result {
            Ok(Some(())) => {
                self.record_success().await;
                Ok(Some(LockGuard { key: lock_key, owner_id }))
            }
            Ok(None) => { self.record_success().await; Ok(None) }
            Err(e) => { self.record_failure().await; Err(e.into()) }
        }
    }

    /// Release a distributed lock (only the owner can release).
    pub async fn release_lock(&self, guard: &LockGuard) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let mut conn = self.get_conn().await?;
        let result: Result<i64, _> = self.release_lock_script
            .key(&guard.key)
            .arg(&guard.owner_id)
            .invoke_async(&mut conn)
            .await;
        match result {
            Ok(v) => { self.record_success().await; Ok(v == 1) }
            Err(e) => { self.record_failure().await; Err(e.into()) }
        }
    }

    /// Publish a message to a Redis channel.
    pub async fn publish(&self, channel: &str, message: &serde_json::Value) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut conn = self.get_conn().await?;
        let data = serde_json::to_string(message)?;
        let result: Result<(), _> = conn.publish(channel, &data).await;
        match result {
            Ok(_) => { self.record_success().await; Ok(()) }
            Err(e) => { self.record_failure().await; Err(e.into()) }
        }
    }

    /// Set KYC gate for a user.
    pub async fn set_kyc_gate(&self, user_id: &str, allowed: bool, level: u8, ttl: u64) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let gate = KYCGate {
            allowed,
            level,
            ts: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs(),
        };
        self.cache_json(&format!("kyc:gate:{}", user_id), &serde_json::to_value(&gate)?, ttl).await
    }

    /// Get KYC gate for a user.
    pub async fn get_kyc_gate(&self, user_id: &str) -> Result<Option<KYCGate>, Box<dyn std::error::Error + Send + Sync>> {
        match self.get_cached_json(&format!("kyc:gate:{}", user_id)).await? {
            Some(v) => Ok(Some(serde_json::from_value(v)?)),
            None => Ok(None),
        }
    }

    /// Cache a policy with default 1hr TTL.
    pub async fn cache_policy(&self, policy_id: &str, data: &serde_json::Value, ttl: u64) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.cache_json(&format!("policy:{}", policy_id), data, ttl).await
    }

    /// Get cached policy.
    pub async fn get_cached_policy(&self, policy_id: &str) -> Result<Option<serde_json::Value>, Box<dyn std::error::Error + Send + Sync>> {
        self.get_cached_json(&format!("policy:{}", policy_id)).await
    }

    /// Cache a session with default 30min TTL.
    pub async fn cache_session(&self, session_id: &str, data: &serde_json::Value, ttl: u64) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.cache_json(&format!("session:{}", session_id), data, ttl).await
    }

    /// Get cached session.
    pub async fn get_session(&self, session_id: &str) -> Result<Option<serde_json::Value>, Box<dyn std::error::Error + Send + Sync>> {
        self.get_cached_json(&format!("session:{}", session_id)).await
    }

    /// Invalidate all keys matching a pattern and notify subscribers.
    pub async fn invalidate_pattern(&self, pattern: &str) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
        let mut conn = self.get_conn().await?;
        let result: Result<i64, _> = self.invalidate_script
            .key(pattern)
            .invoke_async(&mut conn)
            .await;
        match result {
            Ok(v) => { self.record_success().await; Ok(v as u64) }
            Err(e) => { self.record_failure().await; Err(e.into()) }
        }
    }

    /// Publish a cache invalidation event for other services to consume.
    pub async fn publish_invalidation(&self, entity_type: &str, entity_id: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let event = serde_json::json!({
            "type": "cache_invalidation",
            "entity_type": entity_type,
            "entity_id": entity_id,
            "timestamp": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs(),
        });
        self.publish("__cache_invalidation__", &event).await
    }

    /// Get circuit breaker state.
    pub async fn circuit_state(&self) -> &'static str {
        let cb = self.circuit.read().await;
        match cb.state {
            CircuitState::Closed => "closed",
            CircuitState::Open => "open",
            CircuitState::HalfOpen => "half-open",
        }
    }

    /// Warm cache by preloading commonly accessed keys.
    pub async fn warm_cache(&self, entries: Vec<(&str, serde_json::Value, u64)>) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
        let mut loaded = 0u64;
        for (key, value, ttl) in entries {
            if self.cache_json(key, &value, ttl).await.is_ok() {
                loaded += 1;
            }
        }
        tracing::info!(loaded, "cache_warmup_complete");
        Ok(loaded)
    }

    pub async fn close(&self) {
        let mut conn = self.conn.write().await;
        *conn = None;
    }
}
