//! OpenAppSec WAF client with policy management, threat logs, and security dashboard.

use reqwest::Client;
use serde_json::json;
use std::time::Duration;

pub struct OpenAppSecClient {
    base_url: String,
    client: Client,
}

impl OpenAppSecClient {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.to_string(),
            client: Client::builder().timeout(Duration::from_secs(10)).build().unwrap_or_default(),
        }
    }

    pub async fn ping(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.client.get(format!("{}/api/v1/health", self.base_url)).send().await?;
        Ok(())
    }

    pub async fn apply_policy(&self, policy: &serde_json::Value) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let resp = self.client.post(format!("{}/api/v1/policies", self.base_url))
            .json(policy).send().await?;
        if !resp.status().is_success() {
            return Err(format!("Policy apply failed ({})", resp.status()).into());
        }
        Ok(())
    }

    pub async fn apply_platform_policy(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let policy = json!({
            "name": "ngapp-insurance-waf", "mode": "prevent",
            "rules": [
                { "name": "block-sqli", "type": "sql-injection", "action": "block", "severity": "critical" },
                { "name": "block-xss", "type": "cross-site-scripting", "action": "block", "severity": "high" },
                { "name": "block-path-traversal", "type": "path-traversal", "action": "block", "severity": "high" },
                { "name": "block-cmd-injection", "type": "command-injection", "action": "block", "severity": "critical" },
                { "name": "block-xxe", "type": "xml-external-entity", "action": "block", "severity": "high" },
                { "name": "block-ssrf", "type": "server-side-request-forgery", "action": "block", "severity": "critical" },
                { "name": "rate-limit-api", "type": "rate-limit", "action": "throttle", "config": { "requests_per_second": 100, "burst": 50 } },
                { "name": "geo-restrict", "type": "geo-restriction", "action": "block", "config": { "blocked_countries": ["KP", "IR", "SY"] } },
            ],
        });
        self.apply_policy(&policy).await
    }

    pub async fn get_threat_log(&self, limit: u32, severity: Option<&str>) -> Result<Vec<serde_json::Value>, Box<dyn std::error::Error + Send + Sync>> {
        let mut url = format!("{}/api/v1/threats?limit={}", self.base_url, limit);
        if let Some(s) = severity { url.push_str(&format!("&severity={}", s)); }
        let resp = self.client.get(&url).send().await?;
        if !resp.status().is_success() { return Ok(vec![]); }
        let data: serde_json::Value = resp.json().await?;
        Ok(data.get("threats").and_then(|t| t.as_array()).cloned().unwrap_or_default())
    }

    pub async fn get_security_dashboard(&self) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        let resp = self.client.get(format!("{}/api/v1/dashboard", self.base_url)).send().await?;
        if !resp.status().is_success() { return Ok(json!({ "threats_blocked": 0, "attacks_prevented": 0 })); }
        Ok(resp.json().await?)
    }
}
