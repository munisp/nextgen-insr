// TypeScript enabled — Sprint 96 security audit
/**
 * commissionMiddleware.ts — Full middleware integration for Commission Engine
 *
 * Connects all 13 middleware:
 *  1. Kafka — publish commission domain events
 *  2. Redis — cache split ratios + hierarchy chains
 *  3. TigerBeetle — double-entry commission ledger via Go sidecar
 *  4. Temporal — batch commission payout workflows
 *  5. Permify — RBAC for split ratio updates + payout approvals
 *  6. Fluvio — real-time commission event streaming
 *  7. Lakehouse — daily commission snapshot via Python sidecar
 *  8. Dapr — state store for commission calculation cache
 *  9. Keycloak — token validation for admin operations
 * 10. APISIX — rate limiting metadata for commission endpoints
 * 11. Mojaloop — ILP commission settlement for cross-border agents
 * 12. PostgreSQL — commission_ledger + commission_splits tables
 * 13. Open Source — Drizzle ORM, tRPC, Zod validation
 */
import { publishEvent, type KafkaTopic } from "../kafkaClient";
import { cacheGet, cacheSet, cacheDel } from "../redisClient";
import { permifyCheck } from "../_core/permify";
import { fluvioProduce } from "../lib/fluvioClient";
import { tbCreateTransfer, type TBTransferRequest } from "../tbClient";
import { ENV } from "../_core/env";
import logger from "../_core/logger";

// ── Kafka: Commission Domain Events ──────────────────────────────────────
// KafkaTopic union doesn't include commission topics yet, so we use the
// closest existing topic as carrier and embed the real event type in payload.
const COMMISSION_KAFKA_TOPIC: KafkaTopic = "pos.transactions.created";

export async function publishCommissionEvent(params: {
  eventType:
    | "commission.credited"
    | "commission.cascade.completed"
    | "commission.payout.requested"
    | "commission.split.updated";
  transactionId?: number;
  transactionRef?: string;
  agentId: number | string; // numeric FK or string agent code
  amount: number;
  currency?: string;
  hierarchyLevel?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    // publishEvent(topic, key, payload, metadata) — positional args
    const published = await publishEvent(
      COMMISSION_KAFKA_TOPIC,
      params.agentId,
      {
        eventType: params.eventType,
        timestamp: new Date().toISOString(),
        transactionId: params.transactionId,
        transactionRef: params.transactionRef,
        agentId: params.agentId,
        amount: params.amount,
        currency: params.currency ?? "NGN",
        hierarchyLevel: params.hierarchyLevel,
        ...params.metadata,
      },
      { agentId: params.agentId }
    );
    if (!published) {
      throw new Error("Kafka publishEvent returned false");
    }
    logger.info(
      `[Kafka] Commission event published: ${params.eventType} for agent ${params.agentId}`
    );
  } catch (e) {
    logger.error(
      `[Kafka] Commission event publish failed (fail-closed): ${(e as Error).message}`
    );
    throw new Error(
      `Commission audit trail unavailable — refusing to proceed without event log: ${(e as Error).message}`
    );
  }
}

// ── Redis: Split Ratio + Hierarchy Cache ─────────────────────────────────
const SPLIT_CACHE_TTL = 300;
const HIERARCHY_CACHE_TTL = 600;

export async function getCachedSplitRatios(
  txType: string
): Promise<Record<string, number> | null> {
  try {
    const cached = await cacheGet(`commission:splits:${txType}`);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

export async function setCachedSplitRatios(
  txType: string,
  splits: Record<string, number>
): Promise<void> {
  try {
    await cacheSet(
      `commission:splits:${txType}`,
      JSON.stringify(splits),
      SPLIT_CACHE_TTL
    );
  } catch {
    /* cache write — non-critical, do not block */
  }
}

export async function invalidateSplitCache(txType?: string): Promise<void> {
  try {
    if (txType) {
      await cacheDel(`commission:splits:${txType}`);
    } else {
      const types = [
        "cash_in",
        "cash_out",
        "transfer",
        "bill_payment",
        "airtime",
      ];
      for (const t of types) await cacheDel(`commission:splits:${t}`);
      await cacheDel("commission:splits:all");
    }
  } catch {
    /* cache invalidation — non-critical, do not block */
  }
}

export async function getCachedHierarchyChain(agentId: number): Promise<Array<{
  id: number;
  agentId: string;
  hierarchyRole: string;
  level: number;
}> | null> {
  try {
    const cached = await cacheGet(`commission:hierarchy:${agentId}`);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

export async function setCachedHierarchyChain(
  agentId: number,
  chain: Array<{
    id: number;
    agentId: string;
    hierarchyRole: string;
    level: number;
  }>
): Promise<void> {
  try {
    await cacheSet(
      `commission:hierarchy:${agentId}`,
      JSON.stringify(chain),
      HIERARCHY_CACHE_TTL
    );
  } catch {
    /* cache write — non-critical, do not block */
  }
}

// ── TigerBeetle: Double-Entry Commission Ledger ─────────────────────────
// Uses the existing tbClient.ts which talks to the TB sidecar at ENV.tbSidecarUrl
export async function tbRecordCommissionCredit(params: {
  transactionId: number;
  transactionRef: string;
  agentId: number;
  agentId: string;
  amount: number;
  entryType: "direct" | "hierarchy_split";
  hierarchyLevel: number;
}): Promise<{ transferId: string; syncStatus: string } | null> {
  try {
    const req: TBTransferRequest = {
      debitAccountId: "platform-commission-pool",
      creditAccountId: `agent-commission-${params.agentId}`,
      amount: Math.round(params.amount * 100), // kobo
      ledger: 3000,
      code: params.entryType === "direct" ? 301 : 302,
      ref: params.transactionRef,
      txType: "commission_credit",
      agentId: params.agentId,
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
      `[TB-Commission] Transfer failed (fail-closed): ${(e as Error).message}`
    );
    throw new Error(
      `Commission ledger entry failed — refusing to credit without ledger record: ${(e as Error).message}`
    );
  }
}

// ── Temporal: Commission Payout Workflow ──────────────────────────────────
export async function triggerCommissionPayoutWorkflow(params: {
  batchId: string;
  agentIds: number[];
  period: string;
  initiatedBy: string;
}): Promise<string | null> {
  try {
    const { getTemporalClient } = await import("../temporal");
    const client = await getTemporalClient();
    if (!client) return null;
    const handle = await client.workflow.start("CommissionPayoutWorkflow", {
      taskQueue: ENV.temporalTaskQueue,
      workflowId: `commission-payout-${params.batchId}`,
      args: [params],
    });
    logger.info(
      `[Temporal] Commission payout workflow started: ${handle.workflowId}`
    );
    return handle.workflowId;
  } catch (e) {
    logger.error(
      `[Temporal] Commission payout workflow failed (fail-closed): ${(e as Error).message}`
    );
    throw new Error(
      `Commission payout workflow failed — refusing to disburse without workflow confirmation: ${(e as Error).message}`
    );
  }
}

// ── Permify: RBAC for Commission Operations ──────────────────────────────
// permifyCheck({ subjectType, subjectId, entityType, entityId, permission })
export async function canUpdateSplitRatios(
  agentId: string,
  agentRole: string
): Promise<boolean> {
  try {
    return await permifyCheck({
      subjectType: "agent",
      subjectId: agentId,
      entityType: "commission_config",
      entityId: "split_ratios",
      permission: "edit",
    });
  } catch {
    return ["admin", "super_agent"].includes(agentRole);
  }
}

export async function canApproveCommissionPayout(
  agentId: string,
  agentRole: string
): Promise<boolean> {
  try {
    return await permifyCheck({
      subjectType: "agent",
      subjectId: agentId,
      entityType: "commission_payout",
      entityId: "*",
      permission: "approve",
    });
  } catch {
    return ["admin", "supervisor"].includes(agentRole);
  }
}

// ── Fluvio: Real-Time Commission Event Streaming ─────────────────────────
// fluvioProduce({ topic, key?, payload, timestamp? })
const FLUVIO_CRITICAL_COMMISSION_EVENTS = new Set([
  "commission_credit",
  "commission_clawback",
  "commission_payout",
]);

export async function streamCommissionEvent(params: {
  eventType: string;
  agentId: string;
  amount: number;
  transactionRef?: string;
  hierarchyLevel?: number;
}): Promise<void> {
  const isCritical = FLUVIO_CRITICAL_COMMISSION_EVENTS.has(params.eventType);
  try {
    await fluvioProduce({
      topic: "commission-events",
      key: params.agentId,
      payload: {
        eventType: params.eventType,
        agentId: params.agentId,
        amount: params.amount,
        transactionRef: params.transactionRef,
        hierarchyLevel: params.hierarchyLevel,
        source: "commission-engine",
      },
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    if (isCritical) {
      logger.error(
        `[Fluvio] Critical commission stream failed (fail-closed): ${(e as Error).message}`
      );
      throw new Error(
        `Commission event stream unavailable — refusing to proceed without real-time audit: ${(e as Error).message}`
      );
    }
    logger.warn(
      `[Fluvio] Commission stream failed (degraded): ${(e as Error).message}`
    );
  }
}

// ── Lakehouse: Commission Snapshot Trigger (via Python sidecar) ──────────
const LAKEHOUSE_SIDECAR_URL =
  process.env.LAKEHOUSE_SIDECAR_URL ?? "http://localhost:8050";

export async function triggerCommissionSnapshot(
  date?: string
): Promise<boolean> {
  try {
    const res = await fetch(`${LAKEHOUSE_SIDECAR_URL}/snapshot/commission`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: date ?? new Date().toISOString().slice(0, 10),
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    logger.warn("[Lakehouse] Commission snapshot trigger failed (degraded)");
    return false;
    // Lakehouse is analytics — warn but do not block
  }
}

// ── Dapr: State Store for Commission Calculation Cache ───────────────────
const DAPR_HTTP_PORT = process.env.DAPR_HTTP_PORT ?? "3500";
const DAPR_STATE_STORE = "commission-cache";

export async function daprGetCommissionState(
  key: string
): Promise<unknown | null> {
  try {
    const res = await fetch(
      `http://localhost:${DAPR_HTTP_PORT}/v1.0/state/${DAPR_STATE_STORE}/${key}`,
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

export async function daprSetCommissionState(
  key: string,
  value: unknown
): Promise<boolean> {
  try {
    const res = await fetch(
      `http://localhost:${DAPR_HTTP_PORT}/v1.0/state/${DAPR_STATE_STORE}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ key, value }]),
        signal: AbortSignal.timeout(1000),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ── Keycloak: Token Validation for Commission Admin ──────────────────────
export async function validateKeycloakTokenForCommission(
  token: string
): Promise<{ valid: boolean; roles: string[] }> {
  try {
    const { verifyKeycloakToken } = await import("../_core/keycloak");
    const payload = await verifyKeycloakToken(token);
    const roles = payload?.realm_access?.roles ?? [];
    return { valid: true, roles };
  } catch {
    return { valid: false, roles: [] };
  }
}

// ── APISIX: Rate Limit Config for Commission Endpoints ───────────────────
export function getCommissionRateLimitConfig() {
  return {
    route_id: "commission-engine",
    plugins: {
      "limit-count": {
        count: 100,
        time_window: 60,
        key_type: "var",
        key: "remote_addr",
        rejected_code: 429,
        rejected_msg: "Commission API rate limit exceeded",
        policy: "redis",
        redis_host: (ENV.redisUrl ?? "redis://localhost:6379")
          .replace("redis://", "")
          .split(":")[0],
        redis_port: 6379,
      },
      "key-auth": { header: "X-API-Key" },
    },
    upstream: { type: "roundrobin", nodes: { [process.env.APP_UPSTREAM_HOST ?? "localhost:3000"]: 1 } },
    uri: "/api/trpc/commissionEngine.*",
  };
}

// ── Mojaloop: ILP Commission Settlement for Cross-Border Agents ──────────
const MOJALOOP_SIDECAR_URL =
  process.env.MOJALOOP_SIDECAR_URL ?? "http://localhost:8050";

export async function initiateIlpCommissionTransfer(params: {
  payerFsp: string;
  payeeFsp: string;
  amount: number;
  currency: string;
  agentId: string;
  transactionRef: string;
}): Promise<{
  transferId: string;
  ilpPacket: string;
  condition: string;
} | null> {
  try {
    const res = await fetch(
      `${MOJALOOP_SIDECAR_URL}/mojaloop/commission-transfer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payerFsp: params.payerFsp,
          payeeFsp: params.payeeFsp,
          amount: params.amount,
          currency: params.currency,
          agentId: params.agentId,
          transactionRef: params.transactionRef,
        }),
        signal: AbortSignal.timeout(5000),
      }
    );
    if (res.ok) return await res.json();
    return null;
  } catch (e) {
    logger.error(
      `[Mojaloop] ILP commission transfer failed (fail-closed): ${(e as Error).message}`
    );
    throw new Error(
      `Cross-border commission transfer failed — refusing to proceed without ILP confirmation: ${(e as Error).message}`
    );
  }
}

// ── Middleware Health Check ───────────────────────────────────────────────
export async function getCommissionMiddlewareHealth(): Promise<
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
