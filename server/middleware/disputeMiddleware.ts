// TypeScript enabled — Sprint 96 security audit
/**
 * disputeMiddleware.ts — Full middleware integration for Dispute/Refund System
 *
 * Connects all 13 middleware:
 *  1. Kafka — publish dispute domain events
 *  2. Redis — dispute status cache + rate limiting
 *  3. TigerBeetle — refund reversal ledger
 *  4. Temporal — dispute resolution workflow
 *  5. Permify — RBAC for approve/process
 *  6. Fluvio — real-time dispute event streaming for fraud correlation
 *  7. Lakehouse — daily dispute snapshot
 *  8. Dapr — state store for dispute workflow state
 *  9. Keycloak — token validation for dispute operations
 * 10. APISIX — rate limiting metadata
 * 11. Mojaloop — ILP refund settlement
 * 12. PostgreSQL — disputes, refunds, transactions tables
 * 13. Open Source — Drizzle ORM, tRPC, Zod
 */
import { ENV } from "../_core/env";
import logger from "../_core/logger";
import { permifyCheck } from "../_core/permify";
import { publishEvent, type KafkaTopic } from "../kafkaClient";
import { fluvioProduce } from "../lib/fluvioClient";
import { cacheGet, cacheSet, cacheDel, cacheIncr } from "../redisClient";
import { tbCreateTransfer, type TBTransferRequest } from "../tbClient";

// ── Kafka: Dispute Domain Events ─────────────────────────────────────────
// publishEvent(topic: KafkaTopic, key: string, payload: T, metadata?)
const DISPUTE_KAFKA_TOPIC: KafkaTopic = "54link.disputes.opened";

export async function publishDisputeEvent(params: {
  eventType:
    | "dispute.raised"
    | "dispute.escalated"
    | "dispute.resolved"
    | "dispute.rejected"
    | "refund.requested"
    | "refund.approved"
    | "refund.processed"
    | "refund.rejected";
  disputeId?: number;
  refundId?: number;
  agentId?: number | string; // numeric FK or string agent code
  amount?: number;
  transactionRef?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const topic: KafkaTopic = params.eventType.startsWith("dispute.")
      ? "54link.disputes.opened"
      : "54link.disputes.resolved";
    await publishEvent(
      topic,
      (params.agentId != null ? String(params.agentId) : undefined) ?? params.transactionRef ?? "system",
      {
        eventType: params.eventType,
        timestamp: new Date().toISOString(),
        disputeId: params.disputeId,
        refundId: params.refundId,
        agentId: params.agentId,
        amount: params.amount,
        transactionRef: params.transactionRef,
        ...params.metadata,
      },
      { agentId: params.agentId != null ? String(params.agentId) : undefined }
    );
    logger.info(`[Kafka] Dispute event: ${params.eventType}`);
  } catch (e) {
    logger.warn(
      `[Kafka] Dispute event failed (fail-open): ${(e as Error).message}`
    );
  }
}

// ── Redis: Dispute Status Cache + Rate Limiting ──────────────────────────
export async function cacheDisputeStatus(
  disputeId: number,
  status: string
): Promise<void> {
  try {
    await cacheSet(`dispute:status:${disputeId}`, status, 600);
  } catch {
    /* ignore */
  }
}

export async function getCachedDisputeStatus(
  disputeId: number
): Promise<string | null> {
  try {
    return await cacheGet(`dispute:status:${disputeId}`);
  } catch {
    return null;
  }
}

export async function checkDisputeRateLimit(
  agentId: number
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const key = `dispute:ratelimit:${agentId}:${new Date().toISOString().slice(0, 13)}`;
    const count = await cacheIncr(key, 3600);
    const limit = 10;
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  } catch {
    return { allowed: true, remaining: 10 };
  }
}

// ── TigerBeetle: Refund Reversal Ledger ─────────────────────────────────
// Uses tbCreateTransfer(req: TBTransferRequest) from tbClient.ts
export async function tbRecordRefundReversal(params: {
  refundId: number;
  transactionRef: string;
  agentId: string;
  amount: number;
}): Promise<{ transferId: string; syncStatus: string } | null> {
  try {
    const req: TBTransferRequest = {
      debitAccountId: `agent-float-${params.agentId}`,
      creditAccountId: "platform-refund-pool",
      amount: Math.round(params.amount * 100), // kobo
      ledger: 5000,
      code: 501,
      ref: `REF-${params.transactionRef}`,
      txType: "refund_reversal",
      agentId: params.agentId,
    };
    const result = await tbCreateTransfer(req);
    if (result && result.id) {
      return { transferId: result.id, syncStatus: result.syncStatus };
    }
    return null;
  } catch (e) {
    logger.warn(
      `[TB-Refund] Transfer failed (fail-open): ${(e as Error).message}`
    );
    return null;
  }
}

// ── Temporal: Dispute Resolution Workflow ─────────────────────────────────
export async function triggerDisputeResolutionWorkflow(params: {
  disputeId: number;
  transactionRef: string;
  agentId: string;
  amount: number;
  reason: string;
  slaHours: number;
}): Promise<string | null> {
  try {
    const { getTemporalClient } = await import("../temporal");
    const client = await getTemporalClient();
    if (!client) return null;
    const handle = await client.workflow.start("DisputeResolutionWorkflow", {
      taskQueue: ENV.temporalTaskQueue,
      workflowId: `dispute-${params.disputeId}`,
      args: [params],
    });
    logger.info(
      `[Temporal] Dispute resolution workflow started: ${handle.workflowId}`
    );
    return handle.workflowId;
  } catch (e) {
    logger.warn(
      `[Temporal] Dispute workflow failed (fail-open): ${(e as Error).message}`
    );
    return null;
  }
}

// ── Permify: RBAC for Dispute Operations ─────────────────────────────────
// permifyCheck({ subjectType, subjectId, entityType, entityId, permission })
export async function canApproveDispute(
  agentId: string,
  agentRole: string
): Promise<boolean> {
  try {
    return await permifyCheck({
      subjectType: "agent",
      subjectId: agentId,
      entityType: "dispute",
      entityId: "*",
      permission: "approve",
    });
  } catch {
    return ["admin", "supervisor"].includes(agentRole);
  }
}

export async function canProcessRefund(
  agentId: string,
  agentRole: string
): Promise<boolean> {
  try {
    return await permifyCheck({
      subjectType: "agent",
      subjectId: agentId,
      entityType: "refund",
      entityId: "*",
      permission: "process",
    });
  } catch {
    return agentRole === "admin";
  }
}

// ── Fluvio: Dispute Event Streaming for Fraud Correlation ────────────────
// fluvioProduce({ topic, key?, payload, timestamp? })
export async function streamDisputeEvent(params: {
  eventType: string;
  disputeId?: number;
  agentId?: string;
  amount?: number;
  transactionRef?: string;
}): Promise<void> {
  try {
    await fluvioProduce({
      topic: "dispute-events",
      key: params.agentId ?? "system",
      payload: {
        eventType: params.eventType,
        disputeId: params.disputeId,
        agentId: params.agentId,
        amount: params.amount,
        transactionRef: params.transactionRef,
        source: "dispute-engine",
      },
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    logger.debug(
      `[Fluvio] Dispute stream failed (fail-open): ${(e as Error).message}`
    );
  }
}

// ── Lakehouse: Dispute Snapshot Trigger (via Python sidecar) ─────────────
const LAKEHOUSE_SIDECAR_URL =
  process.env.LAKEHOUSE_SIDECAR_URL ?? "http://localhost:8050";

export async function triggerDisputeSnapshot(date?: string): Promise<boolean> {
  try {
    const res = await fetch(`${LAKEHOUSE_SIDECAR_URL}/snapshot/dispute`, {
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

// ── Dapr: State Store for Dispute Workflow State ─────────────────────────
const DAPR_HTTP_PORT = process.env.DAPR_HTTP_PORT ?? "3500";

export async function daprGetDisputeState(
  disputeId: number
): Promise<unknown | null> {
  try {
    const res = await fetch(
      `http://localhost:${DAPR_HTTP_PORT}/v1.0/state/dispute-store/dispute-${disputeId}`,
      {
        signal: AbortSignal.timeout(1000),
      }
    );
    if (res.ok) return await res.json();
    return null;
  } catch {
    return null;
  }
}

export async function daprSetDisputeState(
  disputeId: number,
  state: unknown
): Promise<boolean> {
  try {
    const res = await fetch(
      `http://localhost:${DAPR_HTTP_PORT}/v1.0/state/dispute-store`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ key: `dispute-${disputeId}`, value: state }]),
        signal: AbortSignal.timeout(1000),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ── Keycloak: Token Validation for Dispute Operations ────────────────────
export async function validateKeycloakTokenForDispute(
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

// ── APISIX: Rate Limit Config for Dispute Endpoints ──────────────────────
export function getDisputeRateLimitConfig() {
  return {
    route_id: "dispute-engine",
    plugins: {
      "limit-count": {
        count: 30,
        time_window: 60,
        key_type: "var",
        key: "remote_addr",
        rejected_code: 429,
        rejected_msg: "Dispute API rate limit exceeded",
        policy: "redis",
        redis_host: (ENV.redisUrl ?? "redis://localhost:6379")
          .replace("redis://", "")
          .split(":")[0],
        redis_port: 6379,
      },
      "key-auth": { header: "X-API-Key" },
    },
    upstream: { type: "roundrobin", nodes: { [process.env.APP_UPSTREAM_HOST ?? "localhost:3000"]: 1 } },
    uri: "/api/trpc/disputeRefund.*",
  };
}

// ── Mojaloop: ILP Refund Settlement ──────────────────────────────────────
const MOJALOOP_SIDECAR_URL =
  process.env.MOJALOOP_SIDECAR_URL ?? "http://localhost:8050";

export async function initiateIlpRefundTransfer(params: {
  refundId: number;
  originalTransferRef: string;
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
      `${MOJALOOP_SIDECAR_URL}/mojaloop/refund-transfer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refundId: params.refundId,
          originalTransferRef: params.originalTransferRef,
          payerFsp: params.payerFsp,
          payeeFsp: params.payeeFsp,
          amount: params.amount,
          currency: params.currency,
        }),
        signal: AbortSignal.timeout(5000),
      }
    );
    if (res.ok) return await res.json();
    return null;
  } catch {
    logger.warn("[Mojaloop] ILP refund transfer failed (fail-open)");
    return null;
  }
}

// ── Middleware Health Check ───────────────────────────────────────────────
export async function getDisputeMiddlewareHealth(): Promise<
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
