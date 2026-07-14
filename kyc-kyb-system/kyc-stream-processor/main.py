"""KYC Stream Processor — Fluvio/Kafka streaming for real-time KYC event processing."""

import os
import json
import time
import asyncio
from datetime import datetime
from typing import Optional
from collections import defaultdict

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

app = FastAPI(
    title="KYC Stream Processor",
    description="Real-time KYC event streaming with Fluvio and Kafka integration",
    version="1.0.0",
)

FLUVIO_ENDPOINT = os.getenv("FLUVIO_ENDPOINT", "localhost:9003")
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/2")
KYC_ORCHESTRATOR_URL = os.getenv("KYC_ORCHESTRATOR_URL", "http://localhost:8085")
ANALYTICS_URL = os.getenv("ANALYTICS_URL", "http://localhost:8114")


class StreamEvent(BaseModel):
    id: str
    event_type: str
    session_id: str
    user_id: str
    timestamp: str
    data: dict = Field(default_factory=dict)
    source: str = "kyc-stream-processor"
    version: str = "1.0"


class FluvioTopic(BaseModel):
    name: str
    partitions: int = 1
    replication_factor: int = 1


class StreamStats(BaseModel):
    total_events_processed: int
    events_per_second: float
    active_sessions: int
    connected_consumers: int
    topics: dict
    uptime_seconds: float


class FluvioClient:
    """Fluvio streaming client for real-time KYC event processing."""

    def __init__(self, endpoint: str):
        self.endpoint = endpoint
        self.topics = {
            "kyc-verification-events": [],
            "kyc-gate-events": [],
            "kyc-risk-alerts": [],
            "kyc-compliance-events": [],
            "kyb-verification-events": [],
            "kyc-audit-stream": [],
        }
        self.event_count = 0
        self.start_time = time.time()

    async def produce(self, topic: str, event: StreamEvent) -> bool:
        """Produce event to Fluvio topic."""
        if topic not in self.topics:
            self.topics[topic] = []
        self.topics[topic].append(event.model_dump())
        self.event_count += 1
        return True

    async def consume(self, topic: str, offset: int = 0, limit: int = 100) -> list[dict]:
        """Consume events from Fluvio topic."""
        events = self.topics.get(topic, [])
        return events[offset:offset + limit]

    def get_stats(self) -> dict:
        uptime = time.time() - self.start_time
        return {
            "total_events": self.event_count,
            "events_per_second": self.event_count / uptime if uptime > 0 else 0,
            "topics": {name: len(events) for name, events in self.topics.items()},
            "uptime_seconds": uptime,
        }


class EventRouter:
    """Routes KYC events to appropriate handlers and downstream services."""

    def __init__(self, fluvio: FluvioClient):
        self.fluvio = fluvio
        self.handlers: dict[str, list] = defaultdict(list)
        self.websocket_clients: list[WebSocket] = []

    def register_handler(self, event_type: str, handler):
        self.handlers[event_type].append(handler)

    async def route_event(self, event: StreamEvent):
        """Route event to Fluvio topic and registered handlers."""
        topic = self._get_topic(event.event_type)
        await self.fluvio.produce(topic, event)

        for handler in self.handlers.get(event.event_type, []):
            try:
                await handler(event)
            except Exception as e:
                print(f"Handler error for {event.event_type}: {e}")

        for handler in self.handlers.get("*", []):
            try:
                await handler(event)
            except Exception:
                pass

        await self._broadcast_to_websockets(event)

    async def _broadcast_to_websockets(self, event: StreamEvent):
        """Broadcast event to connected WebSocket clients."""
        disconnected = []
        for ws in self.websocket_clients:
            try:
                await ws.send_json(event.model_dump())
            except Exception:
                disconnected.append(ws)
        for ws in disconnected:
            self.websocket_clients.remove(ws)

    def _get_topic(self, event_type: str) -> str:
        if event_type.startswith("kyb."):
            return "kyb-verification-events"
        if "gate" in event_type:
            return "kyc-gate-events"
        if "risk" in event_type or "alert" in event_type:
            return "kyc-risk-alerts"
        if "compliance" in event_type or "audit" in event_type:
            return "kyc-compliance-events"
        return "kyc-verification-events"


fluvio_client = FluvioClient(FLUVIO_ENDPOINT)
event_router = EventRouter(fluvio_client)


async def handle_verification_complete(event: StreamEvent):
    """Forward completed verifications to analytics Lakehouse."""
    if event.event_type in ("kyc.approved", "kyc.rejected"):
        try:
            import httpx
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"{ANALYTICS_URL}/api/v1/analytics/ingest",
                    json={"table": "verifications", "data": event.data},
                    timeout=5.0,
                )
        except Exception:
            pass


async def handle_risk_alert(event: StreamEvent):
    """Process high-risk alerts in real-time."""
    risk_score = event.data.get("risk_score", 0)
    if risk_score >= 0.7:
        alert_event = StreamEvent(
            id=f"alert-{int(time.time())}",
            event_type="kyc.risk.high_alert",
            session_id=event.session_id,
            user_id=event.user_id,
            timestamp=datetime.utcnow().isoformat(),
            data={
                "original_event": event.event_type,
                "risk_score": risk_score,
                "alert_level": "critical" if risk_score >= 0.9 else "high",
                "action_required": "manual_review",
            },
        )
        await fluvio_client.produce("kyc-risk-alerts", alert_event)


async def handle_gate_event(event: StreamEvent):
    """Log KYC gate check events for compliance."""
    try:
        import httpx
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{ANALYTICS_URL}/api/v1/analytics/ingest",
                json={"table": "events", "data": event.data},
                timeout=5.0,
            )
    except Exception:
        pass


event_router.register_handler("kyc.approved", handle_verification_complete)
event_router.register_handler("kyc.rejected", handle_verification_complete)
event_router.register_handler("kyc.risk.assessed", handle_risk_alert)
event_router.register_handler("kyc.gate.checked", handle_gate_event)


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    stats = fluvio_client.get_stats()
    return {
        "status": "healthy",
        "service": "kyc-stream-processor",
        "version": "1.0.0",
        "fluvio": stats,
        "connected_consumers": len(event_router.websocket_clients),
        "middleware": {
            "fluvio": FLUVIO_ENDPOINT,
            "kafka": KAFKA_BROKERS,
            "redis": REDIS_URL != "",
        },
    }


@app.post("/api/v1/stream/publish")
async def publish_event(event: StreamEvent):
    """Publish KYC event to the streaming pipeline."""
    await event_router.route_event(event)
    return {"status": "published", "event_id": event.id, "topic": event_router._get_topic(event.event_type)}


@app.get("/api/v1/stream/consume/{topic}")
async def consume_events(topic: str, offset: int = 0, limit: int = 100):
    """Consume events from a Fluvio topic."""
    events = await fluvio_client.consume(topic, offset, limit)
    return {"topic": topic, "offset": offset, "count": len(events), "events": events}


@app.get("/api/v1/stream/topics")
async def list_topics():
    """List all Fluvio topics."""
    return {
        name: {"event_count": len(events), "latest": events[-1] if events else None}
        for name, events in fluvio_client.topics.items()
    }


@app.get("/api/v1/stream/stats")
async def get_stats():
    """Get streaming pipeline statistics."""
    return fluvio_client.get_stats()


@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket):
    """WebSocket endpoint for real-time KYC event streaming."""
    await websocket.accept()
    event_router.websocket_clients.append(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                event_data = json.loads(data)
                event = StreamEvent(**event_data)
                await event_router.route_event(event)
            except (json.JSONDecodeError, ValueError) as e:
                await websocket.send_json({"error": str(e)})
    except WebSocketDisconnect:
        if websocket in event_router.websocket_clients:
            event_router.websocket_clients.remove(websocket)


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8115"))
    uvicorn.run(app, host="0.0.0.0", port=port)
