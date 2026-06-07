// TypeScript enabled — Sprint 96 security audit
/**
 * kafkaClient.ts — Kafka integration for InsurePortal InsurePortal Platform
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides a thin wrapper for publishing domain events to Kafka topics.
 * Two modes:
 *
 *  1. Direct KafkaJS (when KAFKA_BROKERS is set) — used in local Docker Compose
 *     and staging environments where the InsurePortal Platform has direct broker access.
 *
 *  2. Platform proxy (when only PLATFORM_BASE_URL is available) — forwards
 *     publish calls to the Go event-bus service via APISix gateway.
 *     This is the default in production where the InsurePortal Platform sits behind the
 *     gateway and does not have direct broker access.
 *
 * Fail-open: publish() returns false on error so callers can continue
 * without Kafka (the transaction is already committed to PostgreSQL).
 *
 * Environment variables:
 *  - KAFKA_BROKERS        Comma-separated list e.g. kafka:9092,kafka2:9092
 *  - KAFKA_CLIENT_ID      Defaults to "platform-shell"
 *  - KAFKA_GROUP_ID       Consumer group ID, defaults to "platform-shell-group"
 *  - PLATFORM_BASE_URL    APISix gateway base URL (proxy mode fallback)
 *  - PLATFORM_API_KEY     Bearer token for the gateway
 */

// Default: local Kafka broker from docker-compose.production.yml
const KAFKA_BROKERS = process.env.KAFKA_BROKERS ?? "localhost:9092";
const KAFKA_CLIENT_ID = ENV.kafkaClientId;
const PLATFORM_BASE_URL = ENV.platformBaseUrl;
const PLATFORM_API_KEY = ENV.platformApiKey;

// ── KafkaJS producer (optional direct mode) ───────────────────────────────────
import type { Kafka as KafkaType, Producer } from "kafkajs";
import { ENV } from "./_core/env";
let _kafka: KafkaType | null = null;
let _producer: Producer | null = null;

async function getProducer(): Promise<Producer | null> {
  if (_producer) return _producer;
  try {
    const { Kafka } = await import("kafkajs");
    _kafka = new Kafka({
      clientId: KAFKA_CLIENT_ID,
      brokers: KAFKA_BROKERS.split(",").map(b => b.trim()),
      retry: { retries: 3 },
    });
    _producer = _kafka.producer({ allowAutoTopicCreation: false });
    await _producer.connect();
    console.log("[Kafka] Producer connected →", KAFKA_BROKERS);
    return _producer;
  } catch (err) {
    console.warn("[Kafka] Could not connect producer:", (err as Error).message);
    return null;
  }
}

// ── Proxy helper ──────────────────────────────────────────────────────────────
async function proxyPublish(
  topic: string,
  key: string,
  payload: unknown
): Promise<void> {
  const res = await fetch(`${PLATFORM_BASE_URL}/v1/events/publish`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PLATFORM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ topic, key, payload }),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Kafka proxy publish → ${res.status}`);
}

// ── Domain event types ────────────────────────────────────────────────────────

export type KafkaTopic =
  | "pos.transactions.created"
  | "pos.transactions.reversed"
  | "pos.float.topped_up"
  | "pos.float.depleted"
  | "pos.agents.registered"
  | "pos.agents.suspended"
  | "pos.kyc.submitted"
  | "pos.kyc.approved"
  | "pos.kyc.rejected"
  | "pos.disputes.opened"
  | "pos.disputes.resolved"
  | "pos.fraud.alert_raised";

export interface KafkaEvent<T = unknown> {
  eventId: string;
  eventType: KafkaTopic;
  timestamp: string; // ISO 8601
  agentCode?: string;
  tenantId?: string;
  payload: T;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Publish a domain event to a Kafka topic.
 * Returns true on success, false if Kafka is unavailable (fail-open).
 */
export async function publishEvent<T>(
  topic: KafkaTopic,
  key: string,
  payload: T,
  metadata?: { agentCode?: string; tenantId?: string }
): Promise<boolean> {
  const event: KafkaEvent<T> = {
    eventId: crypto.randomUUID(),
    eventType: topic,
    timestamp: new Date().toISOString(),
    agentCode: metadata?.agentCode,
    tenantId: metadata?.tenantId,
    payload,
  };

  try {
    const producer = await getProducer();
    if (producer) {
      await producer.send({
        topic,
        messages: [{ key, value: JSON.stringify(event) }],
      });
      return true;
    }
    await proxyPublish(topic, key, event);
    return true;
  } catch (err) {
    console.error(
      `[Kafka] Failed to publish ${topic}:`,
      (err as Error).message
    );
    return false;
  }
}

/**
 * Gracefully disconnect the Kafka producer.
 * Called during graceful shutdown.
 */
export async function disconnectKafka(): Promise<void> {
  if (_producer) {
    try {
      await _producer.disconnect();
    } catch {
      /* ignore */
    }
    _producer = null;
  }
}

/**
 * Health check — returns true if Kafka is reachable.
 */
export async function kafkaIsHealthy(): Promise<boolean> {
  try {
    if (KAFKA_BROKERS) {
      const producer = await getProducer();
      return producer !== null;
    }
    const res = await fetch(`${PLATFORM_BASE_URL}/v1/events/topics`, {
      headers: { Authorization: `Bearer ${PLATFORM_API_KEY}` },
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
