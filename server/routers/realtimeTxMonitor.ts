// @ts-check

import { TRPCError } from "@trpc/server";
/**
 * F01: Real-Time Transaction Monitoring Dashboard
 * Live tx feed, amount heatmap, velocity alerts, geographic distribution
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  transactions,
  txMonitoringAlerts,
  agents,
  fraudAlerts,
} from "../../drizzle/schema";
import { eq, desc, sql, and, gte, lte, count, sum, avg } from "drizzle-orm";

const VELOCITY_THRESHOLD_TPS = 50;
const AMOUNT_THRESHOLD_NGN = 5_000_000;

export const realtimeTxMonitorRouter = router({
  // Live transaction feed with real-time data
  liveFeed: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        channel: z.string().optional(),
        status: z.string().optional(),
        minAmount: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { items: [], total: 0 };
        const conditions = [];
        if (input.channel)
          conditions.push(eq(transactions.customerPhone, input.channel));
        if (input.status)
          conditions.push(eq(transactions.status, input.status as any));
        if (input.minAmount)
          conditions.push(
            sql`${transactions.amount}::numeric >= ${input.minAmount}`
          );
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const items = await db
          .select()
          .from(transactions)
          .where(where)
          .orderBy(desc(transactions.createdAt))
          .limit(input.limit);
        const [{ total }] = await db
          .select({ total: count() })
          .from(transactions)
          .where(where)
          .limit(100);
        return { items, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Transaction volume metrics (TPS, hourly, daily)
  volumeMetrics: protectedProcedure
    .input(
      z.object({ period: z.enum(["1h", "6h", "24h", "7d"]).default("24h") })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          return {
            tps: 0,
            hourly: [],
            daily: [],
            totalVolume: "0",
            totalCount: 0,
            avgAmount: "0",
          };
        const periodMap = { "1h": 1, "6h": 6, "24h": 24, "7d": 168 };
        const hours = periodMap[input.period];
        const since = new Date(Date.now() - hours * 3600000);
        const [stats] = await db
          .select({
            totalCount: count(),
            totalVolume: sum(transactions.amount),
            avgAmount: avg(transactions.amount),
          })
          .from(transactions)
          .where(gte(transactions.createdAt, since));
        const tps = (stats.totalCount || 0) / (hours * 3600);
        return {
          tps: Math.round(tps * 100) / 100,
          totalVolume: stats.totalVolume || "0",
          totalCount: stats.totalCount || 0,
          avgAmount: stats.avgAmount || "0",
          hourly: [],
          daily: [],
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

  // Amount heatmap — distribution by type and channel
  amountHeatmap: protectedProcedure
    .input(z.object({ period: z.enum(["24h", "7d", "30d"]).default("7d") }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { heatmap: [] };
        const periodHours = { "24h": 24, "7d": 168, "30d": 720 };
        const since = new Date(
          Date.now() - periodHours[input.period] * 3600000
        );
        const data = await db
          .select({
            type: transactions.type,
            channel: transactions.channel,
            totalAmount: sum(transactions.amount),
            txCount: count(),
          })
          .from(transactions)
          .where(gte(transactions.createdAt, since))
          .groupBy(transactions.type, transactions.channel);
        return { heatmap: data };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Velocity alerts — detect unusual transaction patterns
  velocityAlerts: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        resolved: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { items: [], total: 0 };
        const conditions = [];
        if (input.resolved !== undefined)
          conditions.push(eq(txMonitoringAlerts.resolved, input.resolved));
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const items = await db
          .select()
          .from(txMonitoringAlerts)
          .where(where)
          .orderBy(desc(txMonitoringAlerts.createdAt))
          .limit(input.limit)
          .offset((input.page - 1) * input.limit);
        const [{ total }] = await db
          .select({ total: count() })
          .from(txMonitoringAlerts)
          .where(where)
          .limit(100);
        return { items, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Resolve a velocity alert
  resolveAlert: protectedProcedure
    .input(z.object({ alertId: z.number(), resolution: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        await db
          .update(txMonitoringAlerts)
          .set({
            resolved: true,
            resolvedBy: ctx.user?.id,
            resolvedAt: new Date(),
          })
          .where(eq(txMonitoringAlerts.id, input.alertId));
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

  // Geographic distribution of transactions
  geoDistribution: protectedProcedure
    .input(z.object({ period: z.enum(["24h", "7d", "30d"]).default("7d") }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { regions: [] };
        const periodHours = { "24h": 24, "7d": 168, "30d": 720 };
        const since = new Date(
          Date.now() - periodHours[input.period] * 3600000
        );
        const data = await db
          .select({
            location: agents.location,
            txCount: count(),
            totalAmount: sum(transactions.amount),
          })
          .from(transactions)
          .innerJoin(agents, eq(transactions.agentId, agents.id))
          .where(gte(transactions.createdAt, since))
          .groupBy(agents.location);
        return { regions: data };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Dashboard summary KPIs
  dashboardKpis: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    if (!db)
      return {
        totalTxToday: 0,
        volumeToday: "0",
        activeAlerts: 0,
        avgTps: 0,
        failureRate: 0,
      };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [txStats] = await db
      .select({
        totalTx: count(),
        totalVolume: sum(transactions.amount),
      })
      .from(transactions)
      .where(gte(transactions.createdAt, today));
    const [failedStats] = await db
      .select({ failedCount: count() })
      .from(transactions)
      .where(
        and(
          gte(transactions.createdAt, today),
          eq(transactions.status, "failed")
        )
      );
    const [alertStats] = await db
      .select({ activeAlerts: count() })
      .from(txMonitoringAlerts)
      .where(eq(txMonitoringAlerts.resolved, false));
    const totalTx = txStats.totalTx || 0;
    const failureRate =
      totalTx > 0 ? ((failedStats.failedCount || 0) / totalTx) * 100 : 0;
    return {
      totalTxToday: totalTx,
      volumeToday: txStats.totalVolume || "0",
      activeAlerts: alertStats.activeAlerts || 0,
      avgTps: Math.round((totalTx / 86400) * 100) / 100,
      failureRate: Math.round(failureRate * 100) / 100,
    };
  }),
});
