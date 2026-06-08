// TypeScript enabled — Sprint 96 security audit
// SECURITY: SQL template literals in this file are for display/mock purposes only. All actual DB queries use parameterized Drizzle ORM.
/**
 * InsurePortal Fluvio Client
 * Connects to Fluvio via its HTTP gateway (no native SDK required).
 * Used for real-time fraud stream processing.
 *
 * Architecture:
 *   Kafka tx.created → Fluvio SmartModule (velocity + anomaly check) → fraud.alert topic
 *   Node.js consumer → DB insert + push notification
 */
import logger from "./_core/logger";

// Default: local Fluvio HTTP gateway (docker-compose.production.yml fluvio-http-gateway service on port 9090)
const FLUVIO_HTTP_URL = process.env.FLUVIO_HTTP_URL ?? "http://localhost:9090";
const FLUVIO_TOPIC_FRAUD = "fraud.alert";
const FLUVIO_TOPIC_TX = "tx.created";

interface FluvioRecord {
  key?: string;
  value: string;
}

/**
 * Produce a record to a Fluvio topic via HTTP gateway.
 */
export async function fluvioProduce(
  topic: string,
  record: FluvioRecord
): Promise<void> {
  try {
    const res = await fetch(`${FLUVIO_HTTP_URL}/produce/${topic}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) {
      logger.warn(`[Fluvio] Produce to ${topic} failed: ${res.status}`);
    }
  } catch (err) {
    logger.warn(
      { err },
      `[Fluvio] Produce to ${topic} unavailable — event dropped`
    );
  }
}

/**
 * Publish a transaction event to the Fluvio tx.created topic.
 * The Fluvio SmartModule will apply velocity and anomaly checks.
 */
export async function publishTxToFluvio(tx: {
  txRef: string;
  agentCode: string;
  amount: number;
  type: string;
  customerPhone?: string;
  timestamp: number;
}): Promise<void> {
  await fluvioProduce(FLUVIO_TOPIC_TX, {
    key: tx.agentCode,
    value: JSON.stringify(tx),
  });
}

/**
 * Publish a fraud alert to the Fluvio fraud.alert topic.
 */
export async function publishFraudAlert(alert: {
  txRef: string;
  agentCode: string;
  severity: string;
  reason: string;
  amount: number;
}): Promise<void> {
  await fluvioProduce(FLUVIO_TOPIC_FRAUD, {
    key: alert.agentCode,
    value: JSON.stringify({ ...alert, timestamp: Date.now() }),
  });
}

/**
 * Publish a workflow event (used by the Go workflow orchestrator bridge).
 */
export async function publishWorkflowEvent(event: {
  workflowId: string;
  type: string;
  payload: object;
}): Promise<void> {
  await fluvioProduce("workflow.events", {
    key: event.workflowId,
    value: JSON.stringify(event),
  });
}

export default { publishTxToFluvio, publishFraudAlert, publishWorkflowEvent };
