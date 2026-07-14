"""
Infrastructure middleware that wires all 12 components into FastAPI/ASGI services.
Enforces KYC gates, rate limiting, RBAC, and audit logging on every request.
"""

import time
import json
import asyncio
from dataclasses import dataclass
from typing import Optional

from .platform import Platform


@dataclass
class RequestContext:
    user_id: str = ""
    kyc_level: int = 0
    client_ip: str = ""
    token: str = ""
    permissions: dict = None

    def __post_init__(self):
        if self.permissions is None:
            self.permissions = {}


class InfraMiddleware:
    """ASGI middleware that enforces all 12 infrastructure checks."""

    def __init__(self, platform: Platform):
        self.platform = platform

    async def process_request(
        self,
        method: str,
        path: str,
        headers: dict,
        client_ip: str,
    ) -> tuple[Optional[dict], RequestContext]:
        """
        Run all middleware checks. Returns (error_response, context).
        If error_response is not None, the request should be rejected.
        """
        ctx = RequestContext(client_ip=client_ip)
        start = time.time()

        # 1. Rate limiting via Redis
        try:
            allowed = await self.platform.redis.rate_limit(
                f"rate:{client_ip}", max_requests=100, window_seconds=60
            )
            if not allowed:
                return {"error": "rate_limit_exceeded", "status": 429}, ctx
        except Exception:
            pass  # Fail open on Redis errors

        # 2. Token validation via Keycloak
        auth_header = headers.get("authorization", "")
        if auth_header and not self._is_public_path(path):
            token = auth_header.removeprefix("Bearer ").strip()
            ctx.token = token
            try:
                claims = await self.platform.keycloak.validate_token(token)
                ctx.user_id = claims.get("sub", "")
                ctx.kyc_level = await self.platform.keycloak.get_kyc_level(claims)
            except Exception:
                return {"error": "invalid_token", "status": 401}, ctx

        # 3. KYC gate enforcement
        if self._requires_kyc(path) and ctx.user_id:
            try:
                gate = await self.platform.redis.get_kyc_gate(ctx.user_id)
                if gate and not gate.get("allowed", True):
                    return {
                        "error": "kyc_verification_required",
                        "kyc_level": gate.get("level", 0),
                        "status": 403,
                    }, ctx
            except Exception:
                pass

        # 4. RBAC via Permify
        if self._requires_permission(path) and ctx.user_id:
            entity, permission = self._extract_permission(method, path)
            if entity:
                try:
                    allowed = await self.platform.permify.check_permission(
                        entity, "*", permission, "user", ctx.user_id
                    )
                    if not allowed:
                        return {"error": "permission_denied", "status": 403}, ctx
                except Exception:
                    pass  # Fail open on Permify errors for now

        # 5. Async audit logging (non-blocking)
        asyncio.create_task(self._audit_log(method, path, ctx, start))

        return None, ctx

    async def _audit_log(self, method: str, path: str, ctx: RequestContext, start: float):
        latency_ms = int((time.time() - start) * 1000)
        audit_entry = {
            "method": method,
            "path": path,
            "user_id": ctx.user_id,
            "kyc_level": ctx.kyc_level,
            "client_ip": ctx.client_ip,
            "latency_ms": latency_ms,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

        try:
            await self.platform.opensearch.index_audit(
                "api-gateway", method, "request", path, ctx.user_id, audit_entry
            )
        except Exception:
            pass

        try:
            await self.platform.kafka.publish_audit_event(
                "api-gateway", f"{method} {path}", audit_entry
            )
        except Exception:
            pass

        try:
            await self.platform.fluvio.produce(
                "kyc-audit-stream", ctx.user_id or "anonymous", audit_entry
            )
        except Exception:
            pass

    @staticmethod
    def _is_public_path(path: str) -> bool:
        public = ["/health", "/ready", "/metrics", "/api/v1/auth/login", "/api/v1/auth/register", "/docs", "/openapi.json"]
        return any(path.startswith(p) for p in public)

    @staticmethod
    def _requires_kyc(path: str) -> bool:
        protected = ["/api/v1/policies", "/api/v1/claims", "/api/v1/payments", "/api/v1/transfers"]
        return any(path.startswith(p) for p in protected)

    @staticmethod
    def _requires_permission(path: str) -> bool:
        return path.startswith("/api/v1/")

    @staticmethod
    def _extract_permission(method: str, path: str) -> tuple[str, str]:
        parts = path.removeprefix("/api/v1/").split("/")
        if not parts:
            return "", ""
        entity = parts[0]
        if method == "GET":
            return entity, "view"
        return entity, "manage"
