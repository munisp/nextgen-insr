// TypeScript enabled — Sprint 96 security audit
/**
 * kafkaDlqEnvelope.ts — OPS-5: single DLQ envelope schema shared by the
 * producer side (kafka-event-consumer.ts sendToDLQ, legacy kafka.ts
 * kafkaConsume) and the consumer side (kafka-dlq-consumer.ts).
 *
 * THE BUG THIS FIXES: the producer previously forwarded the RAW original
 * message value with metadata only in headers, while the DLQ consumer parsed
 * the BODY for { originalTopic, retryCount, ... } — so retryMessage sent to
 * `topic: undefined` (threw) and `retryCount` was always undefined, resetting
 * the retry budget on every cycle (infinite poison-message redelivery).
 *
 * Envelope (JSON body, versioned):
 *   {
 *     schema: "dlq.v1",
 *     originalTopic, originalPartition, originalOffset,
 *     errorMessage, retryCount, failedAt,
 *     payload: <parsed original message value>
 *   }
 *
 * retryCount semantics: number of delivery attempts already made against the
 * ORIGINAL topic. It is carried forward via the `x-retry-count` header on
 * re-injection and NEVER resets. Poison messages exhaust MAX_RETRIES in the
 * DLQ consumer and are persisted as "unrecoverable" + owner notification.
 *
 * Backward compatibility: parseDlqMessage also understands legacy messages
 * (raw value + x-* headers) so in-flight DLQ messages from before the
 * envelope change are still processed, not dropped.
 */
import type { KafkaMessage } from "kafkajs";

export const DLQ_ENVELOPE_SCHEMA = "dlq.v1";
export const RETRY_COUNT_HEADER = "x-retry-count";

export interface DlqEnvelope {
  schema: typeof DLQ_ENVELOPE_SCHEMA;
  originalTopic: string;
  originalPartition: number;
  originalOffset: string;
  errorMessage: string;
  retryCount: number;
  payload: unknown;
  failedAt: number;
}

/** Extract the attempt count carried on an incoming message (never resets). */
export function extractPriorRetryCount(message: KafkaMessage): number {
  const header = message.headers?.[RETRY_COUNT_HEADER]?.toString();
  if (header !== undefined) {
    const n = Number(header);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  // Legacy in-body counter (dlq-consumer's old _retryCount re-injection)
  try {
    const body = JSON.parse(message.value?.toString() ?? "{}") as Record<
      string,
      unknown
    >;
    const n = Number(body?._retryCount);
    if (Number.isFinite(n) && n >= 0) return n;
  } catch {
    /* not JSON — no prior count */
  }
  return 0;
}

/** Serialize the DLQ envelope for produce. */
export function buildDlqEnvelope(args: {
  message: KafkaMessage;
  sourceTopic: string;
  partition: number;
  error: string;
}): { value: string; envelope: DlqEnvelope } {
  const { message, sourceTopic, partition, error } = args;
  let payload: unknown = message.value?.toString() ?? null;
  try {
    payload = JSON.parse(message.value?.toString() ?? "null");
  } catch {
    /* keep raw string payload */
  }
  const envelope: DlqEnvelope = {
    schema: DLQ_ENVELOPE_SCHEMA,
    originalTopic: sourceTopic,
    originalPartition: partition,
    originalOffset: message.offset ?? "0",
    errorMessage: error,
    retryCount: extractPriorRetryCount(message),
    payload,
    failedAt: Date.now(),
  };
  return { value: JSON.stringify(envelope), envelope };
}

/**
 * Parse a DLQ message into the unified envelope. Understands:
 *   1. dlq.v1 envelopes (current producer)
 *   2. legacy raw-value + x-* header messages (pre-OPS-5 producer)
 *   3. legacy body-shaped DlqPayload (early consumer expectation)
 * Returns null only when the message has no value at all.
 */
export function parseDlqMessage(message: KafkaMessage): DlqEnvelope | null {
  if (!message.value) return null;
  const raw = message.value.toString();
  const headers = message.headers ?? {};

  let body: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    body = null;
  }

  // 1. Current envelope
  if (body && body.schema === DLQ_ENVELOPE_SCHEMA) {
    return body as unknown as DlqEnvelope;
  }

  // 2. Legacy raw-forward (metadata in headers)
  if (headers["x-original-topic"]) {
    const retry = Number(headers[RETRY_COUNT_HEADER]?.toString() ?? "0");
    return {
      schema: DLQ_ENVELOPE_SCHEMA,
      originalTopic: headers["x-original-topic"]!.toString(),
      originalPartition: Number(headers["x-original-partition"]?.toString() ?? "0"),
      originalOffset: message.offset ?? "0",
      errorMessage: headers["x-error"]?.toString() ?? "unknown",
      retryCount: Number.isFinite(retry) ? retry : 0,
      payload: body ?? raw,
      failedAt: Number(headers["x-failed-at"]?.toString() ?? Date.now()),
    };
  }

  // 3. Legacy body-shaped payload (originalTopic field in body)
  if (body && typeof body.originalTopic === "string") {
    return {
      schema: DLQ_ENVELOPE_SCHEMA,
      originalTopic: body.originalTopic,
      originalPartition: Number(body.originalPartition ?? 0),
      originalOffset: String(body.originalOffset ?? "0"),
      errorMessage: String(body.errorMessage ?? "unknown"),
      retryCount: Number(body.retryCount ?? 0) || 0,
      payload: body.payload ?? null,
      failedAt: Number(body.timestamp ?? Date.now()),
    };
  }

  // 4. Unparseable — wrap so it is persisted, not silently dropped.
  return {
    schema: DLQ_ENVELOPE_SCHEMA,
    originalTopic: "unknown",
    originalPartition: 0,
    originalOffset: message.offset ?? "0",
    errorMessage: "Failed to parse DLQ message",
    retryCount: Number.MAX_SAFE_INTEGER, // never auto-retry garbage
    payload: { raw },
    failedAt: Date.now(),
  };
}
