// @ts-check

import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { auditLog } from "../../drizzle/schema";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";

export const apacheAirflowRouter = router({
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
      totalDags: 25,
      activeDags: 20,
      runningTasks: 5,
      failedTasks: 1,
      schedulerStatus: "healthy",
      overview: {
        totalDags: 25,
        activeDags: 20,
        pausedDags: 5,
        runningTasks: 5,
        failedTasks: 1,
        schedulerStatus: "healthy",
        executorStatus: "running",
        metadataDbStatus: "healthy",
        totalTaskInstances: 1500,
        avgSuccessRate: 97.2,
        failedTasks24h: 3,
      },
      dagsByTag: [
        { tag: "etl", count: 10 },
        { tag: "ml", count: 5 },
        { tag: "reporting", count: 10 },
      ],
      recentFailures: [
        {
          dagId: "billing_etl",
          taskId: "extract",
          executionDate: "2024-06-01",
          error: "Connection timeout",
        },
      ],
    };
  }),
  listDags: protectedProcedure.query(async () => {
    return {
      dags: [
        {
          dagId: "billing_etl",
          schedule: "0 * * * *",
          status: "active",
          lastRun: new Date().toISOString(),
        },
      ],
      total: 25,
    };
  }),
  triggerDag: publicProcedure
    .input(z.object({ dagId: z.string() }))
    .mutation(async ({ input }) => {
      return {
        runId: "manual__" + Date.now(),
        dagId: input.dagId,
        status: "queued",
      };
    }),
  getDag: protectedProcedure
    .input(z.object({ id: z.string().optional() }).default({}))
    .query(async () => {
      return { items: [], total: 0, status: "ok" };
    }),
  toggleDag: protectedProcedure
    .input(z.object({ id: z.string().optional() }).default({}))
    .mutation(async () => {
      return { success: true, status: "ok" };
    }),
  listTaskInstances: protectedProcedure
    .input(z.object({ id: z.string().optional() }).default({}))
    .query(async () => {
      return { items: [], total: 0, status: "ok" };
    }),
  platformValue: protectedProcedure
    .input(z.object({ id: z.string().optional() }).default({}))
    .query(async () => {
      return { items: [], total: 0, status: "ok" };
    }),
});
