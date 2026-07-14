import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { auditLog } from "@schema";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";

export const aiMonitoringRouter = router({
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
  dashboard: protectedProcedure.query(async () => {
    return {
      modelCount: 0,
      activeModels: 0,
      totalPredictions: 0,
      avgLatencyMs: 0,
      driftAlerts: 0,
      fraudDetected: 0,
    };
  }),
  liveFraudFeed: protectedProcedure.query(async () => {
    return {
      events: [] as Array<{
        id: string;
        timestamp: string;
        score: number;
        type: string;
        agentId: string;
      }>,
      total: 0,
    };
  }),
  driftAnalysis: protectedProcedure.query(async () => {
    return {
      models: [] as Array<{
        name: string;
        driftScore: number;
        status: string;
        lastChecked: string;
      }>,
    };
  }),
  alerts: protectedProcedure.query(async () => {
    return {
      items: [] as Array<{
        id: string;
        severity: string;
        message: string;
        timestamp: string;
        acknowledged: boolean;
      }>,
      total: 0,
    };
  }),
  serviceHealth: protectedProcedure.query(async () => {
    return {
      services: [] as Array<{
        name: string;
        status: string;
        latencyMs: number;
        uptime: number;
      }>,
    };
  }),
  throughputTimeSeries: protectedProcedure.query(async () => {
    return {
      data: [] as Array<{
        timestamp: string;
        requests: number;
        latencyMs: number;
      }>,
    };
  }),
  acknowledgeAlert: protectedProcedure
    .input(z.object({ alertId: z.string() }))
    .mutation(async ({ input }) => {
      return { success: true, alertId: input.alertId };
    }),
});
