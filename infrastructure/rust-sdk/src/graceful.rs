//! Graceful shutdown and health probe support for Rust services.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::signal;
use tokio::sync::{watch, Mutex};

/// Health status of a single component.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ComponentHealth {
    pub name: String,
    pub connected: bool,
    pub latency_ms: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Tracks health of all registered components.
pub struct HealthRegistry {
    service_name: String,
    started: Instant,
    ready: Arc<Mutex<bool>>,
    checks: Arc<Mutex<HashMap<String, Box<dyn Fn() -> Result<(), String> + Send + Sync>>>>,
}

impl HealthRegistry {
    pub fn new(service_name: &str) -> Self {
        Self {
            service_name: service_name.to_string(),
            started: Instant::now(),
            ready: Arc::new(Mutex::new(true)),
            checks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn register<F>(&self, name: &str, check_fn: F)
    where
        F: Fn() -> Result<(), String> + Send + Sync + 'static,
    {
        self.checks.lock().await.insert(name.to_string(), Box::new(check_fn));
    }

    pub async fn set_ready(&self, ready: bool) {
        *self.ready.lock().await = ready;
    }

    pub async fn is_ready(&self) -> bool {
        *self.ready.lock().await
    }

    pub async fn check_all(&self) -> serde_json::Value {
        let checks = self.checks.lock().await;
        let mut components = serde_json::Map::new();
        let mut all_healthy = true;

        for (name, check_fn) in checks.iter() {
            let start = Instant::now();
            match check_fn() {
                Ok(()) => {
                    components.insert(name.clone(), serde_json::json!({
                        "connected": true,
                        "latency_ms": start.elapsed().as_secs_f64() * 1000.0,
                    }));
                }
                Err(e) => {
                    all_healthy = false;
                    components.insert(name.clone(), serde_json::json!({
                        "connected": false,
                        "latency_ms": start.elapsed().as_secs_f64() * 1000.0,
                        "error": e,
                    }));
                }
            }
        }

        serde_json::json!({
            "status": if all_healthy { "healthy" } else { "degraded" },
            "service": self.service_name,
            "uptime_seconds": self.started.elapsed().as_secs_f64(),
            "components": components,
        })
    }

    pub fn health_response(&self) -> serde_json::Value {
        serde_json::json!({
            "status": "healthy",
            "service": self.service_name,
            "uptime_seconds": self.started.elapsed().as_secs_f64(),
        })
    }

    pub fn liveness_response(&self) -> serde_json::Value {
        serde_json::json!({
            "alive": true,
            "service": self.service_name,
        })
    }

    pub async fn readiness_response(&self) -> serde_json::Value {
        serde_json::json!({
            "ready": *self.ready.lock().await,
            "service": self.service_name,
        })
    }
}

/// Manages graceful shutdown with signal handling and cleanup hooks.
pub struct GracefulShutdown {
    service_name: String,
    shutdown_tx: watch::Sender<bool>,
    shutdown_rx: watch::Receiver<bool>,
}

impl GracefulShutdown {
    pub fn new(service_name: &str) -> Self {
        let (tx, rx) = watch::channel(false);
        Self {
            service_name: service_name.to_string(),
            shutdown_tx: tx,
            shutdown_rx: rx,
        }
    }

    /// Returns a receiver that signals when shutdown is requested.
    pub fn subscribe(&self) -> watch::Receiver<bool> {
        self.shutdown_rx.clone()
    }

    /// Wait for SIGINT or SIGTERM and trigger shutdown.
    pub async fn wait_for_signal(&self) {
        let ctrl_c = async {
            signal::ctrl_c().await.expect("failed to install Ctrl+C handler");
        };

        #[cfg(unix)]
        let terminate = async {
            signal::unix::signal(signal::unix::SignalKind::terminate())
                .expect("failed to install signal handler")
                .recv()
                .await;
        };

        #[cfg(not(unix))]
        let terminate = std::future::pending::<()>();

        tokio::select! {
            _ = ctrl_c => {
                println!("[{}] SIGINT received, shutting down...", self.service_name);
            }
            _ = terminate => {
                println!("[{}] SIGTERM received, shutting down...", self.service_name);
            }
        }

        let _ = self.shutdown_tx.send(true);
    }

    /// Check if shutdown has been requested.
    pub fn is_shutting_down(&self) -> bool {
        *self.shutdown_rx.borrow()
    }
}

/// Run a server with graceful shutdown support.
pub async fn serve_with_shutdown<F, Fut>(
    service_name: &str,
    server_future: F,
    shutdown_timeout: Duration,
) where
    F: FnOnce(watch::Receiver<bool>) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let shutdown = GracefulShutdown::new(service_name);
    let rx = shutdown.subscribe();

    tokio::select! {
        _ = server_future(rx) => {
            println!("[{}] Server stopped", service_name);
        }
        _ = shutdown.wait_for_signal() => {
            println!("[{}] Waiting {}s for graceful shutdown...", service_name, shutdown_timeout.as_secs());
            tokio::time::sleep(shutdown_timeout).await;
        }
    }

    println!("[{}] Shutdown complete", service_name);
}
