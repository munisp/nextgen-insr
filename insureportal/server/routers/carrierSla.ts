import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  eq,
  desc,
  and,
  sql,
  count,
  sum,
  isNull,
  gte,
  lte,
  or,
  asc,
} from "drizzle-orm";
import { auditLog, systemConfig } from "@schema";
import { TRPCError } from "@trpc/server";

export const carrierSlaRouter = router({
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return { totalCarriers: 0, avgUptime: 0, slaBreaches: 0, activeSlas: 0 };
    const rows = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, "carrier_sla_stats"))
      .limit(1);
    if (rows.length > 0 && rows[0].value)
      return JSON.parse(String(rows[0].value));
    return { totalCarriers: 0, avgUptime: 99.5, slaBreaches: 0, activeSlas: 0 };
  }),
  listCarriers: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { carriers: [], total: 0 };
        const rows = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.key, "carrier_sla_list"))
          .limit(1);
        const carriers =
          rows.length > 0 && rows[0].value
            ? JSON.parse(String(rows[0].value))
            : [];
        return {
          carriers: carriers.slice(0, input?.limit ?? 20),
          total: carriers.length,
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
  updateSla: protectedProcedure
    .input(
      z.object({
        carrierId: z.string(),
        uptimeTarget: z.number().min(90).max(100),
        responseTimeMs: z.number(),
        maxDowntimeMinutes: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.insert(auditLog).values({
          action: "carrier_sla_updated",
          resource: "carrier_sla",
          resourceId: input.carrierId,
          status: "success",
          metadata: {
            uptimeTarget: input.uptimeTarget,
            responseTimeMs: input.responseTimeMs,
            maxDowntimeMinutes: input.maxDowntimeMinutes,
          },
        });
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  reportBreach: protectedProcedure
    .input(
      z.object({
        carrierId: z.string(),
        breachType: z.string(),
        description: z.string(),
        downtimeMinutes: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.insert(auditLog).values({
          action: "sla_breach_reported",
          resource: "carrier_sla",
          resourceId: input.carrierId,
          status: "warning",
          metadata: {
            breachType: input.breachType,
            description: input.description,
            downtimeMinutes: input.downtimeMinutes,
          },
        });
        return {
          success: true,
          breachId: "SLA-" + crypto.randomUUID().toUpperCase(),
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
});
