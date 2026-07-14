"""APISix async client with route management, OIDC, WAF, and upstream health checks."""

from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger("ngapp.infra.apisix")


class APISixClient:
    def __init__(self, admin_url: str):
        self._admin_url = admin_url
        self._api_key = os.environ.get("APISIX_API_KEY", os.environ.get("APISIX_ADMIN_KEY", ""))
        self._http = httpx.AsyncClient(timeout=10.0)

    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self._api_key:
            h["X-API-KEY"] = self._api_key
        return h

    async def ping(self):
        resp = await self._http.get(f"{self._admin_url}/apisix/admin/routes", headers=self._headers())
        if resp.status_code >= 500:
            raise ConnectionError(f"APISix unhealthy: {resp.status_code}")

    async def create_route(self, route_id: str, uri: str, name: str, methods: list[str],
                           upstream_url: str, plugins: Optional[dict] = None):
        body = {
            "uri": uri,
            "name": name,
            "methods": methods,
            "upstream": {
                "type": "roundrobin",
                "nodes": {upstream_url: 1},
                "retry_timeout": 3,
                "retries": 2,
                "checks": {
                    "active": {
                        "type": "http",
                        "http_path": "/health",
                        "healthy": {"interval": 5, "successes": 2},
                        "unhealthy": {"interval": 3, "http_failures": 3},
                    }
                },
            },
            "plugins": plugins or self._default_plugins(),
        }
        resp = await self._http.put(
            f"{self._admin_url}/apisix/admin/routes/{route_id}",
            headers=self._headers(), json=body,
        )
        if resp.status_code >= 400:
            logger.warning("route_create_failed: %s: %s", route_id, resp.text)

    def _default_plugins(self) -> dict:
        return {
            "limit-req": {"rate": 100, "burst": 50, "rejected_code": 429, "key_type": "var", "key": "remote_addr"},
            "cors": {"allow_origins": "*", "allow_methods": "GET,POST,PUT,DELETE,OPTIONS",
                     "allow_headers": "Content-Type,Authorization,X-KYC-Session-ID,X-Request-ID"},
            "prometheus": {},
        }

    async def register_platform_routes(self):
        routes = [
            ("policy-svc", "/api/v1/policies/*", "policy-service", ["GET", "POST", "PUT", "DELETE"], "policy-service:8081"),
            ("claims-svc", "/api/v1/claims/*", "claims-service", ["GET", "POST", "PUT"], "claims-service:8082"),
            ("payment-svc", "/api/v1/payments/*", "payment-service", ["GET", "POST"], "payment-service:8083"),
            ("customer-svc", "/api/v1/customers/*", "customer-service", ["GET", "POST", "PUT"], "customer-service:8084"),
            ("kyc-svc", "/api/v1/kyc/*", "kyc-orchestrator", ["GET", "POST"], "kyc-orchestrator:8085"),
            ("fraud-svc", "/api/v1/fraud/*", "fraud-detection", ["GET", "POST"], "fraud-detection:8020"),
            ("analytics-svc", "/api/v1/analytics/*", "analytics-service", ["GET", "POST"], "analytics-service:8098"),
            ("underwriting-svc", "/api/v1/underwriting/*", "underwriting-service", ["GET", "POST"], "underwriting-service:8102"),
            ("notification-svc", "/api/v1/notifications/*", "notification-service", ["GET", "POST"], "notification-service:8100"),
            ("mobile-money-svc", "/api/v1/mobile-money/*", "mobile-money-service", ["GET", "POST"], "mobile-money-service:8106"),
            ("lakehouse-svc", "/api/v1/lakehouse/*", "lakehouse-api", ["GET", "POST"], "lakehouse-api:8120"),
            ("ai-ml-svc", "/api/v1/ml/*", "ai-ml-platform", ["GET", "POST"], "ai-ml-platform:8130"),
        ]
        for route_id, uri, name, methods, upstream in routes:
            await self.create_route(route_id, uri, name, methods, upstream)

    async def setup_oidc(self, route_id: str, keycloak_url: str, client_id: str, client_secret: str):
        plugin = {
            "openid-connect": {
                "client_id": client_id,
                "client_secret": client_secret,
                "discovery": f"{keycloak_url}/.well-known/openid-configuration",
                "bearer_only": True,
                "realm": "insurance",
            }
        }
        resp = await self._http.put(
            f"{self._admin_url}/apisix/admin/routes/{route_id}",
            headers=self._headers(), json={"plugins": plugin},
        )
        return resp.status_code < 400

    async def setup_waf(self, route_id: str):
        plugin = {
            "openappsec": {
                "mode": "prevent",
                "security_level": "high",
                "log_level": "info",
            }
        }
        resp = await self._http.put(
            f"{self._admin_url}/apisix/admin/routes/{route_id}",
            headers=self._headers(), json={"plugins": plugin},
        )
        return resp.status_code < 400
