import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { auditLog } from "@schema";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";

export const networkStatusDashboardRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const database = await getDb();
        if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
        const results = await database
          .select()
          .from(auditLog)
          .orderBy(desc(auditLog.id))
          .limit(input.limit)
          .offset(input.offset);

        const _totalRows = await database
          .select({ total: count() })
          .from(auditLog);
        const totalResult = Array.isArray(_totalRows)
          ? _totalRows[0]
          : _totalRows;

        return {
          data: results,
          total: totalResult?.total ?? 0,
          limit: input.limit,
          offset: input.offset,
        };
      } catch {
        return { data: [], total: 0, limit: 0, offset: 0 };
      }
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
      const [record] = await database
        .select()
        .from(auditLog)
        .where(eq(auditLog.id, input.id))
        .limit(1);

      if (!record) {
        throw new Error(`Record with id ${input.id} not found`);
      }
      return record;
    }),

  getSummary: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
    const _totalRows = await database.select({ total: count() }).from(auditLog);
    const totalResult = Array.isArray(_totalRows) ? _totalRows[0] : _totalRows;

    return {
      totalRecords: totalResult?.total ?? 0,
      lastUpdated: new Date().toISOString(),
    };
  }),

  getRecent: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(7),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
      const since = new Date();
      since.setDate(since.getDate() - input.days);

      const results = await database
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.id))
        .limit(input.limit);

      return results;
    }),
  getAlerts: protectedProcedure.query(async () => {
    return {
      alerts: [] as Array<{
        id: string;
        severity: string;
        message: string;
        carrier: string;
        timestamp: string;
        resolved: boolean;
      }>,
      total: 0,
    };
  }),
  getCarrierHeatmap: protectedProcedure.query(async () => {
    return {
      data: [] as Array<{
        carrier: string;
        region: string;
        quality: number;
        latency: number;
      }>,
    };
  }),
  getCarrierSummary: protectedProcedure.query(async () => {
    return {
      carriers: [] as Array<{
        name: string;
        status: string;
        uptime: number;
        avgLatency: number;
        failRate: number;
      }>,
    };
  }),
  getOverview: protectedProcedure.query(async () => {
    return {
      totalCarriers: 0,
      healthyCarriers: 0,
      degradedCarriers: 0,
      downCarriers: 0,
      avgLatency: 0,
    };
  }),
  getRegions: protectedProcedure.query(async () => {
    return {
      regions: [] as Array<{
        name: string;
        status: string;
        carrierCount: number;
        avgQuality: number;
      }>,
    };
  }),
  getTimeSeries: protectedProcedure.query(async () => {
    return {
      data: [] as Array<{
        timestamp: string;
        latency: number;
        throughput: number;
        errorRate: number;
      }>,
    };
  }),
  resolveAlert: protectedProcedure
    .input(z.object({ alertId: z.string(), resolution: z.string().optional() }))
    .mutation(async ({ input }) => {
      return { success: true, alertId: input.alertId };
    }),
});
