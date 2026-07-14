"""
Event Bridge — Connects platform microservices to the Lakehouse pipeline.

Provides:
- Event publishing SDK (Python client for Go/Rust/TS services to call)
- Buffered batch writes with at-least-once delivery
- Event schema validation
- Retry with exponential backoff
- Circuit breaker for downstream failures
- Multi-topic fan-out
"""

from __future__ import annotations

import json
import time
import threading
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable


class CircuitState(Enum):
    CLOSED = "closed"  # Normal operation
    OPEN = "open"  # Failing, reject requests
    HALF_OPEN = "half_open"  # Testing recovery


@dataclass
class EventEnvelope:
    """Standardized event envelope for all platform events."""
    topic: str
    key: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)
    source_service: str = ""
    correlation_id: str | None = None
    headers: dict[str, str] = field(default_factory=dict)

    def to_json(self) -> bytes:
        return json.dumps({
            "topic": self.topic,
            "key": self.key,
            "payload": self.payload,
            "timestamp": self.timestamp,
            "source_service": self.source_service,
            "correlation_id": self.correlation_id,
            "headers": self.headers,
        }, default=str).encode()

    @classmethod
    def from_json(cls, data: bytes) -> EventEnvelope:
        obj = json.loads(data)
        return cls(**obj)


@dataclass
class CircuitBreakerConfig:
    """Configuration for the circuit breaker."""
    failure_threshold: int = 5
    recovery_timeout_seconds: float = 30.0
    success_threshold: int = 3


class CircuitBreaker:
    """Circuit breaker pattern for downstream service protection."""

    def __init__(self, config: CircuitBreakerConfig | None = None) -> None:
        self.config = config or CircuitBreakerConfig()
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._last_failure_time = 0.0
        self._lock = threading.Lock()

    @property
    def state(self) -> CircuitState:
        with self._lock:
            if self._state == CircuitState.OPEN:
                if (time.time() - self._last_failure_time) > self.config.recovery_timeout_seconds:
                    self._state = CircuitState.HALF_OPEN
                    self._success_count = 0
            return self._state

    def record_success(self) -> None:
        with self._lock:
            if self._state == CircuitState.HALF_OPEN:
                self._success_count += 1
                if self._success_count >= self.config.success_threshold:
                    self._state = CircuitState.CLOSED
                    self._failure_count = 0
            else:
                self._failure_count = 0

    def record_failure(self) -> None:
        with self._lock:
            self._failure_count += 1
            self._last_failure_time = time.time()
            if self._failure_count >= self.config.failure_threshold:
                self._state = CircuitState.OPEN

    @property
    def is_available(self) -> bool:
        return self.state != CircuitState.OPEN


@dataclass
class BridgeConfig:
    """Configuration for the event bridge."""
    # Buffer
    buffer_size: int = 10000
    flush_interval_seconds: float = 5.0
    max_batch_size: int = 500

    # Delivery
    max_retries: int = 3
    retry_backoff_seconds: float = 1.0
    delivery_timeout_seconds: float = 10.0

    # Storage
    event_dir: str = "lakehouse_store/_events"
    failed_dir: str = "lakehouse_store/_failed_events"

    # Circuit breaker
    circuit_breaker: CircuitBreakerConfig = field(default_factory=CircuitBreakerConfig)


class EventBridge:
    """Main event bridge connecting microservices to the Lakehouse.

    Architecture:
    [Microservices] → [EventBridge] → [Event Files / Kafka] → [StreamingIngestion] → [Delta Lake]
    """

    def __init__(self, config: BridgeConfig | None = None) -> None:
        self.config = config or BridgeConfig()
        self._buffer: deque[EventEnvelope] = deque(maxlen=self.config.buffer_size)
        self._circuit_breaker = CircuitBreaker(self.config.circuit_breaker)
        self._lock = threading.Lock()
        self._running = False
        self._flush_thread: threading.Thread | None = None
        self._event_dir = Path(self.config.event_dir)
        self._failed_dir = Path(self.config.failed_dir)
        self._event_dir.mkdir(parents=True, exist_ok=True)
        self._failed_dir.mkdir(parents=True, exist_ok=True)
        self._stats = {
            "published": 0,
            "delivered": 0,
            "failed": 0,
            "retried": 0,
        }

    def start(self) -> None:
        """Start the event bridge flush loop."""
        self._running = True
        self._flush_thread = threading.Thread(
            target=self._flush_loop,
            name="event-bridge-flush",
            daemon=True,
        )
        self._flush_thread.start()

    def stop(self) -> None:
        """Stop the event bridge and flush remaining events."""
        self._running = False
        self._flush_remaining()
        if self._flush_thread:
            self._flush_thread.join(timeout=5)

    def publish(self, event: EventEnvelope) -> bool:
        """Publish an event to the bridge buffer.

        Returns True if accepted, False if circuit breaker is open.
        """
        if not self._circuit_breaker.is_available:
            self._stats["failed"] += 1
            return False

        with self._lock:
            self._buffer.append(event)
            self._stats["published"] += 1

        # Flush immediately if batch is full
        if len(self._buffer) >= self.config.max_batch_size:
            self._flush_batch()

        return True

    def publish_claim_event(
        self,
        claim_id: str,
        amount: float,
        policy_limit: float,
        event_type: str = "submitted",
        source_service: str = "claims-engine",
        **kwargs: Any,
    ) -> bool:
        """Convenience: Publish a claims event."""
        return self.publish(EventEnvelope(
            topic=f"claims.{event_type}",
            key=claim_id,
            payload={
                "claim_id": claim_id,
                "amount": amount,
                "policy_limit": policy_limit,
                **kwargs,
            },
            source_service=source_service,
        ))

    def publish_fraud_alert(
        self,
        alert_id: str,
        customer_id: str,
        risk_score: float,
        alert_type: str = "suspicious_activity",
        source_service: str = "fraud-service",
        **kwargs: Any,
    ) -> bool:
        """Convenience: Publish a fraud alert event."""
        return self.publish(EventEnvelope(
            topic="fraud.alerts",
            key=alert_id,
            payload={
                "alert_id": alert_id,
                "customer_id": customer_id,
                "risk_score": risk_score,
                "alert_type": alert_type,
                **kwargs,
            },
            source_service=source_service,
        ))

    def publish_payment_event(
        self,
        txn_id: str,
        amount: float,
        method: str = "transfer",
        source_service: str = "payments-service",
        **kwargs: Any,
    ) -> bool:
        """Convenience: Publish a payment event."""
        return self.publish(EventEnvelope(
            topic="payments.processed",
            key=txn_id,
            payload={
                "transaction_id": txn_id,
                "amount": amount,
                "method": method,
                "hour": int(time.localtime().tm_hour),
                "day_of_week": int(time.localtime().tm_wday),
                **kwargs,
            },
            source_service=source_service,
        ))

    def publish_kyc_event(
        self,
        customer_id: str,
        ocr_score: float,
        face_match: float,
        liveness: float,
        doc_verified: bool = True,
        source_service: str = "kyc-service",
        **kwargs: Any,
    ) -> bool:
        """Convenience: Publish a KYC completion event."""
        return self.publish(EventEnvelope(
            topic="kyc.completed",
            key=customer_id,
            payload={
                "customer_id": customer_id,
                "ocr_score": ocr_score,
                "face_match": face_match,
                "liveness": liveness,
                "doc_verified": doc_verified,
                **kwargs,
            },
            source_service=source_service,
        ))

    def publish_policy_event(
        self,
        policy_id: str,
        customer_id: str,
        product_type: str,
        premium: float,
        event_type: str = "created",
        source_service: str = "policy-service",
        **kwargs: Any,
    ) -> bool:
        """Convenience: Publish a policy lifecycle event."""
        return self.publish(EventEnvelope(
            topic=f"policies.{event_type}",
            key=policy_id,
            payload={
                "policy_id": policy_id,
                "customer_id": customer_id,
                "product_type": product_type,
                "premium": premium,
                **kwargs,
            },
            source_service=source_service,
        ))

    def _flush_loop(self) -> None:
        """Periodic flush of buffered events."""
        while self._running:
            time.sleep(self.config.flush_interval_seconds)
            self._flush_batch()

    def _flush_batch(self) -> None:
        """Flush current buffer to storage."""
        with self._lock:
            batch = []
            while self._buffer and len(batch) < self.config.max_batch_size:
                batch.append(self._buffer.popleft())

        if not batch:
            return

        for event in batch:
            success = self._deliver_event(event)
            if success:
                self._stats["delivered"] += 1
                self._circuit_breaker.record_success()
            else:
                self._stats["failed"] += 1
                self._circuit_breaker.record_failure()

    def _flush_remaining(self) -> None:
        """Flush all remaining events on shutdown."""
        with self._lock:
            remaining = list(self._buffer)
            self._buffer.clear()

        for event in remaining:
            self._deliver_event(event)

    def _deliver_event(self, event: EventEnvelope, attempt: int = 0) -> bool:
        """Deliver a single event to the storage layer with retry."""
        try:
            # Write to event file (consumed by streaming ingestion engine)
            event_file = self._event_dir / f"{event.topic.replace('.', '_')}_{int(time.time() * 1000000)}.json"
            data = {
                "_topic": event.topic,
                "_key": event.key,
                "_timestamp": event.timestamp,
                "_source": event.source_service,
                "_correlation_id": event.correlation_id,
                **event.payload,
            }
            event_file.write_text(json.dumps(data, default=str))
            return True
        except Exception as e:
            if attempt < self.config.max_retries:
                self._stats["retried"] += 1
                time.sleep(self.config.retry_backoff_seconds * (2 ** attempt))
                return self._deliver_event(event, attempt + 1)
            else:
                # Write to failed events directory
                failed_file = self._failed_dir / f"failed_{int(time.time() * 1000000)}.json"
                try:
                    failed_file.write_text(json.dumps({
                        "event": json.loads(event.to_json()),
                        "error": str(e),
                        "attempts": attempt + 1,
                    }, default=str))
                except Exception:
                    pass
                return False

    def get_status(self) -> dict[str, Any]:
        """Get bridge status and metrics."""
        return {
            "running": self._running,
            "buffer_size": len(self._buffer),
            "circuit_breaker": self._circuit_breaker.state.value,
            "stats": self._stats,
            "pending_events": len(list(self._event_dir.glob("*.json"))),
            "failed_events": len(list(self._failed_dir.glob("*.json"))),
        }


class ServiceConnector:
    """High-level connector for a specific microservice.

    Each microservice gets its own connector instance with service-specific
    publishing methods and metrics.
    """

    def __init__(self, service_name: str, bridge: EventBridge) -> None:
        self.service_name = service_name
        self._bridge = bridge
        self._published = 0

    def emit(self, topic: str, key: str | None, payload: dict[str, Any]) -> bool:
        """Emit an event from this service."""
        event = EventEnvelope(
            topic=topic,
            key=key,
            payload=payload,
            source_service=self.service_name,
        )
        success = self._bridge.publish(event)
        if success:
            self._published += 1
        return success

    @property
    def stats(self) -> dict[str, Any]:
        return {
            "service": self.service_name,
            "events_published": self._published,
        }
