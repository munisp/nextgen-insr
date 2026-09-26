// TypeScript enabled — Sprint 96 security audit
/**
 * kafkaClient.ts — Kafka integration for InsurePortal POS Shell
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
 *  - KAFKA_CLIENT_ID      Defaults to "insurance-portal"
 *  - KAFKA_GROUP_ID       Consumer group ID, defaults to "insurance-portal-group"
 *  - PLATFORM_BASE_URL    APISix gateway base URL (proxy mode fallback)
 *  - PLATFORM_API_KEY     Bearer token for the gateway
 */
import type { Kafka as KafkaType, Producer } from "kafkajs";

import { ENV } from "./_core/env";
import { logger } from "./_core/logger";

// Default: local Kafka broker from docker-compose.production.yml
const KAFKA_BROKERS = process.env.KAFKA_BROKERS ?? "localhost:9092";
const KAFKA_CLIENT_ID = ENV.kafkaClientId;
const PLATFORM_BASE_URL = ENV.platformBaseUrl;
const PLATFORM_API_KEY = ENV.platformApiKey;

// ── KafkaJS producer (optional direct mode) ───────────────────────────────────
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
    // P-wave perf (2026-09-19): idempotent producer (per-partition
    // exactly-once at the broker, preserves at-least-once semantics for the
    // app) with bounded in-flight requests. KafkaJS has no linger.ms knob —
    // the enqueue batcher below implements the 8ms linger + batch sizing.
    _producer = _kafka.producer({
      allowAutoTopicCreation: false,
      idempotent: true,
      maxInFlightRequests: 5,
      retry: { retries: 5 },
    });
    await _producer.connect();
    logger.info({ brokers: KAFKA_BROKERS }, "[Kafka] Producer connected (idempotent)");
    return _producer;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[Kafka] Could not connect producer");
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
  | "54link.transactions.created"
  | "54link.transactions.reversed"
  | "54link.float.topped_up"
  | "54link.float.depleted"
  | "54link.agents.registered"
  | "54link.agents.suspended"
  | "54link.kyc.submitted"
  | "54link.kyc.approved"
  | "54link.kyc.rejected"
  | "54link.disputes.opened"
  | "54link.disputes.resolved"
  | "54link.fraud.alert_raised"
  // Q-wave Q1 (2026-09-25): embedded partner factory domain events. Published
  // via the default enqueue-and-return path (no requireAck — notification
  // semantics; the policy/claim/enrollment row is already committed to
  // PostgreSQL before publish).
  | "embedded.policy.bound"
  | "embedded.claim.created"
  | "freemium.upgraded";

export interface KafkaEvent<T = unknown> {
  eventId: string;
  eventType: KafkaTopic;
  timestamp: string; // ISO 8601
  agentId?: string;
  tenantId?: string;
  payload: T;
}

// ── Public API ────────────────────────────────────────────────────────────────

// P-wave perf (2026-09-19): publishEvent was awaited INLINE inside tRPC
// mutations — a full broker RTT (or 3s proxy-timeout tail) on every
// transaction mutation. Call-site audit: every router/middleware caller
// either ignores the boolean result (fail-open notification semantics — the
// transaction is already committed to PostgreSQL) or is already
// fire-and-forget (.then without await, e.g. routers/transactions.ts:901).
// The ONLY ack-dependent callers are commissionMiddleware.ts and
// settlementMiddleware.ts, which throw on `false` — they pass
// { requireAck: true } and keep the old awaited-send behavior.
//
// Default path is now enqueue-and-return: events go to a bounded in-process
// batch queue flushed by a background worker every KAFKA_LINGER_MS (8ms
// linger, batches of up to KAFKA_BATCH_SIZE=100 per topic via sendBatch).
// Flush failures are logged + metered and never thrown to the caller —
// identical fail-open loss window as before (the old code also dropped the
// event on error, returning false which callers ignored).
interface QueuedEvent {
  topic: KafkaTopic;
  key: string;
  event: KafkaEvent<unknown>;
}
const publishQueue: QueuedEvent[] = [];
const KAFKA_LINGER_MS = 8;
const KAFKA_BATCH_SIZE = 100;
const KAFKA_MAX_QUEUE = 5000;
let _flushTimerActive = false;

async function flushPublishQueue(): Promise<void> {
  _flushTimerActive = false;
  if (publishQueue.length === 0) return;
  const batch = publishQueue.splice(0, KAFKA_BATCH_SIZE);
  try {
    const producer = await getProducer();
    if (producer) {
      // Group by topic → one produce request per topic (batch sizing).
      const byTopic = new Map<string, QueuedEvent[]>();
      for (const q of batch) {
        const arr = byTopic.get(q.topic) ?? [];
        arr.push(q);
        byTopic.set(q.topic, arr);
      }
      await producer.sendBatch({
        topicMessages: [...byTopic.entries()].map(([topic, items]) => ({
          topic,
          messages: items.map(i => ({
            key: i.key,
            value: JSON.stringify(i.event),
          })),
        })),
      });
      return;
    }
    // Proxy mode: no batch endpoint — publish sequentially off-request-path.
    for (const q of batch) {
      await proxyPublish(q.topic, q.key, q.event);
    }
  } catch (err) {
    logger.error(
      { err: (err as Error).message, dropped: batch.length },
      "[Kafka] Batch flush failed; events dropped (fail-open, transaction already committed)"
    );
    import("./lib/analyticsMetrics")
      .then(({ recordMetric }) =>
        recordMetric("kafka.publish.failed", batch.length).catch(() => {})
      )
      .catch(() => {});
  } finally {
    if (publishQueue.length > 0) scheduleFlush();
  }
}

function scheduleFlush(): void {
  if (_flushTimerActive) return;
  _flushTimerActive = true;
  setTimeout(() => {
    flushPublishQueue().catch(e =>
      logger.error("[Kafka] Flush error:: " + String(e))
    );
  }, KAFKA_LINGER_MS).unref();
}

/**
 * Publish a domain event to a Kafka topic.
 * Returns true on success, false if Kafka is unavailable (fail-open).
 *
 * Default (requireAck omitted/false): enqueue-and-return — the event is
 * queued synchronously and flushed by the background batch worker; the
 * returned promise resolves true once queued. Pass { requireAck: true } for
 * payment-critical publishes that must await the broker/proxy ack
 * (commissionMiddleware, settlementMiddleware).
 */
export async function publishEvent<T>(
  topic: KafkaTopic,
  key: string,
  payload: T,
  metadata?: { agentId?: string; tenantId?: string },
  opts?: { requireAck?: boolean }
): Promise<boolean> {
  const event: KafkaEvent<T> = {
    eventId: crypto.randomUUID(),
    eventType: topic,
    timestamp: new Date().toISOString(),
    agentId: metadata?.agentId,
    tenantId: metadata?.tenantId,
    payload,
  };

  if (!opts?.requireAck) {
    // Enqueue-and-return: never blocks the request path on broker I/O.
    if (publishQueue.length >= KAFKA_MAX_QUEUE) {
      logger.error(
        { topic },
        "[Kafka] Publish queue full; event dropped (fail-open)"
      );
      import("./lib/analyticsMetrics")
        .then(({ recordMetric }) =>
          recordMetric("kafka.publish.dropped", 1, { topic }).catch(() => {})
        )
        .catch(() => {});
      return false;
    }
    publishQueue.push({ topic, key, event: event as KafkaEvent<unknown> });
    scheduleFlush();
    return true;
  }

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
    logger.error({ topic, err: (err as Error).message }, "[Kafka] Failed to publish event");
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
