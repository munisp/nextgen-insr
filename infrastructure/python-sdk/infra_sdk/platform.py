"""Unified platform client for all 12 infrastructure components."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Optional

from infra_sdk.postgres_client import PostgresClient
from infra_sdk.redis_client import RedisClient
from infra_sdk.kafka_client import KafkaClient
from infra_sdk.tigerbeetle_client import TigerBeetleClient
from infra_sdk.mojaloop_client import MojaloopClient
from infra_sdk.apisix_client import APISixClient
from infra_sdk.keycloak_client import KeycloakClient
from infra_sdk.openappsec_client import OpenAppSecClient
from infra_sdk.permify_client import PermifyClient
from infra_sdk.opensearch_client import OpenSearchClient
from infra_sdk.fluvio_client import FluvioClient
from infra_sdk.dapr_client import DaprClient

logger = logging.getLogger("ngapp.infra")


@dataclass
class PlatformConfig:
    postgres_url: str = "postgresql://localhost:5432/ngapp"
    redis_addr: str = "localhost:6379"
    kafka_brokers: list[str] = field(default_factory=lambda: ["localhost:9092"])
    tigerbeetle_addr: str = "localhost:3000"
    mojaloop_url: str = "http://localhost:4000"
    apisix_admin_url: str = "http://localhost:9180"
    keycloak_realm_url: str = "http://localhost:8080/realms/insurance"
    keycloak_admin_url: str = "http://localhost:8080"
    keycloak_client_id: str = "ngapp-platform"
    keycloak_client_secret: str = ""
    openappsec_url: str = "http://localhost:8090"
    permify_url: str = "http://localhost:3476"
    permify_tenant_id: str = "ngapp"
    opensearch_url: str = "http://localhost:9200"
    fluvio_endpoint: str = "localhost:9003"
    dapr_http_port: int = 3500


class Platform:
    """Unified client holding all 12 infrastructure component clients."""

    def __init__(self, config: Optional[PlatformConfig] = None):
        self.config = config or PlatformConfig()
        self.postgres = PostgresClient(self.config.postgres_url)
        self.redis = RedisClient(self.config.redis_addr)
        self.kafka = KafkaClient(self.config.kafka_brokers)
        self.tigerbeetle = TigerBeetleClient(self.config.tigerbeetle_addr)
        self.mojaloop = MojaloopClient(self.config.mojaloop_url)
        self.apisix = APISixClient(self.config.apisix_admin_url)
        self.keycloak = KeycloakClient(
            self.config.keycloak_realm_url,
            self.config.keycloak_client_id,
            self.config.keycloak_client_secret,
            self.config.keycloak_admin_url,
        )
        self.openappsec = OpenAppSecClient(self.config.openappsec_url)
        self.permify = PermifyClient(self.config.permify_url, self.config.permify_tenant_id)
        self.opensearch = OpenSearchClient(self.config.opensearch_url)
        self.fluvio = FluvioClient(self.config.fluvio_endpoint)
        self.dapr = DaprClient(self.config.dapr_http_port)

    async def health_check(self) -> dict[str, bool]:
        """Ping all 12 components in parallel, return component -> healthy map."""
        components = {
            "postgres": self.postgres,
            "redis": self.redis,
            "kafka": self.kafka,
            "tigerbeetle": self.tigerbeetle,
            "mojaloop": self.mojaloop,
            "apisix": self.apisix,
            "keycloak": self.keycloak,
            "openappsec": self.openappsec,
            "permify": self.permify,
            "opensearch": self.opensearch,
            "fluvio": self.fluvio,
            "dapr": self.dapr,
        }
        results: dict[str, bool] = {}

        async def check(name: str, client):
            try:
                await client.ping()
                results[name] = True
            except Exception as e:
                logger.warning("health_check_failed: %s: %s", name, e)
                results[name] = False

        await asyncio.gather(*[check(n, c) for n, c in components.items()])
        return results

    async def close(self):
        """Gracefully close all clients."""
        for attr in ["postgres", "redis", "kafka", "opensearch"]:
            client = getattr(self, attr, None)
            if client and hasattr(client, "close"):
                try:
                    await client.close()
                except Exception:
                    pass
