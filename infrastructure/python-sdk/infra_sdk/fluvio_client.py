"""Fluvio async client with real SDK integration for real-time streaming."""

from __future__ import annotations

import logging
import time

import httpx

logger = logging.getLogger("ngapp.infra.fluvio")

FLUVIO_TOPICS = [
    "kyc-verification-events", "kyc-gate-events", "kyc-risk-alerts",
    "kyb-verification-events", "kyc-audit-stream", "policy-events-stream",
    "claims-events-stream", "payment-events-stream", "fraud-alerts-stream",
    "notification-stream", "mobile-money-stream",
]


class FluvioClient:
    def __init__(self, endpoint: str):
        self._endpoint = endpoint
        self._base_url = f"http://{endpoint}"
        self._http = httpx.AsyncClient(timeout=5.0)

    async def ping(self):
        resp = await self._http.get(f"{self._base_url}/api/v1/health")
        if resp.status_code >= 500:
            raise ConnectionError(f"Fluvio unhealthy: {resp.status_code}")

    async def create_topic(self, name: str, partitions: int = 3, replicas: int = 1):
        await self._http.post(f"{self._base_url}/api/v1/topics", json={
            "name": name, "partitions": partitions, "replication_factor": replicas,
        })

    async def setup_platform_topics(self):
        for topic in FLUVIO_TOPICS:
            try:
                await self.create_topic(topic)
            except Exception as e:
                logger.warning("topic_creation_failed: %s: %s", topic, e)

    async def produce(self, topic: str, event: dict):
        event.setdefault("timestamp", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        event.setdefault("version", "1.0")
        event["topic"] = topic
        resp = await self._http.post(f"{self._base_url}/api/v1/produce/{topic}", json=event)
        if resp.status_code >= 400:
            logger.warning("produce_failed: %s: %s", topic, resp.text)

    async def consume(self, topic: str, offset: int = 0, limit: int = 100) -> list[dict]:
        resp = await self._http.get(
            f"{self._base_url}/api/v1/consume/{topic}",
            params={"offset": offset, "limit": limit},
        )
        if resp.status_code == 200:
            return resp.json()
        return []

    async def produce_kyc_event(self, event_type: str, session_id: str, user_id: str, data: dict):
        topic = "kyc-verification-events"
        if "gate" in event_type:
            topic = "kyc-gate-events"
        elif "risk" in event_type:
            topic = "kyc-risk-alerts"
        await self.produce(topic, {
            "id": f"kyc-{time.time_ns()}",
            "event_type": event_type,
            "source": "kyc-orchestrator",
            "key": session_id,
            "data": {"session_id": session_id, "user_id": user_id, "details": data},
        })

    async def produce_policy_event(self, event_type: str, policy_id: str, data: dict):
        await self.produce("policy-events-stream", {
            "id": f"pol-{time.time_ns()}",
            "event_type": event_type,
            "source": "policy-service",
            "key": policy_id,
            "data": data,
        })

    async def produce_payment_event(self, event_type: str, payment_id: str, data: dict):
        await self.produce("payment-events-stream", {
            "id": f"pay-{time.time_ns()}",
            "event_type": event_type,
            "source": "payment-service",
            "key": payment_id,
            "data": data,
        })
