/**
 * Offline POS Mode Controller — manages offline transaction processing rules,
 * offline session lifecycle, and risk limits for offline mode.
 *
 * Middleware: Redis (mode state cache), Kafka (offline events), PostgreSQL (config persistence)
 */
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  agents,
  offlineSessions,
  offlineSyncConflicts,
  offlineSyncRecords,
  platformSettings,
} from "../../drizzle/schema";
import crypto from "crypto";
import { logger } from '../_core/logger';
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, writeAuditLog } from "../db";
import { getAgentFromCookie } from "../middleware/agentAuth";

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
        return { config: OFFLINE_DEFAULTS, tier: "Bronze", premiumReserve: 0 };

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
        .select({ tier: agents.tier, premiumReserve: agents.premiumReserve })
        .from(agents)
        .where(eq(agents.id, session.id))
        .limit(1);

      const tier = agentRows[0]?.tier ?? "Bronze";
      const premiumReserve = Number(agentRows[0]?.premiumReserve ?? 0);

      let config = { ...OFFLINE_DEFAULTS };
      if (configRows[0]?.value) {
        try {
          config = { ...config, ...JSON.parse(String(configRows[0].value)) };
        } catch (err) { logger.error("[offlinePosMode] operation failed:: " + String(err)); }
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

      return { config, tier, premiumReserve };
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
          .select({ premiumReserve: agents.premiumReserve, tier: agents.tier })
          .from(agents)
          .where(eq(agents.id, session.id))
          .limit(1);

        if (!agentRows[0])
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Agent not found",
          });

        const floatSnapshot = Number(agentRows[0].premiumReserve);
        const sessionId = `OFS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

        // NG-16: server-side session ledger — a dropped offline session is
        // now detectable (previously sessions existed only as audit logs).
        await db.insert(offlineSessions).values({
          sessionId,
          agentId: session.id,
          reason: input.reason,
          status: "active",
          floatSnapshot: String(floatSnapshot),
        });

        await writeAuditLog({
          agentId: session.id,
          action: "OFFLINE_SESSION_STARTED",
          resource: "offline_session",
          resourceId: sessionId,
          status: "success",
          metadata: {
            agentCode: session.agentId,
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

        // NG-16: recompute totals SERVER-SIDE from the synced record ledger;
        // client-reported numbers are informational only and any mismatch is
        // flagged on the session row (never silently trusted).
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        const sessRows = await db
          .select()
          .from(offlineSessions)
          .where(eq(offlineSessions.sessionId, input.sessionId))
          .limit(1);
        if (!sessRows[0])
          throw new TRPCError({ code: "NOT_FOUND", message: "offline session not found" });
        if (sessRows[0].agentId !== session.id)
          throw new TRPCError({ code: "FORBIDDEN", message: "session belongs to another agent" });
        if (sessRows[0].status !== "active")
          throw new TRPCError({ code: "CONFLICT", message: `session already ${sessRows[0].status}` });

        const recs = await db
          .select({ amount: offlineSyncRecords.amount, status: offlineSyncRecords.status })
          .from(offlineSyncRecords)
          .where(eq(offlineSyncRecords.sessionId, input.sessionId));
        const serverCount = recs.length;
        const serverAmount = recs.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
        const totalsMismatch =
          input.transactionsProcessed !== serverCount ||
          Math.abs(input.totalAmountProcessed - serverAmount) > 0.005;

        await db
          .update(offlineSessions)
          .set({
            status: "ended",
            endedAt: new Date(),
            clientReportedCount: input.transactionsProcessed,
            clientReportedAmount: String(input.totalAmountProcessed),
            serverCount,
            serverAmount: serverAmount.toFixed(2),
            totalsMismatch,
          })
          .where(eq(offlineSessions.sessionId, input.sessionId));

        await writeAuditLog({
          agentId: session.id,
          action: "OFFLINE_SESSION_ENDED",
          resource: "offline_session",
          resourceId: input.sessionId,
          status: totalsMismatch ? "flagged" : "success",
          metadata: {
            agentCode: session.agentId,
            clientTransactionsProcessed: input.transactionsProcessed,
            clientTotalAmountProcessed: input.totalAmountProcessed,
            serverCount,
            serverAmount,
            totalsMismatch,
          },
        });

        return {
          sessionId: input.sessionId,
          endedAt: new Date().toISOString(),
          syncRequired: serverCount > 0,
          serverCount,
          serverAmount,
          totalsMismatch,
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
          action: "OFFLINE_CONFIG_UPDATED",
          resource: "offline_config",
          status: "success",
          metadata: { agentCode: session.agentId, tier, ...configValues },
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

  // ── NG-16: sync push with real conflict detection ─────────────────────────
  // Idempotent per (sessionId, clientRecordId). Conflicts (same entity synced
  // with a DIFFERENT payload, e.g. the same policy sold offline by two
  // agents) preserve BOTH versions in offline_sync_conflicts for manual
  // resolution — there is no silent server_wins.
  syncPush: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        records: z
          .array(
            z.object({
              clientRecordId: z.string().min(1).max(128),
              entityType: z.string().min(1).max(32),
              entityId: z.string().min(1).max(128),
              amount: z.number().min(0).default(0),
              payload: z.record(z.string(), z.unknown()),
            })
          )
          .min(1)
          .max(200),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const session = await getAgentFromCookie(ctx.req);
      if (!session)
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Agent session required" });

      const db = (await getDb())!;
      if (!db)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const sessRows = await db
        .select()
        .from(offlineSessions)
        .where(eq(offlineSessions.sessionId, input.sessionId))
        .limit(1);
      if (!sessRows[0] || sessRows[0].agentId !== session.id)
        throw new TRPCError({ code: "NOT_FOUND", message: "offline session not found" });

      let applied = 0;
      let duplicates = 0;
      const conflicts: Array<{ entityType: string; entityId: string }> = [];

      for (const rec of input.records) {
        const payloadHash = crypto
          .createHash("sha256")
          .update(JSON.stringify(rec.payload))
          .digest("hex");

        // Idempotent insert: retry of the same clientRecordId dedups.
        const inserted = await db
          .insert(offlineSyncRecords)
          .values({
            sessionId: input.sessionId,
            agentId: session.id,
            clientRecordId: rec.clientRecordId,
            entityType: rec.entityType,
            entityId: rec.entityId,
            amount: String(rec.amount),
            payload: rec.payload,
            payloadHash,
            status: "applied",
          })
          .onConflictDoNothing()
          .returning({ id: offlineSyncRecords.id });
        if (inserted.length === 0) {
          duplicates++;
          continue;
        }

        // Conflict detection: another record (any session/agent) already
        // exists for the same entity with a DIFFERENT payload.
        const existing = await db
          .select()
          .from(offlineSyncRecords)
          .where(eq(offlineSyncRecords.entityType, rec.entityType))
          .limit(200);
        const clash = existing.find(
          (r) =>
            r.entityId === rec.entityId &&
            r.payloadHash !== payloadHash &&
            !(r.sessionId === input.sessionId && r.clientRecordId === rec.clientRecordId)
        );
        if (clash) {
          await db
            .update(offlineSyncRecords)
            .set({ status: "conflict" })
            .where(eq(offlineSyncRecords.id, inserted[0].id));
          await db.insert(offlineSyncConflicts).values({
            entityType: rec.entityType,
            entityId: rec.entityId,
            sessionId: input.sessionId,
            agentId: session.id,
            localVersion: rec.payload,
            serverVersion: clash.payload as Record<string, unknown>,
          });
          conflicts.push({ entityType: rec.entityType, entityId: rec.entityId });
          continue;
        }
        applied++;
      }

      await writeAuditLog({
        agentId: session.id,
        action: "OFFLINE_SYNC_PUSH",
        resource: "offline_session",
        resourceId: input.sessionId,
        status: conflicts.length > 0 ? "conflict" : "success",
        metadata: { applied, duplicates, conflicts: conflicts.length },
      });

      return { applied, duplicates, conflicts };
    }),

  // Pending conflict queue (both versions preserved).
  listConflicts: protectedProcedure.query(async ({ ctx }) => {
    const session = await getAgentFromCookie(ctx.req);
    if (!session)
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Agent session required" });
    const db = (await getDb())!;
    if (!db) return { conflicts: [] };
    const rows = await db
      .select()
      .from(offlineSyncConflicts)
      .where(sql`${offlineSyncConflicts.resolution} IS NULL`)
      .limit(200);
    return { conflicts: rows };
  }),

  // Resolve a conflict explicitly; both versions remain stored.
  resolveConflict: protectedProcedure
    .input(
      z.object({
        conflictId: z.number().int().positive(),
        resolution: z.enum(["keep_local", "keep_server", "merged"]),
        mergedVersion: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const session = await getAgentFromCookie(ctx.req);
      if (!session)
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Agent session required" });
      if (input.resolution === "merged" && !input.mergedVersion)
        throw new TRPCError({ code: "BAD_REQUEST", message: "mergedVersion required for merged resolution" });
      const db = (await getDb())!;
      if (!db)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const updated = await db
        .update(offlineSyncConflicts)
        .set({
          resolution: input.resolution,
          resolvedBy: String(session.id),
          resolvedAt: new Date(),
        })
        .where(sql`${offlineSyncConflicts.id} = ${input.conflictId} AND ${offlineSyncConflicts.resolution} IS NULL`)
        .returning({ id: offlineSyncConflicts.id });
      if (updated.length === 0)
        throw new TRPCError({ code: "CONFLICT", message: "conflict not found or already resolved" });
      await writeAuditLog({
        agentId: session.id,
        action: "OFFLINE_CONFLICT_RESOLVED",
        resource: "offline_sync_conflict",
        resourceId: String(input.conflictId),
        status: "success",
        metadata: { resolution: input.resolution },
      });
      return { conflictId: input.conflictId, resolution: input.resolution };
    }),
});
