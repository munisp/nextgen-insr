//! Unified platform client holding all 12 infrastructure component clients.

use crate::{
    apisix::APISixClient, dapr::DaprClient, fluvio::FluvioClient, kafka::KafkaClient,
    keycloak::KeycloakClient, mojaloop::MojaloopClient, openappsec::OpenAppSecClient,
    opensearch::OpenSearchClient, permify::PermifyClient, postgres::PostgresClient,
    redis::RedisClient, tigerbeetle::TigerBeetleClient,
};
use std::collections::HashMap;

pub struct PlatformConfig {
    pub postgres_url: String,
    pub redis_addr: String,
    pub kafka_brokers: Vec<String>,
    pub tigerbeetle_addr: String,
    pub mojaloop_url: String,
    pub apisix_admin_url: String,
    pub keycloak_realm_url: String,
    pub keycloak_client_id: String,
    pub keycloak_client_secret: String,
    pub openappsec_url: String,
    pub permify_url: String,
    pub permify_tenant_id: String,
    pub opensearch_url: String,
    pub fluvio_endpoint: String,
    pub dapr_http_port: u16,
}

impl Default for PlatformConfig {
    fn default() -> Self {
        Self {
            postgres_url: "postgresql://localhost:5432/ngapp".into(),
            redis_addr: "localhost:6379".into(),
            kafka_brokers: vec!["localhost:9092".into()],
            tigerbeetle_addr: "localhost:3000".into(),
            mojaloop_url: "http://localhost:4000".into(),
            apisix_admin_url: "http://localhost:9180".into(),
            keycloak_realm_url: "http://localhost:8080/realms/insurance".into(),
            keycloak_client_id: "ngapp-platform".into(),
            keycloak_client_secret: String::new(),
            openappsec_url: "http://localhost:8090".into(),
            permify_url: "http://localhost:3476".into(),
            permify_tenant_id: "ngapp".into(),
            opensearch_url: "http://localhost:9200".into(),
            fluvio_endpoint: "localhost:9003".into(),
            dapr_http_port: 3500,
        }
    }
}

pub struct Platform {
    pub postgres: PostgresClient,
    pub redis: RedisClient,
    pub kafka: KafkaClient,
    pub tigerbeetle: TigerBeetleClient,
    pub mojaloop: MojaloopClient,
    pub apisix: APISixClient,
    pub keycloak: KeycloakClient,
    pub openappsec: OpenAppSecClient,
    pub permify: PermifyClient,
    pub opensearch: OpenSearchClient,
    pub fluvio: FluvioClient,
    pub dapr: DaprClient,
}

impl Platform {
    pub fn new(cfg: PlatformConfig) -> Self {
        Self {
            postgres: PostgresClient::new(&cfg.postgres_url),
            redis: RedisClient::new(&cfg.redis_addr),
            kafka: KafkaClient::new(cfg.kafka_brokers),
            tigerbeetle: TigerBeetleClient::new(&cfg.tigerbeetle_addr),
            mojaloop: MojaloopClient::new(&cfg.mojaloop_url),
            apisix: APISixClient::new(&cfg.apisix_admin_url),
            keycloak: KeycloakClient::new(&cfg.keycloak_realm_url, &cfg.keycloak_client_id, &cfg.keycloak_client_secret),
            openappsec: OpenAppSecClient::new(&cfg.openappsec_url),
            permify: PermifyClient::new(&cfg.permify_url, &cfg.permify_tenant_id),
            opensearch: OpenSearchClient::new(&cfg.opensearch_url),
            fluvio: FluvioClient::new(&cfg.fluvio_endpoint),
            dapr: DaprClient::new(cfg.dapr_http_port),
        }
    }

    pub async fn health_check(&self) -> HashMap<String, bool> {
        let mut results = HashMap::new();
        results.insert("postgres".into(), self.postgres.ping().await.is_ok());
        results.insert("redis".into(), self.redis.ping().await.is_ok());
        results.insert("kafka".into(), self.kafka.ping().await.is_ok());
        results.insert("tigerbeetle".into(), self.tigerbeetle.ping().await.is_ok());
        results.insert("mojaloop".into(), self.mojaloop.ping().await.is_ok());
        results.insert("apisix".into(), self.apisix.ping().await.is_ok());
        results.insert("keycloak".into(), self.keycloak.ping().await.is_ok());
        results.insert("openappsec".into(), self.openappsec.ping().await.is_ok());
        results.insert("permify".into(), self.permify.ping().await.is_ok());
        results.insert("opensearch".into(), self.opensearch.ping().await.is_ok());
        results.insert("fluvio".into(), self.fluvio.ping().await.is_ok());
        results.insert("dapr".into(), self.dapr.ping().await.is_ok());
        results
    }
}
