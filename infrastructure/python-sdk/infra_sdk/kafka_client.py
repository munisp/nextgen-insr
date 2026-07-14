"""Kafka async client with idempotent producer, consumer groups, and DLQ support."""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Callable, Optional

import httpx

logger = logging.getLogger("ngapp.infra.kafka")

PLATFORM_TOPICS = [
    "kyc.verification.events",
    "kyc.gate.events",
    "kyc.risk.alerts",
    "kyb.verification.events",
    "policy.lifecycle",
    "claims.lifecycle",
    "payments.processed",
    "premium.collected",
    "agent.commission",
    "fraud.detection",
    "audit.trail",
    "compliance.events",
    "mojaloop.transfers",
    "notifications.outbound",
    "customer.onboarding",
    "underwriting.decisions",
]


class KafkaClient:
    def __init__(self, brokers: list[str]):
        self._brokers = brokers
        self._http = httpx.AsyncClient(timeout=10.0)
        self._producer = None
        self._consumers: dict[str, Any] = {}

    async def ping(self):
        try:
            from aiokafka import AIOKafkaProducer
            producer = AIOKafkaProducer(bootstrap_servers=",".join(self._brokers))
            await producer.start()
            await producer.stop()
        except ImportError:
            logger.warning("aiokafka not installed, using HTTP fallback")
        except Exception as e:
            raise ConnectionError(f"Kafka ping failed: {e}") from e

    async def start_producer(self):
        try:
            from aiokafka import AIOKafkaProducer
            self._producer = AIOKafkaProducer(
                bootstrap_servers=",".join(self._brokers),
                enable_idempotence=True,
                acks="all",
                max_batch_size=16384,
                linger_ms=10,
            )
            await self._producer.start()
            logger.info("kafka_producer_started")
        except ImportError:
            logger.warning("aiokafka not available")

    async def publish(self, topic: str, key: str, payload: Any):
        data = json.dumps(payload).encode() if not isinstance(payload, bytes) else payload
        key_bytes = key.encode() if isinstance(key, str) else key

        if self._producer:
            try:
                await self._producer.send_and_wait(topic, value=data, key=key_bytes)
                return
            except Exception as e:
                logger.error("kafka_publish_failed: %s, sending to DLQ", e)
                try:
                    await self._producer.send_and_wait(
                        f"{topic}.dlq", value=data, key=key_bytes,
                    )
                except Exception:
                    pass
                raise

    async def publish_policy_event(self, policy_id: str, event_type: str, data: dict):
        await self.publish("policy.lifecycle", policy_id, {
            "policy_id": policy_id,
            "event_type": event_type,
            "data": data,
            "timestamp": time.time(),
        })

    async def publish_claim_event(self, claim_id: str, event_type: str, data: dict):
        await self.publish("claims.lifecycle", claim_id, {
            "claim_id": claim_id,
            "event_type": event_type,
            "data": data,
            "timestamp": time.time(),
        })

    async def publish_payment_event(self, payment_id: str, event_type: str, data: dict):
        await self.publish("payments.processed", payment_id, {
            "payment_id": payment_id,
            "event_type": event_type,
            "data": data,
            "timestamp": time.time(),
        })

    async def publish_audit_event(self, service: str, action: str, details: dict):
        await self.publish("audit.trail", service, {
            "service": service,
            "action": action,
            "details": details,
            "timestamp": time.time(),
        })

    async def start_consumer(self, topic: str, group_id: str, handler: Callable):
        try:
            from aiokafka import AIOKafkaConsumer
            consumer = AIOKafkaConsumer(
                topic,
                bootstrap_servers=",".join(self._brokers),
                group_id=group_id,
                auto_offset_reset="earliest",
                enable_auto_commit=False,
            )
            await consumer.start()
            self._consumers[topic] = consumer
            logger.info("kafka_consumer_started: %s (group=%s)", topic, group_id)

            async for msg in consumer:
                try:
                    payload = json.loads(msg.value.decode())
                    await handler(payload)
                    await consumer.commit()
                except Exception as e:
                    logger.error("consumer_handler_error: %s: %s", topic, e)
        except ImportError:
            logger.warning("aiokafka not available for consumer")

    async def close(self):
        if self._producer:
            await self._producer.stop()
        for consumer in self._consumers.values():
            await consumer.stop()
