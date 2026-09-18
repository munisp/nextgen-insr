// TypeScript enabled — Sprint 96 security audit
/**
 * InsurePortal — Kafka Dead-Letter Queue (DLQ) Consumer
 *
 * Subscribes to all DLQ topics and:
 *   1. Logs the failed message with full context
 *   2. Attempts automatic retry (up to MAX_RETRIES) by re-publishing to original topic
 *   3. Persists unrecoverable messages to the database for manual review
 *   4. Sends an owner notification for critical failures
 *
 * Topics consumed:
 *   - insureportal.dlq.transactions
 *   - insureportal.dlq.settlements
 *   - insureportal.dlq.notifications
 */

import type { Consumer, EachMessagePayload, KafkaMessage } from "kafkajs";
import { Kafka } from "kafkajs";

import { ENV } from "./_core/env";
import { notifyOwner } from "./_core/notification";
import { getDb } from "./db";
import { dlqMessages } from "../drizzle/schema";
import { logger } from './_core/logger';
import {
  parseDlqMessage,
  RETRY_COUNT_HEADER,
  type DlqEnvelope,
} from "./lib/kafkaDlqEnvelope";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5_000;

// OPS-5: the DLQ payload is the UNIFIED envelope shared with the producer
// side (kafka-event-consumer sendToDLQ / legacy kafkaConsume). Parsing is
// delegated to parseDlqMessage, which also understands legacy header-only
// messages. retryCount is carried forward via the x-retry-count header on
// re-injection and NEVER resets — poison messages exhaust MAX_RETRIES and
// are persisted as "unrecoverable" instead of looping DLQ→topic→DLQ.
type DlqPayload = Omit<DlqEnvelope, "payload" | "failedAt" | "schema"> & {
  payload: Record<string, unknown>;
  timestamp: number;
};

function toLegacyPayload(e: DlqEnvelope): DlqPayload {
  return {
    originalTopic: e.originalTopic,
    originalPartition: e.originalPartition,
    originalOffset: e.originalOffset,
    errorMessage: e.errorMessage,
    retryCount: e.retryCount,
    payload:
      e.payload && typeof e.payload === "object"
        ? (e.payload as Record<string, unknown>)
        : { raw: e.payload },
    timestamp: e.failedAt,
  };
}

const kafka = new Kafka({
  clientId: "insureportal-dlq-consumer",
  brokers: ENV.kafkaBrokers.split(","),
  ssl: ENV.kafkaSsl === "true",
  sasl: ENV.kafkaSaslUsername
    ? {
        mechanism: "plain" as const,
        username: ENV.kafkaSaslUsername,
        password: ENV.kafkaSaslPassword,
      }
    : undefined,
  retry: { initialRetryTime: 1_000, retries: 5 },
});

let consumer: Consumer | null = null;

function parseMessage(message: KafkaMessage): DlqPayload | null {
  const envelope = parseDlqMessage(message);
  return envelope ? toLegacyPayload(envelope) : null;
}

async function retryMessage(payload: DlqPayload): Promise<void> {
  if (!payload.originalTopic || payload.originalTopic === "unknown") {
    // Fail loud — never publish to an undefined/unknown topic (old bug:
    // raw-forwarded DLQ messages had originalTopic only in headers, so the
    // body parse produced topic: undefined and the retry threw).
    throw new Error(
      `[DLQ] Cannot retry message without a valid originalTopic (offset=${payload.originalOffset})`
    );
  }
  await new Promise<void>(r => setTimeout(r, RETRY_DELAY_MS));
  const producer = kafka.producer();
  await producer.connect();
  try {
    await producer.send({
      topic: payload.originalTopic,
      messages: [
        {
          value: JSON.stringify(payload.payload),
          // OPS-5: attempt count travels in the header and is read back by
          // buildDlqEnvelope on the next failure — it never resets.
          headers: {
            [RETRY_COUNT_HEADER]: String((payload.retryCount || 0) + 1),
          },
        },
      ],
    });
  } finally {
    await producer.disconnect();
  }
}

async function persistToDlqLog(
  payload: DlqPayload,
  status: "pending_retry" | "unrecoverable" | "dropped"
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(dlqMessages).values({
      topic: payload.originalTopic,
      partition: payload.originalPartition,
      offset: payload.originalOffset,
      errorMessage: payload.errorMessage,
      retryCount: payload.retryCount,
      payload: JSON.stringify(payload.payload),
      status,
      createdAt: new Date(),
    });
  } catch (e: unknown) {
    logger.error("[DLQ] Failed to persist to DB:: " + e);
  }
}

async function handleTransactionDlq(payload: DlqPayload): Promise<void> {
  logger.error(
    `[DLQ][transactions] Failed — topic=${payload.originalTopic} retries=${payload.retryCount}`
  );

  if (payload.retryCount < MAX_RETRIES) {
    await retryMessage(payload).catch((e: unknown) =>
      logger.error("[DLQ] Retry failed:: " + e)
    );
    await persistToDlqLog(payload, "pending_retry");
    return;
  }

  await persistToDlqLog(payload, "unrecoverable");
  await notifyOwner({
    title: "🚨 Unrecoverable Transaction Failure",
    content: `DLQ message exhausted ${MAX_RETRIES} retries.\nTopic: ${payload.originalTopic}\nError: ${payload.errorMessage}`,
  }).catch(() => {});
}

async function handleSettlementDlq(payload: DlqPayload): Promise<void> {
  logger.error(
    `[DLQ][settlements] Failed — topic=${payload.originalTopic} retries=${payload.retryCount}`
  );

  const status =
    payload.retryCount >= MAX_RETRIES ? "unrecoverable" : "pending_retry";
  await persistToDlqLog(payload, status);

  if (payload.retryCount >= MAX_RETRIES) {
    await notifyOwner({
      title: "🚨 Unrecoverable Settlement Failure",
      content: `Settlement DLQ exhausted ${MAX_RETRIES} retries.\nTopic: ${payload.originalTopic}\nError: ${payload.errorMessage}`,
    }).catch(() => {});
  }
}

async function handleNotificationDlq(payload: DlqPayload): Promise<void> {
  logger.warn(`[DLQ][notifications] Dropped — retries=${payload.retryCount}`);
  await persistToDlqLog(payload, "dropped");
}

async function processMessage(
  topic: string,
  payload: DlqPayload
): Promise<void> {
  if (topic.includes("transactions")) {
    await handleTransactionDlq(payload);
  } else if (topic.includes("settlements")) {
    await handleSettlementDlq(payload);
  } else if (topic.includes("notifications")) {
    await handleNotificationDlq(payload);
  } else {
    logger.warn(`[DLQ] Unknown DLQ topic: ${topic}`);
  }
}

export async function startDlqConsumer(): Promise<void> {
  if (ENV.kafkaEnabled !== "true") {
    console.info("[DLQ] Kafka disabled — DLQ consumer not started");
    return;
  }

  consumer = kafka.consumer({
    groupId: "insureportal-dlq-processor",
    sessionTimeout: 30_000,
    heartbeatInterval: 3_000,
    maxBytesPerPartition: 1_048_576,
  });

  try {
    await consumer.connect();
    await consumer.subscribe({
      topics: [
        "insureportal.dlq.transactions",
        "insureportal.dlq.settlements",
        "insureportal.dlq.notifications",
      ],
      fromBeginning: false,
    });

    await consumer.run({
      autoCommit: false,
      eachMessage: async ({
        topic,
        partition,
        message,
        heartbeat,
      }: EachMessagePayload) => {
        const payload = parseMessage(message);
        if (!payload) {
          await consumer!.commitOffsets([
            {
              topic,
              partition,
              offset: (Number(message.offset) + 1).toString(),
            },
          ]);
          return;
        }

        try {
          await processMessage(topic, payload);
          await heartbeat();
          await consumer!.commitOffsets([
            {
              topic,
              partition,
              offset: (Number(message.offset) + 1).toString(),
            },
          ]);
        } catch (err: unknown) {
          logger.error(`[DLQ] Error processing message from ${topic}:: ` + String(err));
          // Do not commit — message will be reprocessed on next poll
        }
      },
    });

    console.info("[DLQ] ✅ DLQ consumer started — monitoring 3 topics");
  } catch (err: unknown) {
    logger.error("[DLQ] Failed to start DLQ consumer:: " + String(err));
  }
}

export async function stopDlqConsumer(): Promise<void> {
  if (consumer) {
    await consumer.disconnect().catch(() => {});
    consumer = null;
    console.info("[DLQ] DLQ consumer stopped");
  }
}
