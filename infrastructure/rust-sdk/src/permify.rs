//! Permify client with fine-grained RBAC, schema management, and default-deny.

use reqwest::Client;
use serde_json::json;
use std::time::Duration;

pub struct PermifyClient {
    base_url: String,
    tenant_id: String,
    client: Client,
}

pub const PLATFORM_SCHEMA: &str = r#"
entity user {}
entity organization {
  relation admin @user
  relation member @user
  permission manage = admin
  permission view = admin or member
}
entity policy {
  relation owner @user
  relation organization @organization
  permission view = owner or organization.member
  permission manage = owner or organization.admin
  permission approve = organization.admin
}
entity claim {
  relation claimant @user
  relation policy @policy
  permission view = claimant or policy.organization.member
  permission manage = claimant or policy.organization.admin
  permission approve = policy.organization.admin
}
entity payment {
  relation payer @user
  relation policy @policy
  permission view = payer or policy.organization.member
  permission approve = policy.organization.admin
}
"#;

impl PermifyClient {
    pub fn new(base_url: &str, tenant_id: &str) -> Self {
        Self {
            base_url: base_url.to_string(),
            tenant_id: tenant_id.to_string(),
            client: Client::builder().timeout(Duration::from_secs(5)).build().unwrap_or_default(),
        }
    }

    pub async fn ping(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.client.get(format!("{}/healthz", self.base_url)).send().await?;
        Ok(())
    }

    pub async fn write_schema(&self, schema: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let resp = self.client.post(format!("{}/v1/tenants/{}/schemas/write", self.base_url, self.tenant_id))
            .json(&json!({ "schema": schema })).send().await?;
        if !resp.status().is_success() {
            return Err(format!("Schema write failed ({})", resp.status()).into());
        }
        Ok(())
    }

    pub async fn write_relationship(&self, entity: &str, entity_id: &str, relation: &str, subject_type: &str, subject_id: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let resp = self.client.post(format!("{}/v1/tenants/{}/relationships/write", self.base_url, self.tenant_id))
            .json(&json!({
                "metadata": { "schema_version": "" },
                "tuples": [{ "entity": { "type": entity, "id": entity_id }, "relation": relation, "subject": { "type": subject_type, "id": subject_id } }],
            })).send().await?;
        if !resp.status().is_success() {
            return Err(format!("Relationship write failed ({})", resp.status()).into());
        }
        Ok(())
    }

    pub async fn check_permission(&self, entity: &str, entity_id: &str, permission: &str, subject_type: &str, subject_id: &str) -> bool {
        let result = async {
            let resp = self.client.post(format!("{}/v1/tenants/{}/permissions/check", self.base_url, self.tenant_id))
                .json(&json!({
                    "metadata": { "schema_version": "", "snap_token": "", "depth": 10 },
                    "entity": { "type": entity, "id": entity_id },
                    "permission": permission,
                    "subject": { "type": subject_type, "id": subject_id },
                })).send().await?;
            if !resp.status().is_success() { return Ok::<bool, reqwest::Error>(false); }
            let data: serde_json::Value = resp.json().await?;
            Ok(data.get("can").and_then(|c| c.as_str()) == Some("CHECK_RESULT_ALLOWED"))
        }.await;
        result.unwrap_or(false) // Default-deny on any error
    }

    pub async fn write_platform_schema(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.write_schema(PLATFORM_SCHEMA).await
    }
}
