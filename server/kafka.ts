// TypeScript enabled — Sprint 96 security audit
/**
 * Kafka Event Bus Integration
 *
 * Provides a KafkaJS producer and consumer for the 54Link platform.
 * All transaction, fraud, settlement, and SIM failover events are published
 * to Kafka topics for downstream processing.
 *
 * Topics:
 *   tx.created     — emitted on every successful transaction
 *   tx.settled     — emitted after daily settlement run
 *   fraud.alert    — emitted when a fraud rule fires
 *   sim.failover   — emitted on every emergency SIM switch
 *
 * Configuration:
 *   KAFKA_BROKERS   — comma-separated broker list (default: localhost:9092)
 *   KAFKA_CLIENT_ID — client identifier (default: pos-shell-demo)
 *   KAFKA_ENABLED   — set to "false" to disable (default: true)
 *
 * When KAFKA_ENABLED=false or brokers are unreachable, all publish calls
 * degrade gracefully (log warning, return false) so the main app continues.
 */

import { Kafka, Producer, Consumer, logLevel, CompressionTypes } from "kafkajs";
import { Kafka, Producer, Consumer, logLevel, CompressionTypes } from "kafkajs";
import { logger } from './_core/logger';

// ─── Configuration ────────────────────────────────────────────────────────────

const KAFKA_ENABLED = process.env.KAFKA_ENABLED !== "false";
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS ?? "localhost:9092")
  .split(",")
  .map(b => b.trim());
const KAFKA_CLIENT_ID = process.env.KAFKA_CLIENT_ID ?? "pos-shell-demo";

// ─── Topic definitions ────────────────────────────────────────────────────────

export const TOPICS = {
  TX_CREATED: "tx.created",
  TX_SETTLED: "tx.settled",
  FRAUD_ALERT: "fraud.alert",
  SIM_FAILOVER: "sim.failover",
} as const;

export type KafkaTopic = (typeof TOPICS)[keyof typeof TOPICS];

// ─── Kafka instance ───────────────────────────────────────────────────────────

let kafka: Kafka | null = null;
let producer: Producer | null = null;
let producerConnected = false;

function getKafka(): Kafka {
  if (!kafka) {
    kafka = new Kafka({
      clientId: KAFKA_CLIENT_ID,
      brokers: KAFKA_BROKERS,
      logLevel: logLevel.WARN,
      retry: {
        initialRetryTime: 300,
        retries: 3,
      },
    });
  }
  return kafka;
}

// ─── Producer ─────────────────────────────────────────────────────────────────

async function getProducer(): Promise<Producer | null> {
  if (!KAFKA_ENABLED) return null;
  if (producer && producerConnected) return producer;

  try {
    producer = getKafka().producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30_000,
    });
    await producer.connect();
    producerConnected = true;
    logger.info("[Kafka] Producer connected to", KAFKA_BROKERS.join(", "));
    return producer;
  } catch (err) {
    logger.warn(
      "[Kafka] Producer connection failed (non-critical):",
      (err as Error).message
    );
    producer = null;
    producerConnected = false;
    return null;
  }
}

/**
 * Publish a message to a Kafka topic.
 * Returns true on success, false on failure (graceful degradation).
 */
export async function kafkaPublish(
  topic: KafkaTopic,
  key: string,
  value: Record<string, unknown>
): Promise<boolean> {
  if (!KAFKA_ENABLED) return false;

  const prod = await getProducer();
  if (!prod) return false;

  try {
    await prod.send({
      topic,
      compression: CompressionTypes.GZIP,
      messages: [
        {
          key,
          value: JSON.stringify({
            ...value,
            _meta: {
              topic,
              publishedAt: new Date().toISOString(),
              clientId: KAFKA_CLIENT_ID,
            },
          }),
        },
      ],
    });
    return true;
  } catch (err) {
    logger.warn(`[Kafka] Publish to ${topic} failed:`, (err as Error).message);
    // Reset producer so next call reconnects
    producerConnected = false;
    return false;
  }
}

// ─── Consumer factory ─────────────────────────────────────────────────────────

/**
 * Create and start a Kafka consumer for a given topic.
 * The handler is called for each message.
 * Returns a disconnect function for graceful shutdown.
 */
export async function kafkaConsume(
  groupId: string,
  topic: KafkaTopic,
  handler: (key: string, value: Record<string, unknown>) => Promise<void>
): Promise<(() => Promise<void>) | null> {
  if (!KAFKA_ENABLED) return null;

  let consumer: Consumer | null = null;
  try {
    consumer = getKafka().consumer({ groupId });
    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ message }) => {
        try {
          const key = message.key?.toString() ?? "";
          const raw = message.value?.toString() ?? "{}";
          const value = JSON.parse(raw) as Record<string, unknown>;
          await handler(key, value);
        } catch (err) {
          logger.warn(
            `[Kafka] Handler error for topic ${topic}:`,
            (err as Error).message
          );
        }
      },
    });

    logger.info(`[Kafka] Consumer '${groupId}' subscribed to ${topic}`);

    return async () => {
      await consumer?.disconnect();
      logger.info(`[Kafka] Consumer '${groupId}' disconnected`);
    };
  } catch (err) {
    logger.warn(
      `[Kafka] Consumer '${groupId}' failed to start:`,
      (err as Error).message
    );
    await consumer?.disconnect().catch(() => {});
    return null;
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

export async function kafkaDisconnect(): Promise<void> {
  if (producer && producerConnected) {
    await producer.disconnect().catch(() => {});
    producerConnected = false;
    logger.info("[Kafka] Producer disconnected");
  }
}

// ─── Typed event publishers ───────────────────────────────────────────────────

export interface TxCreatedEvent {
  txRef: string;
  agentCode: string;
  terminalId?: string;
  type: string;
  amount: number;
  fee: number;
  commission: number;
  customer: string;
  status: string;
  channel: string;
}

export async function publishTxCreated(
  event: TxCreatedEvent
): Promise<boolean> {
  return kafkaPublish(
    TOPICS.TX_CREATED,
    event.txRef,
    event as unknown as Record<string, unknown>
  );
}

export interface TxSettledEvent {
  settlementDate: string;
  agentCode: string;
  txCount: number;
  totalVolume: number;
  totalCommission: number;
  failedCount: number;
}

export async function publishTxSettled(
  event: TxSettledEvent
): Promise<boolean> {
  return kafkaPublish(
    TOPICS.TX_SETTLED,
    `${event.settlementDate}-${event.agentCode}`,
    event as unknown as Record<string, unknown>
  );
}

export interface FraudAlertEvent {
  alertId: number;
  agentCode: string;
  txRef?: string;
  severity: string;
  type: string;
  amount: number;
  customer: string;
  reason: string;
}

export async function publishFraudAlert(
  event: FraudAlertEvent
): Promise<boolean> {
  return kafkaPublish(
    TOPICS.FRAUD_ALERT,
    String(event.alertId),
    event as unknown as Record<string, unknown>
  );
}

export interface SimFailoverEvent {
  terminalId: string;
  agentCode: string;
  fromSlot: number;
  toSlot: number;
  reason: string;
  latencyMs: number;
  lossX10: number;
  txRef?: string;
}

export async function publishSimFailover(
  event: SimFailoverEvent
): Promise<boolean> {
  return kafkaPublish(
    TOPICS.SIM_FAILOVER,
    event.terminalId,
    event as unknown as Record<string, unknown>
  );
}
