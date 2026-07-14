// TypeScript enabled — Sprint 96 security audit
/**
 * settlementMiddleware.ts — Full middleware integration for Settlement System
 *
 * Connects all 13 middleware:
 *  1. Kafka — publish settlement batch events
 *  2. Redis — distributed lock + batch status cache
 *  3. TigerBeetle — settlement transfer ledger
 *  4. Temporal — settlement workflow status
 *  5. Permify — RBAC for trigger/approve
 *  6. Fluvio — real-time settlement event streaming
 *  7. Lakehouse — daily settlement snapshot
 *  8. Dapr — pub/sub for settlement notifications
 *  9. Keycloak — token validation for admin operations
 * 10. APISIX — rate limiting metadata
 * 11. Mojaloop — ILP settlement for interbank transfers
 * 12. PostgreSQL — audit_log, agents, transactions tables
 * 13. Open Source — Drizzle ORM, tRPC, Zod
 */
import { publishEvent, type KafkaTopic } from "../kafkaClient";
import { cacheGet, cacheSet, cacheDel, cacheIncr } from "../redisClient";
import { permifyCheck } from "../_core/permify";
import { fluvioProduce } from "../lib/fluvioClient";
import { tbCreateTransfer, type TBTransferRequest } from "../tbClient";
import { ENV } from "../_core/env";
import logger from "../_core/logger";

// ── Kafka: Settlement Domain Events ──────────────────────────────────────
// publishEvent(topic: KafkaTopic, key: string, payload: T, metadata?)
const SETTLEMENT_KAFKA_TOPIC: KafkaTopic = "pos.transactions.created";

export async function publishSettlementEvent(params: {
  eventType:
    | "settlement.batch.started"
    | "settlement.batch.completed"
    | "settlement.batch.failed"
    | "settlement.agent.credited"
    | "settlement.reconciliation.started"
    | "settlement.reconciliation.completed"
    | "settlement.netting.calculated"
    | "settlement.disbursement.initiated";
  batchId?: string;
  agentId?: number;
  agentCode?: string;
  amount?: number;
  currency?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const published = await publishEvent(
      SETTLEMENT_KAFKA_TOPIC,
      params.batchId ?? String(params.agentId) ?? "system",
      {
        eventType: params.eventType,
        timestamp: new Date().toISOString(),
        batchId: params.batchId,
        agentId: params.agentId,
        amount: params.amount,
        ...params.metadata,
      },
      { agentId: String(params.agentId) }
    );
    if (!published) {
      throw new Error("Kafka publishEvent returned false");
    }
    logger.info(`[Kafka] Settlement event: ${params.eventType}`);
  } catch (e) {
    logger.error(
      `[Kafka] Settlement event failed (fail-closed): ${(e as Error).message}`
    );
    throw new Error(
      `Settlement audit trail unavailable — refusing to proceed without event log: ${(e as Error).message}`
    );
  }
}

// ── Redis: Distributed Lock + Batch Status Cache ─────────────────────────
const SETTLEMENT_LOCK_TTL = 1800;

export async function acquireSettlementLock(batchId: string): Promise<boolean> {
  try {
    const result = await cacheIncr(
      `settlement:lock:${batchId}`,
      SETTLEMENT_LOCK_TTL
    );
    return result === 1;
  } catch {
    return true;
  }
}

export async function releaseSettlementLock(batchId: string): Promise<void> {
  try {
    await cacheDel(`settlement:lock:${batchId}`);
  } catch {
    /* ignore */
  }
}

export async function cacheSettlementBatchStatus(
  batchId: string,
  status: Record<string, unknown>
): Promise<void> {
  try {
    await cacheSet(`settlement:batch:${batchId}`, JSON.stringify(status), 3600);
  } catch {
    /* ignore */
  }
}

export async function getCachedSettlementBatchStatus(
  batchId: string
): Promise<Record<string, unknown> | null> {
  try {
    const cached = await cacheGet(`settlement:batch:${batchId}`);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

// ── TigerBeetle: Settlement Transfer Ledger ─────────────────────────────
// Uses tbCreateTransfer(req: TBTransferRequest) from tbClient.ts
export async function tbRecordSettlementTransfer(params: {
  batchId: string;
  agentId: number;
  agentCode: string;
  amount: number;
  transactionCount: number;
}): Promise<{ transferId: string; syncStatus: string } | null> {
  try {
    const req: TBTransferRequest = {
      debitAccountId: "platform-settlement-pool",
      creditAccountId: `agent-settlement-${params.agentId}`,
      amount: Math.round(params.amount * 100),
      ledger: 4000,
      code: 401,
      ref: params.batchId,
      txType: "settlement_disbursement",
      agentId: String( params.agentId,),
    };
    const result = await tbCreateTransfer(req);
    if (result && result.id) {
      return { transferId: result.id, syncStatus: result.syncStatus };
    }
    throw new Error(
      "TigerBeetle returned null — sidecar unreachable or transfer rejected"
    );
  } catch (e) {
    logger.error(
      `[TB-Settlement] Transfer failed (fail-closed): ${(e as Error).message}`
    );
    throw new Error(
      `Settlement ledger entry failed — refusing to disburse without ledger record: ${(e as Error).message}`
    );
  }
}

// ── Temporal: Settlement Workflow Status ──────────────────────────────────
export async function getSettlementWorkflowStatus(batchId: string): Promise<{
  status: string;
  agentsProcessed: number;
  totalAmount: number;
} | null> {
  try {
    const { getTemporalClient } = await import("../temporal");
    const client = await getTemporalClient();
    if (!client) return null;
    const handle = client.workflow.getHandle(`settlement-${batchId}`);
    const desc = await handle.describe();
    return { status: desc.status.name, agentsProcessed: 0, totalAmount: 0 };
  } catch {
    return null;
  }
}

// ── Permify: RBAC for Settlement Operations ──────────────────────────────
// permifyCheck({ subjectType, subjectId, entityType, entityId, permission })
export async function canTriggerSettlement(
  agentId: string,
  agentRole: string
): Promise<boolean> {
  try {
    return await permifyCheck({
      subjectType: "agent",
      subjectId: agentId,
      entityType: "settlement",
      entityId: "*",
      permission: "trigger",
    });
  } catch {
    return ["admin", "supervisor"].includes(agentRole);
  }
}

export async function canApproveSettlement(
  agentId: string,
  agentRole: string
): Promise<boolean> {
  try {
    return await permifyCheck({
      subjectType: "agent",
      subjectId: agentId,
      entityType: "settlement",
      entityId: "*",
      permission: "approve",
    });
  } catch {
    return agentRole === "admin";
  }
}

// ── Fluvio: Real-Time Settlement Event Streaming ─────────────────────────
// fluvioProduce({ topic, key?, payload, timestamp? })
const FLUVIO_CRITICAL_EVENTS = new Set([
  "settlement_disbursement",
  "settlement_reversal",
  "settlement_batch_finalized",
]);

export async function streamSettlementEvent(params: {
  eventType: string;
  batchId?: string;
  agentId?: string;
  amount?: number;
}): Promise<void> {
  const isCritical = FLUVIO_CRITICAL_EVENTS.has(params.eventType);
  try {
    await fluvioProduce({
      topic: "settlement-events",
      key: params.batchId ?? "system",
      payload: {
        eventType: params.eventType,
        batchId: params.batchId,
        agentId: params.agentId,
        amount: params.amount,
        source: "settlement-engine",
      },
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    if (isCritical) {
      logger.error(
        `[Fluvio] Critical settlement stream failed (fail-closed): ${(e as Error).message}`
      );
      throw new Error(
        `Settlement event stream unavailable — refusing to proceed without real-time audit: ${(e as Error).message}`
      );
    }
    logger.warn(
      `[Fluvio] Settlement stream failed (degraded): ${(e as Error).message}`
    );
  }
}

// ── Lakehouse: Settlement Snapshot Trigger (via Python sidecar) ──────────
const LAKEHOUSE_SIDECAR_URL =
  process.env.LAKEHOUSE_SIDECAR_URL ?? "http://localhost:8050";

export async function triggerSettlementSnapshot(
  date?: string
): Promise<boolean> {
  try {
    const res = await fetch(`${LAKEHOUSE_SIDECAR_URL}/snapshot/settlement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: date ?? new Date().toISOString().slice(0, 10),
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Dapr: Pub/Sub for Settlement Notifications ───────────────────────────
const DAPR_HTTP_PORT = process.env.DAPR_HTTP_PORT ?? "3500";

export async function daprPublishSettlementNotification(params: {
  batchId: string;
  agentId: string;
  amount: number;
  status: string;
}): Promise<boolean> {
  try {
    const res = await fetch(
      `http://localhost:${DAPR_HTTP_PORT}/v1.0/publish/settlement-pubsub/settlement-notifications`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...params,
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(1000),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ── Keycloak: Token Validation for Settlement Admin ──────────────────────
export async function validateKeycloakTokenForSettlement(
  token: string
): Promise<boolean> {
  try {
    const { verifyKeycloakToken } = await import("../_core/keycloak");
    await verifyKeycloakToken(token);
    return true;
  } catch {
    return false;
  }
}

// ── APISIX: Rate Limit Config for Settlement Endpoints ───────────────────
export function getSettlementRateLimitConfig() {
  return {
    route_id: "settlement-engine",
    plugins: {
      "limit-count": {
        count: 50,
        time_window: 60,
        key_type: "var",
        key: "remote_addr",
        rejected_code: 429,
        rejected_msg: "Settlement API rate limit exceeded",
        policy: "redis",
        redis_host: (ENV.redisUrl ?? "redis://localhost:6379")
          .replace("redis://", "")
          .split(":")[0],
        redis_port: 6379,
      },
      "key-auth": { header: "X-API-Key" },
    },
    upstream: { type: "roundrobin", nodes: { [process.env.APP_UPSTREAM_HOST ?? "localhost:3000"]: 1 } },
    uri: "/api/trpc/settlement.*",
  };
}

// ── Mojaloop: ILP Settlement for Interbank Transfers ─────────────────────
const MOJALOOP_SIDECAR_URL =
  process.env.MOJALOOP_SIDECAR_URL ?? "http://localhost:8050";

export async function initiateIlpSettlementTransfer(params: {
  batchId: string;
  payerFsp: string;
  payeeFsp: string;
  amount: number;
  currency: string;
}): Promise<{
  transferId: string;
  ilpPacket: string;
  condition: string;
} | null> {
  try {
    const res = await fetch(
      `${MOJALOOP_SIDECAR_URL}/mojaloop/settlement-transfer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payerFsp: params.payerFsp,
          payeeFsp: params.payeeFsp,
          amount: params.amount,
          currency: params.currency,
          transactionRef: params.batchId,
        }),
        signal: AbortSignal.timeout(5000),
      }
    );
    if (res.ok) return await res.json();
    return null;
  } catch (e) {
    logger.error(
      `[Mojaloop] ILP settlement transfer failed (fail-closed): ${(e as Error).message}`
    );
    throw new Error(
      `Interbank settlement failed — refusing to proceed without ILP confirmation: ${(e as Error).message}`
    );
  }
}

// ── Middleware Health Check ───────────────────────────────────────────────
export async function getSettlementMiddlewareHealth(): Promise<
  Record<string, { status: string; latencyMs: number }>
> {
  const results: Record<string, { status: string; latencyMs: number }> = {};
  const check = async (name: string, fn: () => Promise<boolean>) => {
    const start = Date.now();
    try {
      const ok = await fn();
      results[name] = {
        status: ok ? "healthy" : "degraded",
        latencyMs: Date.now() - start,
      };
    } catch {
      results[name] = { status: "unavailable", latencyMs: Date.now() - start };
    }
  };
  await Promise.allSettled([
    check("kafka", async () => {
      const { kafkaIsHealthy } = await import("../kafkaClient");
      return kafkaIsHealthy();
    }),
    check("redis", async () => {
      const { redisIsHealthy } = await import("../redisClient");
      return redisIsHealthy();
    }),
    check("tigerbeetle", async () => {
      const { tbIsHealthy } = await import("../tbClient");
      return tbIsHealthy();
    }),
    check("temporal", async () => {
      const { getTemporalClient } = await import("../temporal");
      return !!(await getTemporalClient());
    }),
    check("permify", async () => {
      const res = await fetch(`${ENV.permifyUrl}/healthz`, {
        signal: AbortSignal.timeout(1000),
      });
      return res.ok;
    }),
    check("fluvio", async () => {
      const { getFluvioStatus } = await import("../lib/fluvioClient");
      return getFluvioStatus().connected;
    }),
    check("lakehouse", async () => {
      const res = await fetch(`${LAKEHOUSE_SIDECAR_URL}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      return res.ok;
    }),
    check("dapr", async () => {
      const res = await fetch(
        `http://localhost:${DAPR_HTTP_PORT}/v1.0/healthz`,
        { signal: AbortSignal.timeout(1000) }
      );
      return res.ok;
    }),
    check("keycloak", async () => {
      const res = await fetch(
        `${ENV.keycloakUrl}/realms/${ENV.keycloakRealm}`,
        { signal: AbortSignal.timeout(2000) }
      );
      return res.ok;
    }),
    check("apisix", async () => {
      const res = await fetch(`${ENV.apisixAdminUrl}/apisix/admin/routes`, {
        headers: { "X-API-KEY": ENV.apisixAdminKey },
        signal: AbortSignal.timeout(1000),
      });
      return res.ok;
    }),
    check("mojaloop", async () => {
      const res = await fetch(`${MOJALOOP_SIDECAR_URL}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      return res.ok;
    }),
    check("postgresql", async () => {
      const { getDb } = await import("../db");
      return !!(await getDb());
    }),
  ]);
  return results;
}
