import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";
import { z } from "zod";

import { auditLog } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

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
  // F-12 (wave-4b): was a zero-payload stub — no carrier/network telemetry
  // source exists in the schema. Fail loud, never fixture zeros.
  getAlerts: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getAlerts: no carrier telemetry source is delivered on this platform",
    });
  }),
  // F-12 (wave-4b): was a zero-payload stub — no carrier/network telemetry
  // source exists in the schema. Fail loud, never fixture zeros.
  getCarrierHeatmap: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getCarrierHeatmap: no carrier telemetry source is delivered on this platform",
    });
  }),
  // F-12 (wave-4b): was a zero-payload stub — no carrier/network telemetry
  // source exists in the schema. Fail loud, never fixture zeros.
  getCarrierSummary: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getCarrierSummary: no carrier telemetry source is delivered on this platform",
    });
  }),
  // F-12 (wave-4b): was a zero-payload stub — no carrier/network telemetry
  // source exists in the schema. Fail loud, never fixture zeros.
  getOverview: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getOverview: no carrier telemetry source is delivered on this platform",
    });
  }),
  // F-12 (wave-4b): was a zero-payload stub — no carrier/network telemetry
  // source exists in the schema. Fail loud, never fixture zeros.
  getRegions: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getRegions: no carrier telemetry source is delivered on this platform",
    });
  }),
  // F-12 (wave-4b): was a zero-payload stub — no carrier/network telemetry
  // source exists in the schema. Fail loud, never fixture zeros.
  getTimeSeries: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getTimeSeries: no carrier telemetry source is delivered on this platform",
    });
  }),
  // F-12 (wave-4b): facade mutation (returned success without persisting —
  // no alert store exists). Fail loud instead of a fake success.
  resolveAlert: protectedProcedure
    .input(z.object({ alertId: z.string(), resolution: z.string().optional() }))
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "resolveAlert: no carrier alert store is delivered on this platform",
      });
    }),
});
