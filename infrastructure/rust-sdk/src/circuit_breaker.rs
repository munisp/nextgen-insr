//! Circuit breaker and retry with exponential backoff for Rust services.

use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

#[derive(Debug, Clone, PartialEq)]
pub enum CircuitState {
    Closed,
    Open,
    HalfOpen,
}

impl std::fmt::Display for CircuitState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CircuitState::Closed => write!(f, "closed"),
            CircuitState::Open => write!(f, "open"),
            CircuitState::HalfOpen => write!(f, "half-open"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct CircuitBreakerConfig {
    pub name: String,
    pub failure_threshold: u32,
    pub success_threshold: u32,
    pub timeout: Duration,
    pub half_open_max: u32,
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            name: "default".to_string(),
            failure_threshold: 5,
            success_threshold: 3,
            timeout: Duration::from_secs(30),
            half_open_max: 1,
        }
    }
}

impl CircuitBreakerConfig {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            ..Default::default()
        }
    }
}

struct CircuitBreakerInner {
    state: CircuitState,
    failure_count: u32,
    success_count: u32,
    last_failure: Option<Instant>,
    half_open_current: u32,
}

/// Implements the circuit breaker pattern for inter-service calls.
pub struct CircuitBreaker {
    config: CircuitBreakerConfig,
    inner: Arc<Mutex<CircuitBreakerInner>>,
}

impl CircuitBreaker {
    pub fn new(config: CircuitBreakerConfig) -> Self {
        Self {
            config,
            inner: Arc::new(Mutex::new(CircuitBreakerInner {
                state: CircuitState::Closed,
                failure_count: 0,
                success_count: 0,
                last_failure: None,
                half_open_current: 0,
            })),
        }
    }

    pub async fn execute<F, T, E>(&self, f: F) -> Result<T, CircuitBreakerError<E>>
    where
        F: std::future::Future<Output = Result<T, E>>,
    {
        {
            let mut inner = self.inner.lock().await;
            if !self.can_execute(&mut inner) {
                return Err(CircuitBreakerError::Open(self.config.name.clone()));
            }
        }

        match f.await {
            Ok(result) => {
                self.record_success().await;
                Ok(result)
            }
            Err(e) => {
                self.record_failure().await;
                Err(CircuitBreakerError::Inner(e))
            }
        }
    }

    pub async fn state(&self) -> CircuitState {
        self.inner.lock().await.state.clone()
    }

    fn can_execute(&self, inner: &mut CircuitBreakerInner) -> bool {
        match inner.state {
            CircuitState::Closed => true,
            CircuitState::Open => {
                if let Some(last) = inner.last_failure {
                    if last.elapsed() > self.config.timeout {
                        inner.state = CircuitState::HalfOpen;
                        inner.half_open_current = 0;
                        inner.success_count = 0;
                        return true;
                    }
                }
                false
            }
            CircuitState::HalfOpen => {
                if inner.half_open_current >= self.config.half_open_max {
                    return false;
                }
                inner.half_open_current += 1;
                true
            }
        }
    }

    async fn record_success(&self) {
        let mut inner = self.inner.lock().await;
        match inner.state {
            CircuitState::HalfOpen => {
                inner.success_count += 1;
                if inner.success_count >= self.config.success_threshold {
                    inner.state = CircuitState::Closed;
                    inner.failure_count = 0;
                    inner.success_count = 0;
                }
            }
            _ => {
                inner.failure_count = 0;
            }
        }
    }

    async fn record_failure(&self) {
        let mut inner = self.inner.lock().await;
        inner.failure_count += 1;
        inner.last_failure = Some(Instant::now());

        match inner.state {
            CircuitState::HalfOpen => {
                inner.state = CircuitState::Open;
            }
            CircuitState::Closed => {
                if inner.failure_count >= self.config.failure_threshold {
                    inner.state = CircuitState::Open;
                }
            }
            _ => {}
        }
    }
}

#[derive(Debug)]
pub enum CircuitBreakerError<E> {
    Open(String),
    Inner(E),
}

impl<E: std::fmt::Display> std::fmt::Display for CircuitBreakerError<E> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CircuitBreakerError::Open(name) => write!(f, "circuit breaker '{}' is open", name),
            CircuitBreakerError::Inner(e) => write!(f, "{}", e),
        }
    }
}

impl<E: std::fmt::Debug + std::fmt::Display> std::error::Error for CircuitBreakerError<E> {}

#[derive(Debug, Clone)]
pub struct RetryConfig {
    pub max_retries: u32,
    pub base_delay: Duration,
    pub max_delay: Duration,
    pub multiplier: f64,
    pub jitter_ratio: f64,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_retries: 3,
            base_delay: Duration::from_millis(100),
            max_delay: Duration::from_secs(5),
            multiplier: 2.0,
            jitter_ratio: 0.1,
        }
    }
}

/// Execute an async function with exponential backoff and jitter.
pub async fn retry_with_backoff<F, Fut, T, E>(
    config: &RetryConfig,
    mut f: F,
) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
{
    let mut last_error: Option<E> = None;

    for attempt in 0..=config.max_retries {
        match f().await {
            Ok(result) => return Ok(result),
            Err(e) => {
                last_error = Some(e);
                if attempt == config.max_retries {
                    break;
                }

                let delay_ms = (config.base_delay.as_millis() as f64)
                    * config.multiplier.powi(attempt as i32);
                let delay_ms = delay_ms.min(config.max_delay.as_millis() as f64);
                let jitter = delay_ms * config.jitter_ratio * (rand_f64() * 2.0 - 1.0);
                let sleep_ms = (delay_ms + jitter).max(0.0) as u64;

                tokio::time::sleep(Duration::from_millis(sleep_ms)).await;
            }
        }
    }

    Err(last_error.expect("retry loop must record at least one error"))
}

fn rand_f64() -> f64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .hash(&mut hasher);
    (hasher.finish() % 10000) as f64 / 10000.0
}
