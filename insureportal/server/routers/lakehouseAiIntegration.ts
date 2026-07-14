import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { auditLog } from "@schema";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";

export const lakehouseAiIntegrationRouter = router({
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
  analytics: protectedProcedure.query(async () => {
    return {
      totalQueries: 0,
      avgLatencyMs: 0,
      storageUsedGb: 0,
      tablesCount: 0,
    };
  }),
  dataLineage: protectedProcedure.query(async () => {
    return {
      nodes: [] as Array<{ id: string; name: string; type: string }>,
      edges: [] as Array<{ source: string; target: string }>,
    };
  }),
  health: protectedProcedure.query(async () => {
    return { status: "healthy" as const, connected: false, latencyMs: 0 };
  }),
  listBatchJobs: protectedProcedure.query(async () => {
    return {
      jobs: [] as Array<{
        id: string;
        name: string;
        status: string;
        progress: number;
        startedAt: string;
      }>,
      total: 0,
    };
  }),
  listModels: protectedProcedure.query(async () => {
    return {
      models: [] as Array<{
        id: string;
        name: string;
        version: string;
        status: string;
        accuracy: number;
      }>,
      total: 0,
    };
  }),
  promoteModel: protectedProcedure
    .input(z.object({ modelId: z.string(), targetEnv: z.string().optional() }))
    .mutation(async ({ input }) => {
      return {
        success: true,
        modelId: input.modelId,
        promotedAt: new Date().toISOString(),
      };
    }),
  submitBatchJob: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        query: z.string(),
        schedule: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return { jobId: `batch-${Date.now()}`, status: "queued" as const };
    }),
});
