// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * InsurePortal POS Shell — Fluvio Streaming Client
 *
 * Fluvio is a cloud-native, Rust-based event streaming platform used by the
 * InsurePortal platform for:
 *   • Real-time transaction event streaming (pos.transactions.created)
 *   • Fraud alert fan-out (fraud-alerts)
 *   • Float balance change events (float-events)
 *   • Agent activity telemetry (agent-telemetry)
 *
 * Architecture:
 *   POS Shell → fluvioClient.produce() → Fluvio cluster → consumers (fraud engine,
 *   analytics, settlement, notification services)
 *
 * Fallback strategy:
 *   When FLUVIO_ENDPOINT is not set, the client falls back to the APISix platform
 *   proxy (/platform/fluvio/*) which routes to the Fluvio sidecar. If that is also
 *   unavailable, events are buffered in-memory and flushed on reconnect.
 *
 * Environment variables:
 *   FLUVIO_ENDPOINT   — WebSocket endpoint, e.g. wss://fluvio.insureportal.ng:9003
 *   FLUVIO_API_KEY    — Bearer token for the Fluvio HTTP gateway
 *   FLUVIO_TLS        — "true" to enable TLS verification (default: false in dev)
 */

import { ENV } from "../_core/env.js";
import axios from "axios";
import { logger } from '../_core/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FluvioEvent {
  topic: string;
  key?: string;
  payload: Record<string, unknown>;
  timestamp?: string;
}

export interface FluvioStreamStats {
  topic: string;
  messagesPerSecond: number;
  totalMessages: number;
  consumerLag: number;
  partitions: number;
}

export interface FluvioClientStatus {
  connected: boolean;
  mode: "direct" | "proxy" | "fallback";
  endpoint: string;
  bufferedEvents: number;
  topics: string[];
}

// ── Configuration ─────────────────────────────────────────────────────────────

const FLUVIO_ENDPOINT = ENV.fluvioEndpoint;
const FLUVIO_API_KEY = ENV.fluvioApiKey;
const PLATFORM_BASE_URL = ENV.platformBaseUrl; // APISix proxy fallback
const PLATFORM_API_KEY = ENV.platformApiKey;

/** Well-known topics this POS Shell produces to or consumes from */
export const FLUVIO_TOPICS = {
  TRANSACTIONS: "pos.transactions.created",
  FRAUD_ALERTS: "fraud-alerts",
  FLOAT_EVENTS: "float-events",
  AGENT_TELEMETRY: "agent-telemetry",
  KYC_EVENTS: "kyc-events",
  SETTLEMENT: "settlement-events",
} as const;

// ── In-memory buffer for when Fluvio is unreachable ──────────────────────────

interface BufferedEvent extends FluvioEvent {
  id: string;
  enqueuedAt: string;
  retries: number;
}

const eventBuffer: BufferedEvent[] = [];
const MAX_BUFFER_SIZE = 500;

let _connected = false;
let _mode: FluvioClientStatus["mode"] = "fallback";
let _flushTimer: ReturnType<typeof setInterval> | null = null;

// ── HTTP Gateway helpers ──────────────────────────────────────────────────────

/**
 * Publish a single event via the Fluvio HTTP gateway.
 * Fluvio exposes a REST gateway at /topics/{topic}/produce for HTTP producers.
 */
async function publishViaDirect(event: FluvioEvent): Promise<boolean> {
  if (!FLUVIO_ENDPOINT) return false;
  try {
    const url = `${FLUVIO_ENDPOINT}/topics/${encodeURIComponent(event.topic)}/produce`;
    await axios.post(
      url,
      {
        key: event.key ?? null,
        value: JSON.stringify({
          ...event.payload,
          _ts: event.timestamp ?? new Date().toISOString(),
        }),
      },
      {
        headers: {
          "Content-Type": "application/json",
          ...(FLUVIO_API_KEY
            ? { Authorization: `Bearer ${FLUVIO_API_KEY}` }
            : {}),
        },
        timeout: 3000,
      }
    );
    _connected = true;
    _mode = "direct";
    return true;
  } catch {
    _connected = false;
    return false;
  }
}

/**
 * Publish via APISix platform proxy when direct Fluvio is unavailable.
 * The proxy route is: PLATFORM_BASE_URL/fluvio/produce
 */
async function publishViaProxy(event: FluvioEvent): Promise<boolean> {
  if (!PLATFORM_BASE_URL) return false;
  try {
    await axios.post(
      `${PLATFORM_BASE_URL}/fluvio/produce`,
      {
        topic: event.topic,
        key: event.key ?? null,
        payload: event.payload,
        timestamp: event.timestamp ?? new Date().toISOString(),
      },
      {
        headers: {
          "Content-Type": "application/json",
          ...(PLATFORM_API_KEY ? { "X-API-Key": PLATFORM_API_KEY } : {}),
        },
        timeout: 5000,
      }
    );
    _connected = true;
    _mode = "proxy";
    return true;
  } catch {
    _connected = false;
    return false;
  }
}

// ── Buffer management ─────────────────────────────────────────────────────────

function bufferEvent(event: FluvioEvent): void {
  if (eventBuffer.length >= MAX_BUFFER_SIZE) {
    // Drop oldest event to make room (FIFO eviction)
    eventBuffer.shift();
  }
  eventBuffer.push({
    ...event,
    id: `buf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    enqueuedAt: new Date().toISOString(),
    retries: 0,
  });
  _mode = "fallback";
}

async function flushBuffer(): Promise<void> {
  if (eventBuffer.length === 0) return;
  const toFlush = eventBuffer.splice(0, 50); // flush up to 50 at a time
  let flushed = 0;
  let failed = 0;
  for (const buffered of toFlush) {
    const ok =
      (await publishViaDirect(buffered)) || (await publishViaProxy(buffered));
    if (ok) {
      flushed++;
    } else {
      // Re-buffer with incremented retry count
      if (buffered.retries < 5) {
        eventBuffer.unshift({ ...buffered, retries: buffered.retries + 1 });
      }
      failed++;
    }
  }
  if (flushed > 0) {
    logger.info(
      `[Fluvio] Flushed ${flushed} buffered events (${failed} re-buffered)`
    );
  }
}

// Start background flush timer (every 30 seconds)
function startFlushTimer(): void {
  if (_flushTimer) return;
  _flushTimer = setInterval(() => {
    flushBuffer().catch(e => logger.error("[Fluvio] Flush error:: " + e));
  }, 30_000);
  if (
    _flushTimer &&
    typeof _flushTimer === "object" &&
    "unref" in _flushTimer
  ) {
    (_flushTimer as NodeJS.Timeout).unref(); // Don't keep process alive
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Produce an event to a Fluvio topic.
 * Tries direct → proxy → in-memory buffer in order.
 */
export async function fluvioProduce(event: FluvioEvent): Promise<void> {
  startFlushTimer();
  // Flush any buffered events first (best-effort)
  if (eventBuffer.length > 0 && (FLUVIO_ENDPOINT || PLATFORM_BASE_URL)) {
    setImmediate(() => flushBuffer().catch(() => {}));
  }
  const sent =
    (await publishViaDirect(event)) || (await publishViaProxy(event));
  // Build enriched event for SSE fan-out (always, regardless of upstream status)
  const enriched = {
    ...event,
    id: `${event.topic}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: event.timestamp ?? new Date().toISOString(),
  };
  notifySseListeners(enriched);
  // Record analytics metrics (non-blocking, fire-and-forget)
  import("./analyticsMetrics")
    .then(({ recordMetric }) => {
      recordMetric("mqtt.messages.total", 1, { topic: event.topic }).catch(
        () => {}
      );
      if (sent) {
        recordMetric("mqtt.messages.sent", 1, { topic: event.topic }).catch(
          () => {}
        );
      } else {
        recordMetric("mqtt.messages.buffered", 1, { topic: event.topic }).catch(
          () => {}
        );
      }
    })
    .catch(() => {});
  if (!sent) {
    bufferEvent(event);
    logger.warn(
      `[Fluvio] Topic=${event.topic} buffered (direct+proxy unavailable). Buffer size: ${eventBuffer.length}`
    );
  } else {
    logger.info(`[Fluvio] Produced → ${event.topic} (mode=${_mode})`);
  }
}

/**
 * Convenience: publish a transaction-created event.
 */
export async function publishTransactionEvent(tx: {
  id: number;
  ref: string;
  type: string;
  amount: number;
  agentId: number;
  status: string;
  channel?: string;
  customerId?: number;
}): Promise<void> {
  await fluvioProduce({
    topic: FLUVIO_TOPICS.TRANSACTIONS,
    key: tx.ref,
    payload: {
      event: "transaction.created",
      transactionId: tx.id,
      ref: tx.ref,
      type: tx.type,
      amount: tx.amount,
      agentId: tx.agentId,
      status: tx.status,
      channel: tx.channel ?? "POS",
      customerId: tx.customerId ?? null,
      source: "insurance-portal",
    },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Convenience: publish a fraud alert event.
 */
export async function publishFraudAlertEvent(alert: {
  id: number;
  type: string;
  severity: string;
  agentId: number;
  transactionRef?: string;
}): Promise<void> {
  await fluvioProduce({
    topic: FLUVIO_TOPICS.FRAUD_ALERTS,
    key: `alert-${alert.id}`,
    payload: {
      event: "fraud.alert.created",
      alertId: alert.id,
      type: alert.type,
      severity: alert.severity,
      agentId: alert.agentId,
      transactionRef: alert.transactionRef ?? null,
      source: "insurance-portal",
    },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Convenience: publish a premium reserve change event.
 */
export async function publishFloatEvent(data: {
  agentId: number;
  previousBalance: number;
  newBalance: number;
  delta: number;
  reason: string;
  ref?: string;
}): Promise<void> {
  await fluvioProduce({
    topic: FLUVIO_TOPICS.FLOAT_EVENTS,
    key: `agent-${data.agentId}`,
    payload: {
      event: "float.balance.changed",
      ...data,
      source: "insurance-portal",
    },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Convenience: publish KYC session event.
 */
export async function publishKycEvent(data: {
  sessionId: number;
  agentId?: number;
  customerId?: number;
  status: string;
  kycLevel?: number;
}): Promise<void> {
  await fluvioProduce({
    topic: FLUVIO_TOPICS.KYC_EVENTS,
    key: `kyc-${data.sessionId}`,
    payload: {
      event: "kyc.session.updated",
      ...data,
      source: "insurance-portal",
    },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Get live stream stats from Fluvio HTTP gateway or proxy.
 */
export async function getFluvioStats(): Promise<FluvioStreamStats[]> {
  // Try direct Fluvio stats endpoint
  if (FLUVIO_ENDPOINT) {
    try {
      const { data } = await axios.get(`${FLUVIO_ENDPOINT}/topics`, {
        headers: FLUVIO_API_KEY
          ? { Authorization: `Bearer ${FLUVIO_API_KEY}` }
          : {},
        timeout: 3000,
      });
      const topics: string[] = Array.isArray(data?.topics)
        ? data.topics
        : Object.values(FLUVIO_TOPICS);
      return topics.map(topic => ({
        topic,
        messagesPerSecond: data?.stats?.[topic]?.mps ?? 0,
        totalMessages: data?.stats?.[topic]?.total ?? 0,
        consumerLag: data?.stats?.[topic]?.lag ?? 0,
        partitions: data?.stats?.[topic]?.partitions ?? 1,
      }));
    } catch {
      // fall through to proxy
    }
  }

  // Try proxy stats
  if (PLATFORM_BASE_URL) {
    try {
      const { data } = await axios.get(`${PLATFORM_BASE_URL}/fluvio/stats`, {
        headers: PLATFORM_API_KEY ? { "X-API-Key": PLATFORM_API_KEY } : {},
        timeout: 3000,
      });
      if (Array.isArray(data?.streams)) {
        return data.streams;
      }
    } catch {
      // fall through to synthetic
    }
  }

  // Synthetic stats from buffer state
  return Object.values(FLUVIO_TOPICS).map(topic => ({
    topic,
    messagesPerSecond: 0,
    totalMessages: 0,
    consumerLag: eventBuffer.filter(e => e.topic === topic).length,
    partitions: 1,
  }));
}

/**
 * Return current client status for health checks and admin panels.
 */
export function getFluvioStatus(): FluvioClientStatus {
  return {
    connected: _connected,
    mode: _mode,
    endpoint: FLUVIO_ENDPOINT || `${PLATFORM_BASE_URL}/fluvio` || "none",
    bufferedEvents: eventBuffer.length,
    topics: Object.values(FLUVIO_TOPICS),
  };
}

// ── SSE subscription bus ─────────────────────────────────────────────────────
// When fluvioProduce() is called, we also fan-out to any active SSE listeners
// so the admin dashboard receives events in real time even in buffer/fallback mode.

type SseListener = (
  event: FluvioEvent & { id: string; timestamp: string }
) => void;
const _sseListeners = new Map<string, Set<SseListener>>();

/**
 * Subscribe to events on a specific topic (or "all" for all topics).
 * Returns an unsubscribe function.
 */
export function subscribeToTopic(
  topic: string,
  listener: SseListener
): () => void {
  const key = topic;
  if (!_sseListeners.has(key)) _sseListeners.set(key, new Set());
  _sseListeners.get(key)!.add(listener);
  return () => {
    _sseListeners.get(key)?.delete(listener);
    if (_sseListeners.get(key)?.size === 0) _sseListeners.delete(key);
  };
}

/** Fan-out a produced event to all SSE listeners for that topic and "all". */
function notifySseListeners(
  event: FluvioEvent & { id: string; timestamp: string }
): void {
  const topicListeners = _sseListeners.get(event.topic);
  const allListeners = _sseListeners.get("all");
  topicListeners?.forEach(l => l(event));
  allListeners?.forEach(l => l(event));
}

/**
 * Graceful shutdown: flush remaining buffer before process exit.
 */
export async function shutdownFluvio(): Promise<void> {
  if (_flushTimer) {
    clearInterval(_flushTimer);
    _flushTimer = null;
  }
  if (eventBuffer.length > 0) {
    logger.info(
      `[Fluvio] Shutdown flush: ${eventBuffer.length} buffered events`
    );
    await flushBuffer();
  }
}
