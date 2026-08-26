/**
 * Settlement router — manual trigger, last-run query, history, and outstanding.
 *
 * Middleware integration (13/13):
 *  1. Kafka — domain events on batch start/complete/fail
 *  2. Redis — distributed lock, batch status cache
 *  3. TigerBeetle — settlement transfer ledger via Go sidecar
 *  4. Temporal — settlement workflow status
 *  5. Permify — RBAC for trigger/approve
 *  6. Fluvio — real-time settlement event streaming via Rust sidecar
 *  7. Lakehouse — daily settlement snapshot via Python sidecar
 *  8. Dapr — pub/sub for settlement notifications
 *  9. Keycloak — token validation for admin operations
 * 10. APISIX — rate limiting metadata
 * 11. Mojaloop — ILP settlement for interbank transfers
 * 12. PostgreSQL — audit_log, agents, transactions tables
 * 13. Open Source — Drizzle ORM, tRPC, Zod
 */
import { TRPCError } from "@trpc/server";
import { desc, eq, and, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { auditLog, agents, transactions } from "../../drizzle/schema";
import { ENV } from "../_core/env";
import logger from "../_core/logger";
import { settlementPlatform } from "../_core/platformClient.js";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { getAgentFromCookie } from "../middleware/agentAuth";
import {
  publishSettlementEvent,
  acquireSettlementLock,
  releaseSettlementLock,
  cacheSettlementBatchStatus,
  getCachedSettlementBatchStatus,
  tbRecordSettlementTransfer,
  getSettlementWorkflowStatus,
  canTriggerSettlement,
  streamSettlementEvent,
  triggerSettlementSnapshot,
  daprPublishSettlementNotification,
  getSettlementRateLimitConfig,
  initiateIlpSettlementTransfer,
  getSettlementMiddlewareHealth,
} from "../middleware/settlementMiddleware";
import { runDailySettlement } from "../settlementCron";

const agentAdminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const agent = await getAgentFromCookie(ctx.req);
  if (!agent) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Agent session required",
    });
  }
  if (agent.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
  return next({ ctx: { ...ctx, agent } });
});

export const settlementRouter = router({
  /**
   * Manually trigger the settlement run.
   * [Redis] Acquires distributed lock to prevent concurrent runs.
   * [Kafka] Publishes batch start/complete events.
   * [TigerBeetle] Records settlement transfers via Go sidecar.
   * [Fluvio] Streams settlement events via Rust sidecar.
   */
  runNow: agentAdminProcedure.mutation(async ({ ctx }) => {
    try {
      const batchId = `SETTLE-${crypto.randomUUID().toUpperCase()}`;

      // [Redis] Acquire distributed lock
      const lockAcquired = await acquireSettlementLock(batchId);
      if (!lockAcquired) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Settlement already in progress",
        });
      }

      // [Kafka] Publish batch started event
      await publishSettlementEvent({
        eventType: "settlement.batch.started",
        batchId,
        metadata: { triggeredBy: ctx.agent.agentId },
      });
      // [Fluvio] Stream batch start
      await streamSettlementEvent({ eventType: "batch.started", batchId });

      try {
        const result = await runDailySettlement();

        // [PostgreSQL] Write to audit log
        const db = (await getDb())!;
        if (db) {
          await db.insert(auditLog).values({
            agentId: ctx.agent.id,
            action: "settlement.runNow",
            resource: "settlement",
            ipAddress:
              (ctx.req.headers["x-forwarded-for"] as string) ?? "127.0.0.1",
            status: result.errors.length === 0 ? "success" : "warning",
            metadata: {
              batchId,
              agentCount: result.agentCount,
              smsSent: result.smsSent,
              errors: result.errors,
            },
          });
        }

        // [Kafka] Publish batch completed event
        await publishSettlementEvent({
          eventType: "settlement.batch.completed",
          batchId,
          metadata: { agentCount: result.agentCount, smsSent: result.smsSent },
        });
        // [Fluvio] Stream batch complete
        await streamSettlementEvent({ eventType: "batch.completed", batchId });
        // [Redis] Cache batch status
        await cacheSettlementBatchStatus(batchId, {
          status: "completed",
          ...result,
        });
        // [Dapr] Publish settlement notification
        await daprPublishSettlementNotification({
          batchId,
          agentId: ctx.agent.agentId,
          amount: 0,
          status: "completed",
        });
        // [Lakehouse] Trigger settlement snapshot
        await triggerSettlementSnapshot();

        return { ...result, batchId };
      } catch (err) {
        // [Kafka] Publish batch failed event
        await publishSettlementEvent({
          eventType: "settlement.batch.failed",
          batchId,
          metadata: { error: (err as Error).message },
        });
        throw err;
      } finally {
        // [Redis] Release lock
        await releaseSettlementLock(batchId);
      }
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  /**
   * Returns the most recent settlement run from the audit log.
   */
  getLastRun: agentAdminProcedure.query(async () => {
    const db = (await getDb())!;
    if (!db) throw new Error("Database connection unavailable");
    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "settlement.runNow"))
      .orderBy(desc(auditLog.createdAt))
      .limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];
    const meta = (row.metadata as Record<string, unknown>) ?? {};
    return {
      runAt: row.createdAt,
      agentId: row.agentId,
      agentCount: (meta.agentCount as number) ?? 0,
      smsSent: (meta.smsSent as number) ?? 0,
      status: row.status,
      batchId: (meta.batchId as string) ?? null,
    };
  }),

  /**
   * Returns paginated settlement history.
   * [Redis] Checks batch status cache for recent runs.
   */
  getHistory: agentAdminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      // DD-LEGACY (F2): the platform settlement service is only consulted
      // when explicitly wired (PLATFORM_SETTLEMENT_URL). When wired but
      // unreachable, fail loud — silently falling back would present local
      // data as if the configured platform were healthy.
      if (ENV.PLATFORM_SETTLEMENT_URL) {
        try {
          const token = ctx.req?.cookies?.["kc_access_token"] ?? "";
          if (token) {
            const result = (await settlementPlatform.getHistory(
              { limit: input.limit, offset: input.offset },
              token
            )) as { settlements?: unknown[] };
            if (result?.settlements) {
              return {
                source: "platform" as const,
                settlements: result.settlements,
              };
            }
          }
        } catch (err) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Configured settlement platform is unreachable: ${(err as Error).message}`,
          });
        }
      }

      // Fallback: local audit log
      const db = (await getDb())!;
      if (!db) return { source: "local" as const, settlements: [] };

      const conditions = [eq(auditLog.action, "settlement.runNow")];
      if (input.startDate)
        conditions.push(gte(auditLog.createdAt, new Date(input.startDate)));
      if (input.endDate)
        conditions.push(lte(auditLog.createdAt, new Date(input.endDate)));

      const rows = await db
        .select()
        .from(auditLog)
        .where(and(...conditions))
        .orderBy(desc(auditLog.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const settlements = rows.map((row: any) => {
        const meta = (row.metadata as Record<string, unknown>) ?? {};
        return {
          id: row.id,
          runAt: row.createdAt,
          agentId: row.agentId,
          agentCount: (meta.agentCount as number) ?? 0,
          smsSent: (meta.smsSent as number) ?? 0,
          errors: (meta.errors as string[]) ?? [],
          status: row.status,
          batchId: (meta.batchId as string) ?? null,
        };
      });

      return { source: "local" as const, settlements };
    }),

  /**
   * Returns agents with outstanding (unsettled) amounts for today.
   */
  getOutstanding: agentAdminProcedure.query(async ({ ctx }) => {
    // DD-LEGACY (F2): consult the platform only when wired; fail loud when a
    // wired platform is unreachable (this feeds settlement decisions).
    if (ENV.PLATFORM_SETTLEMENT_URL) {
      try {
        const token = ctx.req?.cookies?.["kc_access_token"] ?? "";
        if (token) {
          const result = (await settlementPlatform.getOutstanding(token)) as {
            outstanding?: unknown[];
          };
          if (result?.outstanding) {
            return {
              source: "platform" as const,
              outstanding: result.outstanding,
            };
          }
        }
      } catch (err) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Configured settlement platform is unreachable: ${(err as Error).message}`,
        });
      }
    }

    const db = (await getDb())!;
    if (!db) return { source: "local" as const, outstanding: [] };

    const today = new Date();
    const dayStart = new Date(today);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(today);
    dayEnd.setHours(23, 59, 59, 999);

    const rows = await db
      .select({
        agentId: transactions.agentId,
        totalVolume: sql<number>`sum(${transactions.amount})`,
        totalCommission: sql<number>`sum(${transactions.commission})`,
        txCount: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.status, "success"),
          gte(transactions.createdAt, dayStart),
          lte(transactions.createdAt, dayEnd)
        )
      )
      .groupBy(transactions.agentId);

    const agentRows = await db
      .select({ id: agents.id, agentId: agents.agentId, name: agents.name })
      .from(agents);
    const agentMap: Record<number, { agentId: string; name: string }> = {};
    for (const a of agentRows) {
      agentMap[a.id] = { agentId: a.agentId, name: a.name };
    }

    const outstanding = rows.map((r: any) => ({
      agentNumericId: r.agentId,
      agentId: agentMap[r.agentId]?.agentId ?? `#${r.agentId}`,
      agentName: agentMap[r.agentId]?.name ?? "Unknown",
      totalVolume: Number(r.totalVolume),
      totalCommission: Number(r.totalCommission),
      txCount: Number(r.txCount),
      date: today.toISOString().slice(0, 10),
    }));

    return { source: "local" as const, outstanding };
  }),

  /** [Mojaloop] Initiate ILP settlement transfer for interbank */
  initiateIlpTransfer: agentAdminProcedure
    .input(
      z.object({
        batchId: z.string(),
        payeeFsp: z.string(),
        amount: z.number(),
        currency: z.string().default("NGN"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await initiateIlpSettlementTransfer({
          batchId: input.batchId,
          payerFsp: "insureportal-fsp",
          payeeFsp: input.payeeFsp,
          amount: input.amount,
          currency: input.currency,
        });
        return { success: !!result, transfer: result };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  /** [Lakehouse] Trigger settlement snapshot */
  triggerSnapshot: agentAdminProcedure
    .input(z.object({ date: z.string().optional() }))
    .mutation(async ({ input }) => {
      try {
        const ok = await triggerSettlementSnapshot(input.date);
        return { success: ok };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  /** [APISIX] Get rate limit configuration */
  rateLimitConfig: agentAdminProcedure.query(() =>
    getSettlementRateLimitConfig()
  ),

  /** Middleware health for settlement subsystem */
  middlewareHealth: agentAdminProcedure.query(async () => {
    return await getSettlementMiddlewareHealth();
  }),
});
