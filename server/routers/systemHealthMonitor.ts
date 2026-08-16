import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";
import { z } from "zod";

import { auditLog } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

export const systemHealthMonitorRouter = router({
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
  apiLatency: protectedProcedure.query(async () => {
    return {
      endpoints: [] as Array<{
        path: string;
        avgMs: number;
        p95Ms: number;
        p99Ms: number;
      }>,
      overallAvgMs: 0,
    };
  }),
  errorTracking: protectedProcedure.query(async () => {
    return {
      errors: [] as Array<{
        type: string;
        message: string;
        count: number;
        lastSeen: string;
      }>,
      totalErrors: 0,
    };
  }),
  overview: protectedProcedure.query(async () => {
    return {
      cpu: 0,
      memory: 0,
      disk: 0,
      uptime: 0,
      activeConnections: 0,
      requestsPerMin: 0,
    };
  }),
  securityEvents: protectedProcedure.query(async () => {
    return {
      events: [] as Array<{
        id: string;
        type: string;
        severity: string;
        source: string;
        timestamp: string;
      }>,
      total: 0,
    };
  }),
  transactionVolume: protectedProcedure.query(async () => {
    return {
      current: 0,
      hourly: [] as Array<{ hour: string; count: number; amount: number }>,
      daily: [] as Array<{ date: string; count: number; amount: number }>,
    };
  }),
  userActivity: protectedProcedure.query(async () => {
    return {
      activeUsers: 0,
      sessions: 0,
      avgSessionDurationMin: 0,
      topPages: [] as Array<{ page: string; views: number }>,
    };
  }),
});
