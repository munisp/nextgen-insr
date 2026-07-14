"""Keycloak async client with token validation, distributed caching via Redis pub/sub,
KYC attributes, and RBAC."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Optional

import httpx

logger = logging.getLogger("ngapp.infra.keycloak")

MAX_TOKEN_CACHE_SIZE = 10_000


class KeycloakClient:
    def __init__(self, realm_url: str, client_id: str, client_secret: str, admin_url: str):
        self._realm_url = realm_url
        self._client_id = client_id
        self._client_secret = client_secret
        self._admin_url = admin_url
        self._http = httpx.AsyncClient(timeout=10.0)
        self._token_cache: dict[str, tuple[dict, float]] = {}
        self._redis_client = None

    def set_redis_client(self, redis_client):
        """Attach Redis client for distributed token invalidation across replicas."""
        self._redis_client = redis_client
        asyncio.ensure_future(self._subscribe_to_invalidations())

    async def _subscribe_to_invalidations(self):
        """Subscribe to token invalidation channel for cross-replica coherence."""
        if not self._redis_client:
            return
        try:
            import redis.asyncio as aioredis
            # Create a dedicated subscriber connection
            sub = self._redis_client._client.pubsub()
            await sub.subscribe("__token_invalidation__")
            async for message in sub.listen():
                if message["type"] != "message":
                    continue
                try:
                    data = json.loads(message["data"])
                    token = data.get("token")
                    user_id = data.get("user_id")
                    if token:
                        self._token_cache.pop(token, None)
                    if user_id:
                        to_remove = [k for k, (claims, _) in self._token_cache.items() if claims.get("sub") == user_id]
                        for k in to_remove:
                            self._token_cache.pop(k, None)
                except (json.JSONDecodeError, KeyError):
                    pass
        except Exception as e:
            logger.warning(f"token_invalidation_subscription_failed: {e}")

    async def ping(self):
        resp = await self._http.get(f"{self._realm_url}/.well-known/openid-configuration")
        if resp.status_code != 200:
            raise ConnectionError(f"Keycloak unhealthy: {resp.status_code}")

    async def validate_token(self, token: str) -> dict:
        now = time.time()
        if token in self._token_cache:
            claims, expires = self._token_cache[token]
            if now < expires:
                return claims

        resp = await self._http.get(
            f"{self._realm_url}/protocol/openid-connect/userinfo",
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code != 200:
            raise ValueError(f"Invalid token: status {resp.status_code}")
        claims = resp.json()
        self._token_cache[token] = (claims, now + 300)

        # Enforce max cache size (evict oldest expired entries)
        if len(self._token_cache) > MAX_TOKEN_CACHE_SIZE:
            expired = [k for k, (_, exp) in self._token_cache.items() if now >= exp]
            for k in expired[:100]:
                self._token_cache.pop(k, None)
        return claims

    async def invalidate_token(self, token: str):
        """Invalidate a specific token across all service replicas."""
        self._token_cache.pop(token, None)
        if self._redis_client:
            await self._redis_client.publish("__token_invalidation__", {"token": token, "timestamp": int(time.time())})

    async def invalidate_user_tokens(self, user_id: str):
        """Invalidate all tokens for a user across all replicas."""
        to_remove = [k for k, (claims, _) in self._token_cache.items() if claims.get("sub") == user_id]
        for k in to_remove:
            self._token_cache.pop(k, None)
        if self._redis_client:
            await self._redis_client.publish("__token_invalidation__", {"user_id": user_id, "timestamp": int(time.time())})

    async def get_kyc_level(self, token: str) -> int:
        claims = await self.validate_token(token)
        level = claims.get("kyc_level", 0)
        if isinstance(level, str):
            return int(level) if level.isdigit() else 0
        return int(level)

    async def get_service_token(self) -> str:
        resp = await self._http.post(
            f"{self._realm_url}/protocol/openid-connect/token",
            data={
                "grant_type": "client_credentials",
                "client_id": self._client_id,
                "client_secret": self._client_secret,
            },
        )
        resp.raise_for_status()
        return resp.json()["access_token"]

    async def update_user_kyc_level(self, user_id: str, kyc_level: int, kyc_status: str):
        admin_token = await self.get_service_token()
        realm = self._realm_url.split("/realms/")[-1] if "/realms/" in self._realm_url else "insurance"
        resp = await self._http.put(
            f"{self._admin_url}/admin/realms/{realm}/users/{user_id}",
            headers={"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"},
            json={"attributes": {"kyc_level": [str(kyc_level)], "kyc_status": [kyc_status]}},
        )
        if resp.status_code >= 400:
            logger.warning("update_user_kyc_failed: %s: %s", user_id, resp.text)
        # Invalidate cached tokens for this user across all replicas
        await self.invalidate_user_tokens(user_id)

    def invalidate_token_cache(self, token: str):
        self._token_cache.pop(token, None)
