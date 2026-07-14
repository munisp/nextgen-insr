// @ts-check
/**
 * sidecarBridge.ts — Unified client for Rust, Go, and Python sidecars.
 *
 * Provides typed wrappers for all sidecar endpoints with graceful fallback
 * when sidecars are unreachable (logs warning, returns safe defaults).
 *
 * Ports (configurable via env):
 *   Rust  → RUST_BRIDGE_URL  (default http://localhost:9100)
 *   Go    → GO_LEDGER_URL    (default http://localhost:9200)
 *   Python → PYTHON_ML_URL   (default http://localhost:9300)
 */
import { logger } from "../_core/logger";

const RUST_URL = process.env.RUST_BRIDGE_URL ?? "http://localhost:9100";
const GO_URL = process.env.GO_LEDGER_URL ?? "http://localhost:9200";
const PYTHON_URL = process.env.PYTHON_ML_URL ?? "http://localhost:9300";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function sidecarPost<T>(
  baseUrl: string,
  path: string,
  body: unknown,
  fallback: T
): Promise<T> {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { service: "sidecar", baseUrl, path, error: message },
      `[sidecarBridge] ${baseUrl}${path} unreachable: ${message}`
    );
    return fallback;
  }
}

async function sidecarGet<T>(
  baseUrl: string,
  path: string,
  fallback: T
): Promise<T> {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { service: "sidecar", baseUrl, path, error: message },
      `[sidecarBridge] ${baseUrl}${path} unreachable: ${message}`
    );
    return fallback;
  }
}

// ── Rust Sidecar (Kafka, Redis, Event Bus, Sanitization) ─────────────────

export const rustBridge = {
  /** Publish event to Kafka topic */
  kafkaPublish: (topic: string, key: string, payload: unknown) =>
    sidecarPost(
      RUST_URL,
      "/kafka/publish",
      { topic, key, payload },
      { status: "fallback" }
    ),

  /** Cache get */
  cacheGet: (key: string) =>
    sidecarGet(RUST_URL, `/cache/get?key=${encodeURIComponent(key)}`, null),

  /** Cache set */
  cacheSet: (key: string, value: unknown, ttlSec?: number) =>
    sidecarPost(
      RUST_URL,
      "/cache/set",
      { key, value, ttl_seconds: ttlSec ?? 300 },
      { status: "fallback" }
    ),

  /** Rate limit check */
  rateLimit: (key: string, maxRequests: number, windowSec: number) =>
    sidecarPost(
      RUST_URL,
      "/rate-limit/check",
      { key, max_requests: maxRequests, window_seconds: windowSec },
      { allowed: true, remaining: maxRequests }
    ),

  /** Input sanitization */
  sanitize: (input: string, context: string = "html") =>
    sidecarPost(
      RUST_URL,
      "/sanitize",
      { input, context },
      { safe: true, sanitized: input, threats: [] }
    ),

  /** Audit log */
  auditLog: (
    userId: string,
    action: string,
    resource: string,
    details?: unknown
  ) =>
    sidecarPost(
      RUST_URL,
      "/audit/log",
      { user_id: userId, action, resource, details },
      { status: "fallback" }
    ),

  /** Webhook signature verification */
  verifyWebhook: (payload: string, signature: string, secret: string) =>
    sidecarPost(
      RUST_URL,
      "/webhook/verify",
      { payload, signature, secret },
      { valid: false }
    ),

  /** Health check */
  health: () => sidecarGet(RUST_URL, "/health", { status: "unreachable" }),

  /** Stats */
  stats: () => sidecarGet(RUST_URL, "/stats", {}),
};

// ── Go Sidecar (Ledger, Settlement, Reconciliation) ──────────────────────

export const goLedger = {
  /** Create a double-entry transfer */
  transfer: (
    debitAccountId: string,
    creditAccountId: string,
    amount: number,
    currency = "NGN",
    metadata?: unknown
  ) =>
    sidecarPost(
      GO_URL,
      "/transfer",
      {
        debit_account_id: debitAccountId,
        credit_account_id: creditAccountId,
        amount,
        currency,
        metadata,
      },
      { status: "fallback" }
    ),

  /** Batch transfers */
  batchTransfer: (
    entries: Array<{
      debit_account_id: string;
      credit_account_id: string;
      amount: number;
      currency?: string;
    }>
  ) =>
    sidecarPost(GO_URL, "/transfer/batch", entries, {
      status: "fallback",
      count: 0,
    }),

  /** Get account balance */
  balance: (accountId: string) =>
    sidecarGet(GO_URL, `/balance?account_id=${encodeURIComponent(accountId)}`, {
      account_id: accountId,
      balance: 0,
      exists: false,
    }),

  /** Get all balances */
  allBalances: () =>
    sidecarGet(GO_URL, "/balances", { accounts: [], count: 0 }),

  /** Create settlement batch */
  settle: () =>
    sidecarPost(GO_URL, "/settlement/create", {}, { status: "fallback" }),

  /** Run reconciliation */
  reconcile: () =>
    sidecarPost(GO_URL, "/reconcile", {}, { status: "fallback" }),

  /** Transaction lifecycle transition */
  lifecycleTransition: (
    transactionId: string,
    newState: string,
    reason: string
  ) =>
    sidecarPost(
      GO_URL,
      "/lifecycle",
      { transaction_id: transactionId, new_state: newState, reason },
      { status: "fallback" }
    ),

  /** Get transaction lifecycle */
  lifecycleGet: (transactionId: string) =>
    sidecarGet(
      GO_URL,
      `/lifecycle?transaction_id=${encodeURIComponent(transactionId)}`,
      null
    ),

  /** Aggregated health check (all services) */
  healthAggregate: () =>
    sidecarGet(GO_URL, "/health/aggregate", {
      overall: "unknown",
      services: [],
    }),

  /** Signature verification */
  verifySignature: (payload: string, signature: string, secret: string) =>
    sidecarPost(
      GO_URL,
      "/signature/verify",
      { payload, signature, secret },
      { valid: false }
    ),

  /** Health */
  health: () => sidecarGet(GO_URL, "/health", { status: "unreachable" }),

  /** Stats */
  stats: () => sidecarGet(GO_URL, "/stats", {}),
};

// ── Python Sidecar (ML, Compliance, Sentiment, Fraud) ────────────────────

export const pythonML = {
  /** Detect anomalies in a transaction */
  detectAnomaly: (transaction: {
    id?: string;
    amount: number;
    agent_id: string;
    type?: string;
  }) =>
    sidecarPost(PYTHON_URL, "/anomaly/detect", transaction, {
      is_anomalous: false,
      anomaly_score: 0,
      risk_level: "low",
      anomalies: [],
    }),

  /** Batch anomaly detection */
  batchAnomaly: (transactions: unknown[]) =>
    sidecarPost(
      PYTHON_URL,
      "/anomaly/batch",
      { transactions },
      { results: [], count: 0, anomalous_count: 0 }
    ),

  /** Compliance check (AML, KYC, sanctions) */
  complianceCheck: (entity: {
    name: string;
    type?: string;
    country?: string;
    amount?: number;
  }) =>
    sidecarPost(PYTHON_URL, "/compliance/check", entity, {
      compliant: true,
      risk_score: 0,
      flags: [],
    }),

  /** Batch compliance */
  batchCompliance: (entities: unknown[]) =>
    sidecarPost(
      PYTHON_URL,
      "/compliance/batch",
      { entities },
      { results: [], count: 0, non_compliant: 0 }
    ),

  /** Sentiment analysis */
  analyzeSentiment: (text: string) =>
    sidecarPost(
      PYTHON_URL,
      "/sentiment/analyze",
      { text },
      { sentiment: "neutral", confidence: 0.5 }
    ),

  /** Batch sentiment */
  batchSentiment: (texts: string[]) =>
    sidecarPost(
      PYTHON_URL,
      "/sentiment/batch",
      { texts },
      { results: [], count: 0 }
    ),

  /** Fraud risk scoring */
  scoreFraud: (transaction: {
    id?: string;
    amount: number;
    agent_id: string;
    device_id?: string;
    ip_address?: string;
    recipient?: string;
  }) =>
    sidecarPost(PYTHON_URL, "/fraud/score", transaction, {
      fraud_score: 0,
      risk_level: "low",
      action: "allow",
      factors: [],
    }),

  /** Batch fraud scoring */
  batchFraud: (transactions: unknown[]) =>
    sidecarPost(
      PYTHON_URL,
      "/fraud/batch",
      { transactions },
      { results: [], count: 0 }
    ),

  /** Get anomaly history */
  anomalyHistory: (limit = 50) =>
    sidecarGet(PYTHON_URL, `/anomalies?limit=${limit}`, {
      anomalies: [],
      total: 0,
    }),

  /** Health */
  health: () => sidecarGet(PYTHON_URL, "/health", { status: "unreachable" }),

  /** Stats */
  stats: () => sidecarGet(PYTHON_URL, "/stats", {}),
};

// ── Convenience: Emit event to all relevant sidecars ─────────────────────

export async function emitTransactionEvent(
  event: string,
  data: {
    transactionId: string;
    amount: number;
    agentId: string;
    debitAccount: string;
    creditAccount: string;
    currency?: string;
    userId?: string;
    metadata?: unknown;
  }
) {
  const [kafkaResult, ledgerResult, anomalyResult, fraudResult] =
    await Promise.allSettled([
      // 1. Publish to Kafka (Rust)
      rustBridge.kafkaPublish(`pos.transactions.${event}`, data.agentId, {
        event,
        ...data,
        timestamp: Date.now(),
      }),
      // 2. Record in ledger (Go)
      goLedger.transfer(
        data.debitAccount,
        data.creditAccount,
        data.amount,
        data.currency ?? "NGN",
        data.metadata
      ),
      // 3. Anomaly detection (Python)
      pythonML.detectAnomaly({
        id: data.transactionId,
        amount: data.amount,
        agent_id: data.agentId,
        type: event,
      }),
      // 4. Fraud scoring (Python)
      pythonML.scoreFraud({
        id: data.transactionId,
        amount: data.amount,
        agent_id: data.agentId,
      }),
    ]);

  return {
    kafka: kafkaResult.status === "fulfilled" ? kafkaResult.value : null,
    ledger: ledgerResult.status === "fulfilled" ? ledgerResult.value : null,
    anomaly: anomalyResult.status === "fulfilled" ? anomalyResult.value : null,
    fraud: fraudResult.status === "fulfilled" ? fraudResult.value : null,
  };
}

/** Audit + cache helper for read-heavy procedures */
export async function auditAndCache(
  userId: string,
  action: string,
  resource: string,
  cacheKey?: string,
  cacheTtl = 300
) {
  const results = await Promise.allSettled([
    rustBridge.auditLog(userId, action, resource),
    cacheKey ? rustBridge.cacheGet(cacheKey) : Promise.resolve(null),
  ]);
  return {
    auditLogged: results[0].status === "fulfilled",
    cachedValue: results[1].status === "fulfilled" ? results[1].value : null,
  };
}

/** Full compliance pipeline for onboarding */
export async function runCompliancePipeline(entity: {
  name: string;
  type?: string;
  country?: string;
  amount?: number;
}) {
  const [compliance, anomaly] = await Promise.allSettled([
    pythonML.complianceCheck(entity),
    pythonML.detectAnomaly({
      amount: entity.amount ?? 0,
      agent_id: entity.name,
      type: "onboarding",
    }),
  ]);
  return {
    compliance: compliance.status === "fulfilled" ? compliance.value : null,
    anomaly: anomaly.status === "fulfilled" ? anomaly.value : null,
  };
}
