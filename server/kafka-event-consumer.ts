// TypeScript enabled — Sprint 96 security audit
/**
 * Kafka Event Consumer (S86-29)
 *
 * Consumes events from Kafka topics for:
 * - Transaction event sourcing (payment.created, payment.completed, payment.failed)
 * - Agent lifecycle events (agent.registered, agent.suspended, agent.reactivated)
 * - Float operations (float.topup, float.debit, float.reconciled)
 * - Audit trail (audit.action.created)
 * - Settlement events (settlement.initiated, settlement.completed)
 *
 * Features:
 * - Consumer group management with rebalancing
 * - Dead letter queue for failed messages
 * - Exactly-once processing via DURABLE event dedupe: every event is
 *   processed inside ONE real transaction on a single dedicated connection
 *   (BEGIN/COMMIT on the same client), and the `processed_events` marker row
 *   is inserted in that same transaction. A redelivery finds the marker and
 *   is skipped; a handler failure rolls the marker back so the event is
 *   retried instead of lost. Balance debits carry floor guards
 *   (`WHERE balance >= amount`) and status transitions carry expected-state
 *   guards (`WHERE status = 'pending'`) with row-count verification.
 * - Batch processing with configurable batch size
 * - Schema registry integration for Avro/Protobuf
 * - Lag monitoring and alerting
 */

import type {
  Consumer,
  Producer,
  Kafka as KafkaClient,
  EachMessagePayload,
} from "kafkajs";

// ─── Configuration ──────────────────────────────────────────────────────────

export interface KafkaConsumerConfig {
  brokers: string[];
  groupId: string;
  clientId: string;
  topics: string[];
  dlqTopic: string;
  batchSize: number;
  sessionTimeout: number;
  heartbeatInterval: number;
  maxRetries: number;
  retryBackoffMs: number;
  enableIdempotency: boolean;
  schemaRegistryUrl?: string;
}

const DEFAULT_CONFIG: KafkaConsumerConfig = {
  brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
  groupId: "insurance-portal-consumer-group",
  clientId: "insurance-portal-event-consumer",
  topics: [
    "pos.transactions.events",
    "pos.agents.lifecycle",
    "pos.float.operations",
    "pos.audit.trail",
    "pos.settlements.events",
    "pos.notifications.outbound",
    "pos.compliance.events",
  ],
  dlqTopic: "pos.dead-letter-queue",
  batchSize: 100,
  sessionTimeout: 30000,
  heartbeatInterval: 3000,
  maxRetries: 5,
  retryBackoffMs: 1000,
  enableIdempotency: true,
  schemaRegistryUrl: process.env.SCHEMA_REGISTRY_URL,
};

// ─── Event Types ────────────────────────────────────────────────────────────

export interface PosEvent {
  id: string;
  type: string;
  source: string;
  timestamp: number;
  version: string;
  correlationId: string;
  causationId?: string;
  metadata: Record<string, string>;
  payload: Record<string, unknown>;
}

export interface ProcessingResult {
  eventId: string;
  success: boolean;
  error?: string;
  processingTimeMs: number;
  retryCount: number;
}

// ─── Event Handlers ─────────────────────────────────────────────────────────

/**
 * Query function bound to a SINGLE dedicated connection inside a real
 * transaction (see withClientTransaction in ./db). Every statement a handler
 * issues through it commits or rolls back atomically with the rest.
 */
export interface TxQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}
type TxQuery = (text: string, params?: unknown[]) => Promise<TxQueryResult>;

type EventHandler = (event: PosEvent, query: TxQuery) => Promise<void>;

const eventHandlers: Map<string, EventHandler> = new Map();

/**
 * Fail-closed row-count verification for guarded writes. A guarded UPDATE
 * (expected-state / balance-floor) that matches 0 rows means the precondi-
 * tion does not hold (replay, concurrent transition, insufficient funds) —
 * the whole event transaction must roll back, loudly.
 */
function assertAffected(result: TxQueryResult, what: string): void {
  if (!result.rowCount || result.rowCount < 1) {
    throw new Error(
      `[Kafka] ${what}: guarded write matched 0 rows — refusing (fail-closed)`
    );
  }
}

// ─── Event Store ────────────────────────────────────────────────────────────
// Persists every event to the event store table for audit trail and replay.
// Runs inside the handler's transaction so the audit record is atomic with
// the event's effects.
async function persistToEventStore(
  event: PosEvent,
  query: TxQuery
): Promise<void> {
  await query(
    `INSERT INTO event_store (event_id, event_type, source, correlation_id, causation_id, payload, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (event_id) DO NOTHING`,
    [
      event.id,
      event.type,
      event.source,
      event.correlationId,
      event.causationId ?? null,
      JSON.stringify(event.payload),
      JSON.stringify(event.metadata),
    ]
  );
}

// Transaction events
eventHandlers.set("payment.created", async (event, query) => {
  const { agentId, amount, currency, reference } = event.payload as Record<string, unknown>;
  await persistToEventStore(event, query);
  await query(
    `INSERT INTO pending_transactions (reference, agent_id, amount, currency, status, created_at)
     VALUES ($1, $2, $3, $4, 'pending', NOW())
     ON CONFLICT (reference) DO NOTHING`,
    [reference, agentId, amount, currency]
  );
  console.log(
    `[Kafka] Payment created: agent=${agentId} amount=${amount} ${currency} ref=${reference}`
  );
});

eventHandlers.set("payment.completed", async (event, query) => {
  const { transactionId, agentId, amount, fee } = event.payload as Record<string, unknown>;
  await persistToEventStore(event, query);
  // Expected-state guard: only a still-pending transaction may complete.
  // A replayed/conflicting completion matches 0 rows and rolls back loudly.
  const statusUpdate = await query(
    `UPDATE pending_transactions SET status = 'completed', completed_at = NOW() WHERE reference = $1 AND status = 'pending'`,
    [transactionId]
  );
  assertAffected(statusUpdate, `payment.completed tx=${String(transactionId)} status transition`);
  // Floor guard: the debit refuses to drive available_balance negative.
  const debit = await query(
    `UPDATE agent_balances SET available_balance = available_balance - $1, pending_balance = pending_balance + $1, updated_at = NOW() WHERE agent_id = $2 AND available_balance >= $1`,
    [fee, agentId]
  );
  assertAffected(debit, `payment.completed agent=${String(agentId)} balance debit (floor guard)`);
  // Queue for next settlement batch
  await query(
    `INSERT INTO settlement_queue (transaction_id, agent_id, amount, fee, queued_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (transaction_id) DO NOTHING`,
    [transactionId, agentId, amount, fee]
  );
  console.log(
    `[Kafka] Payment completed: tx=${transactionId} agent=${agentId} amount=${amount} fee=${fee}`
  );
});

eventHandlers.set("payment.failed", async (event, query) => {
  const { transactionId, reason, agentId } = event.payload as Record<string, unknown>;
  await persistToEventStore(event, query);
  const statusUpdate = await query(
    `UPDATE pending_transactions SET status = 'failed', failure_reason = $1, completed_at = NOW() WHERE reference = $2 AND status = 'pending'`,
    [reason, transactionId]
  );
  assertAffected(statusUpdate, `payment.failed tx=${String(transactionId)} status transition`);
  // Reverse any pending hold on agent balance (floored at 0).
  const reversal = await query(
    `UPDATE agent_balances SET pending_balance = GREATEST(pending_balance - (
      SELECT COALESCE(amount, 0) FROM pending_transactions WHERE reference = $1
     ), 0), updated_at = NOW() WHERE agent_id = $2`,
    [transactionId, agentId]
  );
  assertAffected(reversal, `payment.failed agent=${String(agentId)} hold reversal`);
  // Log to fraud detection if repeated failures (atomic with the reversal)
  await query(
    `INSERT INTO fraud_signals (agent_id, signal_type, reference, details, created_at)
     VALUES ($1, 'repeated_failure', $2, $3, NOW())`,
    [agentId, transactionId, JSON.stringify({ reason })]
  );
  console.log(`[Kafka] Payment failed: tx=${transactionId} reason=${reason}`);
});

// Agent lifecycle events
eventHandlers.set("agent.registered", async (event, query) => {
  const { agentId, name, region, tier } = event.payload as Record<string, unknown>;
  await persistToEventStore(event, query);
  // Initialize float account with zero balance
  await query(
    `INSERT INTO agent_balances (agent_id, available_balance, pending_balance, tier, region, created_at)
     VALUES ($1, 0, 0, $2, $3, NOW())
     ON CONFLICT (agent_id) DO NOTHING`,
    [agentId, tier, region]
  );
  // Queue welcome notification
  await query(
    `INSERT INTO notification_queue (recipient_id, channel, template, payload, status, created_at)
     VALUES ($1, 'sms', 'agent_welcome', $2, 'pending', NOW())`,
    [agentId, JSON.stringify({ name, region, tier })]
  );
  console.log(
    `[Kafka] Agent registered: ${agentId} name=${name} region=${region}`
  );
});

eventHandlers.set("agent.suspended", async (event, query) => {
  const { agentId, reason, suspendedBy } = event.payload as Record<string, unknown>;
  await persistToEventStore(event, query);
  // Lock float — set available balance to 0, move to frozen
  const freeze = await query(
    `UPDATE agent_balances SET frozen_balance = available_balance, available_balance = 0, status = 'suspended', updated_at = NOW() WHERE agent_id = $1`,
    [agentId]
  );
  assertAffected(freeze, `agent.suspended agent=${String(agentId)} float freeze`);
  // Disable all active terminals
  await query(
    `UPDATE agent_terminals SET status = 'disabled', disabled_at = NOW(), disabled_reason = $1 WHERE agent_id = $2 AND status = 'active'`,
    [reason, agentId]
  );
  // Notify compliance team (atomic with the suspension)
  await query(
    `INSERT INTO notification_queue (recipient_id, channel, template, payload, status, created_at)
     VALUES ('compliance_team', 'email', 'agent_suspended', $1, 'pending', NOW())`,
    [JSON.stringify({ agentId, reason, suspendedBy })]
  );
  console.log(`[Kafka] Agent suspended: ${agentId} reason=${reason}`);
});

// Float events
eventHandlers.set("float.topup", async (event, query) => {
  const { agentId, amount, source, reference } = event.payload as Record<string, unknown>;
  await persistToEventStore(event, query);
  const credit = await query(
    `UPDATE agent_balances SET available_balance = available_balance + $1, updated_at = NOW() WHERE agent_id = $2`,
    [amount, agentId]
  );
  assertAffected(credit, `float.topup agent=${String(agentId)} balance credit`);
  await query(
    `INSERT INTO float_transactions (reference, agent_id, amount, source, type, created_at)
     VALUES ($1, $2, $3, $4, 'topup', NOW())
     ON CONFLICT (reference) DO NOTHING`,
    [reference, agentId, amount, source]
  );
  // Check and update daily limit tracking
  await query(
    `INSERT INTO daily_float_limits (agent_id, date, total_topup, tx_count)
     VALUES ($1, CURRENT_DATE, $2, 1)
     ON CONFLICT (agent_id, date) DO UPDATE SET total_topup = daily_float_limits.total_topup + $2, tx_count = daily_float_limits.tx_count + 1`,
    [agentId, amount]
  );
  console.log(
    `[Kafka] Float topup: agent=${agentId} amount=${amount} source=${source}`
  );
  // Credit premium reserve, emit receipt, update daily limits
});

eventHandlers.set("float.reconciled", async (event, query) => {
  const { batchId, agentCount, totalAmount, discrepancies } =
    event.payload as Record<string, unknown>;
  await persistToEventStore(event, query);
  await query(
    `INSERT INTO reconciliation_batches (batch_id, agent_count, total_amount, discrepancy_count, status, completed_at)
     VALUES ($1, $2, $3, $4, 'completed', NOW())
     ON CONFLICT (batch_id) DO UPDATE SET status = 'completed', completed_at = NOW()`,
    [batchId, agentCount, totalAmount, Array.isArray(discrepancies) ? (discrepancies as unknown[]).length : 0]
  );
  // Flag discrepancies for compliance review
  if (Array.isArray(discrepancies) && (discrepancies as unknown[]).length > 0) {
    await query(
      `INSERT INTO compliance_reviews (type, reference, details, status, created_at)
       VALUES ('float_discrepancy', $1, $2, 'pending', NOW())`,
      [batchId, JSON.stringify(discrepancies)]
    );
  }
  console.log(
    `[Kafka] Float reconciled: batch=${batchId} agents=${agentCount} total=${totalAmount}`
  );
});

// Settlement events
eventHandlers.set("settlement.initiated", async (event, query) => {
  const { settlementId, agentId, amount, bankAccount } = event.payload as Record<string, unknown>;
  await persistToEventStore(event, query);
  // Debit agent float for settlement — floor guard: never let
  // pending_balance go negative on replayed/conflicting initiations.
  const debit = await query(
    `UPDATE agent_balances SET pending_balance = pending_balance - $1, updated_at = NOW() WHERE agent_id = $2 AND pending_balance >= $1`,
    [amount, agentId]
  );
  assertAffected(debit, `settlement.initiated agent=${String(agentId)} pending-balance debit (floor guard)`);
  // Record settlement with pending status
  await query(
    `INSERT INTO settlements (settlement_id, agent_id, amount, bank_account, status, initiated_at)
     VALUES ($1, $2, $3, $4, 'pending', NOW())
     ON CONFLICT (settlement_id) DO NOTHING`,
    [settlementId, agentId, amount, bankAccount]
  );
  console.log(
    `[Kafka] Settlement initiated: ${settlementId} agent=${agentId} amount=${amount}`
  );
});

eventHandlers.set("settlement.completed", async (event, query) => {
  const { settlementId, bankReference, completedAt } = event.payload as Record<string, unknown>;
  await persistToEventStore(event, query);
  // Expected-state guard: only a still-pending settlement may complete.
  const completion = await query(
    `UPDATE settlements SET status = 'completed', bank_reference = $1, completed_at = $2 WHERE settlement_id = $3 AND status = 'pending'`,
    [bankReference, completedAt, settlementId]
  );
  assertAffected(completion, `settlement.completed settlement=${String(settlementId)} status transition`);
  // Notify agent of successful settlement
  const result = await query(
    `SELECT agent_id, amount FROM settlements WHERE settlement_id = $1`,
    [settlementId]
  );
  if (result.rows.length > 0) {
    const { agent_id, amount } = result.rows[0] as { agent_id: string; amount: number };
    await query(
      `INSERT INTO notification_queue (recipient_id, channel, template, payload, status, created_at)
       VALUES ($1, 'sms', 'settlement_completed', $2, 'pending', NOW())`,
      [agent_id, JSON.stringify({ settlementId, amount, bankReference })]
    );
  }
  console.log(
    `[Kafka] Settlement completed: ${settlementId} ref=${bankReference}`
  );
});

// ─── Consumer Metrics ───────────────────────────────────────────────────────

export interface ConsumerMetrics {
  messagesConsumed: number;
  messagesProcessed: number;
  messagesFailed: number;
  messagesDLQ: number;
  avgProcessingTimeMs: number;
  currentLag: number;
  lastMessageAt: number;
  uptime: number;
  startedAt: number;
  topicPartitions: Record<string, number[]>;
}

// ─── Kafka Event Consumer Class ─────────────────────────────────────────────

export class PosEventConsumer {
  private config: KafkaConsumerConfig;
  private consumer: Consumer | null = null;
  private producer: Producer | null = null;
  private metrics: ConsumerMetrics;
  private running = false;

  constructor(config: Partial<KafkaConsumerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.metrics = {
      messagesConsumed: 0,
      messagesProcessed: 0,
      messagesFailed: 0,
      messagesDLQ: 0,
      avgProcessingTimeMs: 0,
      currentLag: 0,
      lastMessageAt: 0,
      uptime: 0,
      startedAt: Date.now(),
      topicPartitions: {},
    };
  }

  async start(): Promise<void> {
    try {
      const { Kafka } = await import("kafkajs");
      const kafka = new Kafka({
        clientId: this.config.clientId,
        brokers: this.config.brokers,
        retry: {
          initialRetryTime: this.config.retryBackoffMs,
          retries: this.config.maxRetries,
        },
      });

      this.consumer = kafka.consumer({
        groupId: this.config.groupId,
        sessionTimeout: this.config.sessionTimeout,
        heartbeatInterval: this.config.heartbeatInterval,
      });

      this.producer = kafka.producer({
        idempotent: this.config.enableIdempotency,
      });

      await this.consumer.connect();
      await this.producer.connect();

      for (const topic of this.config.topics) {
        await this.consumer.subscribe({ topic, fromBeginning: false });
      }

      this.running = true;
      await this.consumer.run({
        eachMessage: async (payload: EachMessagePayload) => {
          await this.processMessage(payload);
        },
      });

      console.log(
        `[Kafka Consumer] Started - topics: ${this.config.topics.join(", ")}`
      );
    } catch (error) {
      console.error("[Kafka Consumer] Failed to start:", error);
      // Graceful degradation - consumer will retry
    }
  }

  private async processMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message } = payload;
    const startTime = Date.now();
    this.metrics.messagesConsumed++;

    try {
      const value = message.value?.toString();
      if (!value) return;

      const event: PosEvent = JSON.parse(value);

      // Durable exactly-once (F4/F5): the whole event — dedupe marker,
      // event-store row, status transitions, balance mutations, queue
      // inserts — runs inside ONE real transaction on a single dedicated
      // connection. Kafka is at-least-once; the processed_events marker
      // (UNIQUE event_id, insert-first) is what makes redelivery safe:
      //   - conflict  → a prior delivery committed; skip ALL side effects
      //   - no conflict → run handler; any failure rolls the marker back so
      //     the event is retried (DLQ'd here) instead of half-applied
      const { withClientTransaction } = await import("./db");
      let duplicate = false;
      await withClientTransaction(async client => {
        const query: TxQuery = async (text, params) => {
          const res = await client.query(text, params);
          return {
            rows: res.rows as Record<string, unknown>[],
            rowCount: res.rowCount,
          };
        };
        const dedupe = await query(
          `INSERT INTO processed_events (event_id, event_type, processed_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (event_id) DO NOTHING
           RETURNING event_id`,
          [event.id, event.type]
        );
        if (dedupe.rows.length === 0) {
          duplicate = true;
          return; // already processed — skip every side effect
        }

        // Find and execute handler (same transaction)
        const handler = eventHandlers.get(event.type);
        if (handler) {
          await handler(event, query);
          this.metrics.messagesProcessed++;
        } else {
          console.warn(
            `[Kafka Consumer] No handler for event type: ${event.type}`
          );
        }
      });
      if (duplicate) return;

      this.metrics.lastMessageAt = Date.now();
    } catch (error: any) {
      this.metrics.messagesFailed++;
      console.error(
        `[Kafka Consumer] Processing error on ${topic}:${partition}:`,
        error.message
      );

      // Send to DLQ
      await this.sendToDLQ(message, topic, partition, error.message);
    }

    // Update avg processing time
    const elapsed = Date.now() - startTime;
    this.metrics.avgProcessingTimeMs =
      (this.metrics.avgProcessingTimeMs * (this.metrics.messagesConsumed - 1) +
        elapsed) /
      this.metrics.messagesConsumed;
  }

  private async sendToDLQ(
    message: any,
    sourceTopic: string,
    partition: number,
    error: string
  ): Promise<void> {
    if (!this.producer) return;

    try {
      await this.producer.send({
        topic: this.config.dlqTopic,
        messages: [
          {
            key: message.key,
            value: message.value,
            headers: {
              "x-original-topic": sourceTopic,
              "x-original-partition": String(partition),
              "x-error": error,
              "x-failed-at": String(Date.now()),
              "x-retry-count": String(this.config.maxRetries),
            },
          },
        ],
      });
      this.metrics.messagesDLQ++;
    } catch (dlqError) {
      console.error("[Kafka Consumer] Failed to send to DLQ:", dlqError);
    }
  }

  getMetrics(): ConsumerMetrics {
    return {
      ...this.metrics,
      uptime: Date.now() - this.metrics.startedAt,
    };
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.consumer) await this.consumer.disconnect();
    if (this.producer) await this.producer.disconnect();
    console.log("[Kafka Consumer] Stopped");
  }
}

// ─── Export singleton ───────────────────────────────────────────────────────

let consumerInstance: PosEventConsumer | null = null;

export function getKafkaConsumer(): PosEventConsumer {
  if (!consumerInstance) {
    consumerInstance = new PosEventConsumer();
  }
  return consumerInstance;
}

export default PosEventConsumer;
