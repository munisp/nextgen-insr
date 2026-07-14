//! Keycloak client with token validation, caching, KYC level extraction, and admin ops.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct KeycloakClient {
    realm_url: String,
    client_id: String,
    client_secret: String,
    client: Client,
    token_cache: Mutex<HashMap<String, CachedToken>>,
}

struct CachedToken {
    claims: serde_json::Value,
    expires_at: Instant,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub expires_in: u64,
    pub token_type: String,
}

impl KeycloakClient {
    pub fn new(realm_url: &str, client_id: &str, client_secret: &str) -> Self {
        Self {
            realm_url: realm_url.to_string(),
            client_id: client_id.to_string(),
            client_secret: client_secret.to_string(),
            client: Client::builder().timeout(Duration::from_secs(10)).build().unwrap_or_default(),
            token_cache: Mutex::new(HashMap::new()),
        }
    }

    pub async fn ping(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.client.get(format!("{}/.well-known/openid-configuration", self.realm_url)).send().await?;
        Ok(())
    }

    pub async fn validate_token(&self, token: &str) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        if let Ok(cache) = self.token_cache.lock() {
            if let Some(cached) = cache.get(token) {
                if cached.expires_at > Instant::now() {
                    return Ok(cached.claims.clone());
                }
            }
        }

        let resp = self.client.get(format!("{}/protocol/openid-connect/userinfo", self.realm_url))
            .header("Authorization", format!("Bearer {}", token))
            .send().await?;
        if !resp.status().is_success() {
            return Err(format!("Token invalid ({})", resp.status()).into());
        }
        let claims: serde_json::Value = resp.json().await?;

        if let Ok(mut cache) = self.token_cache.lock() {
            cache.insert(token.to_string(), CachedToken {
                claims: claims.clone(),
                expires_at: Instant::now() + Duration::from_secs(300),
            });
            cache.retain(|_, v| v.expires_at > Instant::now());
        }
        Ok(claims)
    }

    pub fn get_kyc_level(claims: &serde_json::Value) -> u8 {
        claims.get("attributes").and_then(|a| a.get("kyc_level")).and_then(|v| v.as_u64())
            .or_else(|| claims.get("kyc_level").and_then(|v| v.as_u64()))
            .unwrap_or(0) as u8
    }

    pub async fn get_service_token(&self) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let resp = self.client.post(format!("{}/protocol/openid-connect/token", self.realm_url))
            .form(&[("grant_type", "client_credentials"), ("client_id", &self.client_id), ("client_secret", &self.client_secret)])
            .send().await?;
        if !resp.status().is_success() {
            return Err(format!("Service token failed ({})", resp.status()).into());
        }
        let data: TokenResponse = resp.json().await?;
        Ok(data.access_token)
    }
}
