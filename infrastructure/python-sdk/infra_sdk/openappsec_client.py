"""OpenAppSec async client with WAF policy management and threat monitoring."""

from __future__ import annotations

import logging
from typing import Optional

import httpx

logger = logging.getLogger("ngapp.infra.openappsec")

PLATFORM_WAF_POLICY = {
    "name": "ngapp-insurance-waf",
    "mode": "prevent",
    "security_level": "high",
    "trusted_sources": ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
    "custom_rules": [
        {"name": "block-sql-injection", "type": "sqli", "action": "block", "severity": "critical"},
        {"name": "block-xss", "type": "xss", "action": "block", "severity": "critical"},
        {"name": "block-path-traversal", "type": "path_traversal", "action": "block", "severity": "high"},
        {"name": "block-command-injection", "type": "command_injection", "action": "block", "severity": "critical"},
        {"name": "rate-limit-auth", "type": "rate_limit", "pattern": "/api/v1/auth/*", "action": "throttle", "severity": "medium"},
        {"name": "protect-kyc-endpoints", "type": "custom", "pattern": "/api/v1/kyc/", "action": "inspect", "severity": "high"},
        {"name": "protect-payment-endpoints", "type": "custom", "pattern": "/api/v1/payments/", "action": "inspect", "severity": "critical"},
        {"name": "bot-detection", "type": "bot", "action": "challenge", "severity": "medium"},
    ],
}


class OpenAppSecClient:
    def __init__(self, base_url: str):
        self._base_url = base_url
        self._http = httpx.AsyncClient(timeout=10.0)

    async def ping(self):
        resp = await self._http.get(f"{self._base_url}/health")
        if resp.status_code >= 500:
            raise ConnectionError(f"OpenAppSec unhealthy: {resp.status_code}")

    async def apply_policy(self, policy: Optional[dict] = None):
        p = policy or PLATFORM_WAF_POLICY
        resp = await self._http.put(
            f"{self._base_url}/api/v1/policies/{p['name']}", json=p,
        )
        if resp.status_code >= 400:
            logger.warning("waf_policy_failed: %s", resp.text)

    async def get_threat_log(self, limit: int = 100) -> list[dict]:
        resp = await self._http.get(f"{self._base_url}/api/v1/threats", params={"limit": limit})
        if resp.status_code == 200:
            return resp.json()
        return []

    async def get_security_dashboard(self) -> dict:
        resp = await self._http.get(f"{self._base_url}/api/v1/dashboard")
        if resp.status_code == 200:
            return resp.json()
        return {}
