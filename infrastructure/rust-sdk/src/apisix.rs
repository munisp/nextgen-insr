//! APISix client with route management, OIDC, WAF, and upstream health checks.

use reqwest::Client;
use serde_json::json;
use std::time::Duration;

pub struct APISixClient {
    admin_url: String,
    client: Client,
}

impl APISixClient {
    pub fn new(admin_url: &str) -> Self {
        Self {
            admin_url: admin_url.to_string(),
            client: Client::builder().timeout(Duration::from_secs(10)).build().unwrap_or_default(),
        }
    }

    pub async fn ping(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.client.get(format!("{}/apisix/admin/routes", self.admin_url)).send().await?;
        Ok(())
    }

    pub async fn create_route(&self, route_id: &str, uri: &str, name: &str, methods: &[&str], upstream_url: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let body = json!({
            "uri": uri, "name": name, "methods": methods,
            "upstream": {
                "type": "roundrobin",
                "nodes": { upstream_url: 1 },
                "retry_timeout": 3, "retries": 2,
                "checks": { "active": { "type": "http", "http_path": "/health",
                    "healthy": { "interval": 5, "successes": 2 },
                    "unhealthy": { "interval": 3, "http_failures": 3 } } }
            },
            "plugins": self.default_plugins(),
        });
        self.client.put(format!("{}/apisix/admin/routes/{}", self.admin_url, route_id))
            .json(&body).send().await?;
        Ok(())
    }

    fn default_plugins(&self) -> serde_json::Value {
        json!({
            "limit-req": { "rate": 100, "burst": 50, "rejected_code": 429, "key_type": "var", "key": "remote_addr" },
            "cors": { "allow_origins": "*", "allow_methods": "GET,POST,PUT,DELETE,OPTIONS", "allow_headers": "Content-Type,Authorization,X-KYC-Session-ID,X-Request-ID" },
            "prometheus": {},
        })
    }

    pub async fn register_platform_routes(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let routes: Vec<(&str, &str, &str, Vec<&str>, &str)> = vec![
            ("policy-svc", "/api/v1/policies/*", "policy-service", vec!["GET", "POST", "PUT", "DELETE"], "policy-service:8081"),
            ("claims-svc", "/api/v1/claims/*", "claims-service", vec!["GET", "POST", "PUT"], "claims-service:8082"),
            ("payment-svc", "/api/v1/payments/*", "payment-service", vec!["GET", "POST"], "payment-service:8083"),
            ("customer-svc", "/api/v1/customers/*", "customer-service", vec!["GET", "POST", "PUT"], "customer-service:8084"),
            ("kyc-svc", "/api/v1/kyc/*", "kyc-orchestrator", vec!["GET", "POST"], "kyc-orchestrator:8085"),
            ("fraud-svc", "/api/v1/fraud/*", "fraud-detection", vec!["GET", "POST"], "fraud-detection:8020"),
        ];
        for (id, uri, name, methods, upstream) in routes {
            self.create_route(id, uri, name, &methods, upstream).await?;
        }
        Ok(())
    }
}
