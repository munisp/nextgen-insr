import { TRPCError } from "@trpc/server";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";
import { z } from "zod";

import { fraudAlerts } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";


const notImplemented = () =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: "Real-time fraud visualisation is not implemented yet",
  });

export const fraudRealtimeVizRouter = router({
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
          .from(fraudAlerts)
          .orderBy(desc(fraudAlerts.id))
          .limit(input.limit)
          .offset(input.offset);

        const _totalRows = await database
          .select({ total: count() })
          .from(fraudAlerts);
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
        .from(fraudAlerts)
        .where(eq(fraudAlerts.id, input.id))
        .limit(1);

      if (!record) {
        throw new Error(`Record with id ${input.id} not found`);
      }
      return record;
    }),

  getSummary: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
    const _totalRows = await database
      .select({ total: count() })
      .from(fraudAlerts);
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
        .from(fraudAlerts)
        .orderBy(desc(fraudAlerts.id))
        .limit(input.limit);

      return results;
    }),

  dashboard: protectedProcedure.query(async () => {
    throw notImplemented();
  }),

  getStats: protectedProcedure.query(async () => {
    throw notImplemented();
  }),

  liveMap: protectedProcedure.query(async (): Promise<{ summary: { totalAlerts: number; critical: number; avgResponseTimeMs: number }; markers: Array<Record<string, unknown>> }> => {
      throw notImplemented();
    }),

  suspiciousStream: protectedProcedure.query(async (): Promise<{ items: Array<Record<string, unknown>> }> => {
      throw notImplemented();
    }),

  agentHeatmap: protectedProcedure.query(async (): Promise<{ zones: Array<Record<string, unknown>> }> => {
      throw notImplemented();
    }),
});
