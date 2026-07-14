use actix_web::HttpRequest;
use reqwest::Client;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum SecurityError {
    #[error("Request blocked: {0}")]
    Blocked(String),
    #[error("Rate limit exceeded")]
    RateLimited,
    #[error("Invalid input detected: {0}")]
    InvalidInput(String),
}

pub struct OpenAppSecClient {
    base_url: String,
    client: Client,
    enabled: bool,
}

impl OpenAppSecClient {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.to_string(),
            client: Client::new(),
            enabled: true,
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    pub async fn validate_request(&self, req: &HttpRequest) -> Result<(), SecurityError> {
        if !self.enabled {
            return Ok(());
        }

        // SQL injection patterns
        let path = req.path();
        let query = req.query_string();
        let combined = format!("{} {}", path, query);
        let lower = combined.to_lowercase();

        let sql_patterns = [
            "select ", "drop ", "insert ", "update ", "delete ",
            "union ", "-- ", "; ", "1=1", "or 1=",
        ];
        for pattern in &sql_patterns {
            if lower.contains(pattern) {
                tracing::warn!(pattern = pattern, path = path, "sql_injection_blocked");
                return Err(SecurityError::Blocked(format!("SQL injection pattern detected: {}", pattern)));
            }
        }

        // XSS patterns
        let xss_patterns = [
            "<script", "javascript:", "onerror=", "onload=",
            "onclick=", "eval(", "document.cookie",
        ];
        for pattern in &xss_patterns {
            if lower.contains(pattern) {
                tracing::warn!(pattern = pattern, path = path, "xss_blocked");
                return Err(SecurityError::Blocked(format!("XSS pattern detected: {}", pattern)));
            }
        }

        // Path traversal
        if path.contains("..") || path.contains("%2e%2e") {
            return Err(SecurityError::Blocked("Path traversal detected".to_string()));
        }

        // Check with remote OpenAppSec if available
        let _ = self.check_remote(req).await;

        Ok(())
    }

    async fn check_remote(&self, req: &HttpRequest) -> Result<(), SecurityError> {
        let payload = serde_json::json!({
            "method": req.method().as_str(),
            "path": req.path(),
            "query": req.query_string(),
            "headers": req.headers().iter()
                .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
                .collect::<std::collections::HashMap<String, String>>(),
            "client_ip": req.peer_addr().map(|a| a.to_string()).unwrap_or_default(),
        });

        let url = format!("{}/api/v1/check", self.base_url);
        let resp = self.client.post(&url).json(&payload).send().await;

        match resp {
            Ok(r) if r.status().is_success() => {
                let result: serde_json::Value = r.json().await.unwrap_or_default();
                let blocked = result.get("blocked").and_then(|v| v.as_bool()).unwrap_or(false);
                if blocked {
                    let reason = result.get("reason").and_then(|v| v.as_str()).unwrap_or("unknown");
                    return Err(SecurityError::Blocked(reason.to_string()));
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    pub async fn report_incident(&self, incident_type: &str, details: &str, severity: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let payload = serde_json::json!({
            "type": incident_type,
            "details": details,
            "severity": severity,
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "source": "kyc-ledger-service",
        });

        let url = format!("{}/api/v1/incidents", self.base_url);
        let _ = self.client.post(&url).json(&payload).send().await;
        Ok(())
    }
}
