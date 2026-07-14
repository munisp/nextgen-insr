"""Dapr async client with state management, pub/sub, service invocation, and secrets."""

from __future__ import annotations

import logging
import time
from typing import Any, Optional

import httpx

logger = logging.getLogger("ngapp.infra.dapr")

DAPR_STATE_STORE = "statestore"
DAPR_PUBSUB = "pubsub"
DAPR_SECRET_STORE = "secretstore"


class DaprClient:
    def __init__(self, http_port: int = 3500):
        self._base_url = f"http://localhost:{http_port}"
        self._http = httpx.AsyncClient(timeout=5.0)

    async def ping(self):
        resp = await self._http.get(f"{self._base_url}/v1.0/healthz")
        if resp.status_code not in (200, 204):
            raise ConnectionError(f"Dapr unhealthy: {resp.status_code}")

    async def save_state(self, store: str, key: str, value: Any, etag: str = ""):
        item: dict[str, Any] = {"key": key, "value": value}
        if etag:
            item["etag"] = etag
            item["options"] = {"concurrency": "first-write"}
        resp = await self._http.post(f"{self._base_url}/v1.0/state/{store}", json=[item])
        if resp.status_code >= 400:
            raise RuntimeError(f"save_state failed ({resp.status_code}): {resp.text}")

    async def get_state(self, store: str, key: str) -> tuple[Optional[Any], str]:
        resp = await self._http.get(f"{self._base_url}/v1.0/state/{store}/{key}")
        if resp.status_code in (204, 404):
            return None, ""
        etag = resp.headers.get("ETag", "")
        return resp.json(), etag

    async def delete_state(self, store: str, key: str):
        await self._http.delete(f"{self._base_url}/v1.0/state/{store}/{key}")

    async def publish_event(self, pubsub: str, topic: str, event: Any):
        resp = await self._http.post(
            f"{self._base_url}/v1.0/publish/{pubsub}/{topic}", json=event,
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"publish failed ({resp.status_code}): {resp.text}")

    async def invoke_service(self, app_id: str, method: str, payload: Any = None) -> Any:
        resp = await self._http.post(
            f"{self._base_url}/v1.0/invoke/{app_id}/method/{method}", json=payload,
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"invoke {app_id}/{method} failed ({resp.status_code}): {resp.text}")
        return resp.json() if resp.content else None

    async def get_secret(self, store: str, key: str) -> dict[str, str]:
        resp = await self._http.get(f"{self._base_url}/v1.0/secrets/{store}/{key}")
        if resp.status_code == 200:
            return resp.json()
        return {}

    async def save_kyc_session(self, session_id: str, session: dict):
        await self.save_state(DAPR_STATE_STORE, f"kyc:session:{session_id}", session)

    async def get_kyc_session(self, session_id: str) -> Optional[dict]:
        data, _ = await self.get_state(DAPR_STATE_STORE, f"kyc:session:{session_id}")
        return data

    async def publish_kyc_event(self, event_type: str, payload: dict):
        await self.publish_event(DAPR_PUBSUB, "kyc-events", {
            "event_type": event_type,
            "data": payload,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "source": "kyc-orchestrator",
        })

    async def save_policy_state(self, policy_id: str, state: dict):
        await self.save_state(DAPR_STATE_STORE, f"policy:{policy_id}", state)

    async def save_claim_state(self, claim_id: str, state: dict):
        await self.save_state(DAPR_STATE_STORE, f"claim:{claim_id}", state)
