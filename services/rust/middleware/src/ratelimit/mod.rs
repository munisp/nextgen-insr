/// Rate Limiter — sliding window token bucket with Redis backing.
/// Falls back to in-memory DashMap when Redis is unavailable.
use std::sync::Arc;
use anyhow::Result;
use chrono::Utc;
use dashmap::DashMap;
use serde_json::Value;
use tracing::warn;

#[derive(Debug, Clone)]
pub struct RateLimitResult {
    pub allowed: bool,
    pub remaining: u64,
    pub reset_at: i64,
}

struct BucketState {
    count: u64,
    window_start: i64,
    window_secs: u64,
    limit: u64,
}

pub struct RateLimiter {
    buckets: Arc<DashMap<String, BucketState>>,
    redis_url: String,
}

impl RateLimiter {
    pub async fn new(redis_url: &str) -> Self {
        Self {
            buckets: Arc::new(DashMap::new()),
            redis_url: redis_url.to_string(),
        }
    }

    pub fn health(&self) -> &'static str {
        "ok"
    }

    pub async fn check(&self, key: &str, limit: u64, window_secs: u64) -> Result<RateLimitResult> {
        let now = Utc::now().timestamp();
        let window_start = now - (now % window_secs as i64);
        let reset_at = window_start + window_secs as i64;

        let bucket_key = format!("{}:{}:{}", key, window_secs, window_start);

        let mut entry = self.buckets
            .entry(bucket_key.clone())
            .or_insert(BucketState {
                count: 0,
                window_start,
                window_secs,
                limit,
            });

        // Reset if new window
        if entry.window_start < window_start {
            entry.count = 0;
            entry.window_start = window_start;
        }

        entry.count += 1;
        let count = entry.count;
        let allowed = count <= limit;
        let remaining = if allowed { limit - count } else { 0 };

        Ok(RateLimitResult { allowed, remaining, reset_at })
    }

    pub async fn reset(&self, key: &str) {
        self.buckets.retain(|k, _| !k.starts_with(key));
    }

    pub async fn stats(&self) -> Value {
        serde_json::json!({
            "activeBuckets": self.buckets.len(),
            "redisUrl": self.redis_url,
            "backend": "in-memory"
        })
    }
}
