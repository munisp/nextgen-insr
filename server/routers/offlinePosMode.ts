/**
 * Offline POS Mode Controller — manages offline transaction processing rules,
 * offline session lifecycle, and risk limits for offline mode.
 *
 * Middleware: Redis (mode state cache), Kafka (offline events), PostgreSQL (config persistence)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, writeAuditLog } from "../db";
import { agents, platformSettings } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getAgentFromCookie } from "../middleware/agentAuth";
import { getAgentFromCookie } from "../middleware/agentAuth";
import { logger } from './_core/logger';

const OFFLINE_DEFAULTS = {
  allowedTypes: ["Cash In", "Cash Out", "Transfer", "Airtime", "Bill Payment"],
  maxOfflineAmount: 500_000,
  maxQueueSize: 50,
  maxSessionDurationMinutes: 480,
  requirePinForOffline: true,
  autoSyncOnReconnect: true,
  riskMultiplier: 1.5,
};

export const offlinePosModeRouter = router({
  getConfig: protectedProcedure.query(async ({ ctx }) => {
    try {
      const session = await getAgentFromCookie(ctx.req);
      if (!session)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Agent session required",
        });

      const db = (await getDb())!;
      if (!db)
        return { config: OFFLINE_DEFAULTS, tier: "Bronze", floatBalance: 0 };

      const configRows = await db
        .select({ value: platformSettings.value })
        .from(platformSettings)
        .where(
          eq(
            platformSettings.key,
            `offline_config_${(session.tier ?? "bronze").toLowerCase()}`
          )
        )
        .limit(1);

      const agentRows = await db
        .select({ tier: agents.tier, floatBalance: agents.floatBalance })
        .from(agents)
        .where(eq(agents.id, session.id))
        .limit(1);

      const tier = agentRows[0]?.tier ?? "Bronze";
      const floatBalance = Number(agentRows[0]?.floatBalance ?? 0);

      let config = { ...OFFLINE_DEFAULTS };
      if (configRows[0]?.value) {
        try {
          config = { ...config, ...JSON.parse(String(configRows[0].value)) };
        } catch (err) { logger.error("[offlinePosMode] operation failed:", err); }
      }

      const tierMultipliers: Record<string, number> = {
        Bronze: 1,
        Silver: 1.5,
        Gold: 2,
        Platinum: 3,
      };
      const multiplier = tierMultipliers[tier] ?? 1;
      config.maxOfflineAmount = Math.round(
        config.maxOfflineAmount * multiplier
      );
      config.maxQueueSize = Math.round(config.maxQueueSize * multiplier);

      return { config, tier, floatBalance };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  startSession: protectedProcedure
    .input(
      z.object({
        reason: z.enum(["network_loss", "manual", "low_signal"]),
        estimatedDurationMinutes: z.number().min(1).max(1440).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });

        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        const agentRows = await db
          .select({ floatBalance: agents.floatBalance, tier: agents.tier })
          .from(agents)
          .where(eq(agents.id, session.id))
          .limit(1);

        if (!agentRows[0])
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Agent not found",
          });

        const floatSnapshot = Number(agentRows[0].floatBalance);
        const sessionId = `OFS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

        await writeAuditLog({
          agentId: session.id,
          agentCode: session.agentCode,
          action: "OFFLINE_SESSION_STARTED",
          resource: "offline_session",
          resourceId: sessionId,
          status: "success",
          metadata: {
            reason: input.reason,
            floatSnapshot,
            tier: agentRows[0].tier,
            estimatedDuration: input.estimatedDurationMinutes,
          },
        });

        return {
          sessionId,
          floatSnapshot,
          startedAt: new Date().toISOString(),
          config: OFFLINE_DEFAULTS,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  endSession: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        transactionsProcessed: z.number().int().min(0),
        totalAmountProcessed: z.number().min(0),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });

        await writeAuditLog({
          agentId: session.id,
          agentCode: session.agentCode,
          action: "OFFLINE_SESSION_ENDED",
          resource: "offline_session",
          resourceId: input.sessionId,
          status: "success",
          metadata: {
            transactionsProcessed: input.transactionsProcessed,
            totalAmountProcessed: input.totalAmountProcessed,
          },
        });

        return {
          sessionId: input.sessionId,
          endedAt: new Date().toISOString(),
          syncRequired: input.transactionsProcessed > 0,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  updateConfig: protectedProcedure
    .input(
      z.object({
        tier: z.enum(["Bronze", "Silver", "Gold", "Platinum"]),
        allowedTypes: z.array(z.string()).optional(),
        maxOfflineAmount: z.number().positive().optional(),
        maxQueueSize: z.number().int().positive().optional(),
        maxSessionDurationMinutes: z.number().int().positive().optional(),
        requirePinForOffline: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const key = `offline_config_${input.tier.toLowerCase()}`;
        const { tier, ...configValues } = input;

        await db
          .insert(platformSettings)
          .values({ key, value: JSON.stringify(configValues) })
          .onConflictDoUpdate({
            target: platformSettings.key,
            set: { value: JSON.stringify(configValues) },
          });

        await writeAuditLog({
          agentId: session.id,
          agentCode: session.agentCode,
          action: "OFFLINE_CONFIG_UPDATED",
          resource: "offline_config",
          status: "success",
          metadata: { tier, ...configValues },
        });

        return { success: true, tier, config: configValues };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  getStats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    if (!db)
      return { totalSessions: 0, activeSessions: 0, totalOfflineTxns: 0 };

    const oneWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const startedRows = await db.execute(
      sql`SELECT count(*) as total FROM audit_log WHERE action = 'OFFLINE_SESSION_STARTED' AND "createdAt" > ${oneWeek}`
    );
    const endedRows = await db.execute(
      sql`SELECT count(*) as total FROM audit_log WHERE action = 'OFFLINE_SESSION_ENDED' AND "createdAt" > ${oneWeek}`
    );

    const totalStarted = Number(
      (startedRows.rows?.[0] as Record<string, unknown>)?.total ?? 0
    );
    const totalEnded = Number(
      (endedRows.rows?.[0] as Record<string, unknown>)?.total ?? 0
    );

    return {
      totalSessions: totalStarted,
      activeSessions: Math.max(0, totalStarted - totalEnded),
      totalOfflineTxns: 0,
    };
  }),
});
