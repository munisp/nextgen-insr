/// WAF Bridge — OpenAppSec integration with local threat detection.
/// Inspects requests for SQL injection, XSS, path traversal, and known malicious IPs.
use std::sync::Arc;
use chrono::Utc;
use dashmap::DashMap;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::RwLock;

// Compiled threat detection patterns
static SQL_INJECTION: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(union\s+select|drop\s+table|insert\s+into|delete\s+from|exec\s*\(|xp_cmdshell|information_schema|sys\.tables|--\s*$|;\s*--|\bor\b\s+\d+\s*=\s*\d+|\band\b\s+\d+\s*=\s*\d+)").unwrap()
});
static XSS: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?i)(<script[^>]*>|javascript:|on\w+\s*=|<iframe|<object|<embed|<link[^>]*rel\s*=\s*['"]stylesheet|eval\s*\(|document\.cookie|window\.location)"#).unwrap()
});
static PATH_TRAVERSAL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(\.\./|\.\.\\|%2e%2e%2f|%2e%2e/|\.\.%2f|%252e%252e)"#).unwrap()
});
static COMMAND_INJECTION: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(;\s*(?:ls|cat|pwd|whoami|id|uname|wget|curl|bash|sh|cmd|powershell)|&&\s*(?:ls|cat|pwd|whoami)|\|\s*(?:ls|cat|pwd|whoami))").unwrap()
});

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WafInspectResult {
    pub blocked: bool,
    pub threat_score: u8,
    pub threats: Vec<String>,
    pub action: String,
    pub request_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ThreatEvent {
    pub timestamp: String,
    pub ip: String,
    pub threat_type: String,
    pub score: u8,
    pub payload_snippet: String,
}

pub struct WafBridge {
    blocked_ips: Arc<DashMap<String, String>>, // ip -> reason
    recent_threats: Arc<RwLock<Vec<ThreatEvent>>>,
}

impl WafBridge {
    pub fn new() -> Self {
        Self {
            blocked_ips: Arc::new(DashMap::new()),
            recent_threats: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub fn health(&self) -> &'static str {
        "ok"
    }

    pub async fn inspect(&self, payload: &Value) -> WafInspectResult {
        let request_id = uuid::Uuid::new_v4().to_string();
        let ip = payload.get("ip").and_then(|v| v.as_str()).unwrap_or("0.0.0.0");
        let body = payload.get("body").and_then(|v| v.as_str()).unwrap_or("");
        let path = payload.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let query = payload.get("query").and_then(|v| v.as_str()).unwrap_or("");

        let inspect_target = format!("{} {} {} {}", path, query, body, ip);
        let mut threats = Vec::new();
        let mut score: u8 = 0;

        // Check if IP is blocked
        if self.blocked_ips.contains_key(ip) {
            return WafInspectResult {
                blocked: true,
                threat_score: 100,
                threats: vec!["IP_BLOCKED".to_string()],
                action: "block".to_string(),
                request_id,
            };
        }

        // Threat detection
        if SQL_INJECTION.is_match(&inspect_target) {
            threats.push("SQL_INJECTION".to_string());
            score = score.saturating_add(80);
        }
        if XSS.is_match(&inspect_target) {
            threats.push("XSS".to_string());
            score = score.saturating_add(70);
        }
        if PATH_TRAVERSAL.is_match(&inspect_target) {
            threats.push("PATH_TRAVERSAL".to_string());
            score = score.saturating_add(60);
        }
        if COMMAND_INJECTION.is_match(&inspect_target) {
            threats.push("COMMAND_INJECTION".to_string());
            score = score.saturating_add(90);
        }

        let blocked = score >= 60;

        if !threats.is_empty() {
            let snippet = if inspect_target.len() > 100 {
                format!("{}...", &inspect_target[..100])
            } else {
                inspect_target.clone()
            };

            let mut recent = self.recent_threats.write().await;
            recent.push(ThreatEvent {
                timestamp: Utc::now().to_rfc3339(),
                ip: ip.to_string(),
                threat_type: threats.join(","),
                score,
                payload_snippet: snippet,
            });
            // Keep last 1000 threats
            if recent.len() > 1000 {
                recent.drain(0..100);
            }
        }

        WafInspectResult {
            blocked,
            threat_score: score,
            threats,
            action: if blocked { "block".to_string() } else { "allow".to_string() },
            request_id,
        }
    }

    pub async fn block_ip(&self, ip: &str, reason: &str) {
        self.blocked_ips.insert(ip.to_string(), reason.to_string());
    }

    pub async fn unblock_ip(&self, ip: &str) {
        self.blocked_ips.remove(ip);
    }

    pub async fn blocked_ips(&self) -> Vec<Value> {
        self.blocked_ips.iter()
            .map(|entry| serde_json::json!({
                "ip": entry.key(),
                "reason": entry.value()
            }))
            .collect()
    }

    pub async fn recent_threats(&self) -> Vec<ThreatEvent> {
        self.recent_threats.read().await.clone()
    }
}
