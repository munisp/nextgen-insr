import { TRPCError } from "@trpc/server";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";
import { z } from "zod";

import { fraudAlerts } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";


// MOCKWARE FIX: generateReport/getReport returned fabricated report ids and
// "completed" statuses with empty data. generateReport now builds a real
// report synchronously from the fraud_alerts table; getReport fails loudly
// because generated reports are not persisted; quickStats reads real counts.

export const fraudReportGeneratorRouter = router({
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
  generateReport: protectedProcedure
    .input(
      z.object({
        startDate: z.string(),
        endDate: z.string(),
        type: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const start = new Date(input.startDate);
      const end = new Date(input.endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid startDate/endDate" });
      }
      // Real on-demand report generated synchronously from fraud_alerts.
      const alerts = await database
        .select()
        .from(fraudAlerts)
        .where(
          and(
            gte(fraudAlerts.createdAt, start),
            lte(fraudAlerts.createdAt, end)
          )
        )
        .orderBy(desc(fraudAlerts.createdAt))
        .limit(500);
      const bySeverity: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      for (const a of alerts) {
        bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1;
        byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
      }
      return {
        reportId: `fraud-report-${input.startDate}_${input.endDate}`,
        status: "completed" as const,
        generatedAt: new Date().toISOString(),
        data: {
          period: { startDate: input.startDate, endDate: input.endDate },
          type: input.type ?? "fraud_alerts",
          totalAlerts: alerts.length,
          bySeverity,
          byStatus,
          alerts,
        },
      };
    }),
  getReport: protectedProcedure
    .input(z.object({ reportId: z.string() }))
    .query(async ({ input }) => {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Report ${input.reportId} not found: generated reports are not persisted — call generateReport to build a report on demand`,
      });
    }),
  listReports: protectedProcedure.query(async () => {
    // Reports are generated on demand and not persisted — honest empty.
    return {
      reports: [] as Array<{
        id: string;
        name: string;
        status: string;
        createdAt: string;
      }>,
      total: 0,
    };
  }),
  quickStats: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) {
      return {
        totalCases: 0,
        openCases: 0,
        resolvedToday: 0,
        avgResolutionTimeHours: 0,
        totalLossPrevented: 0,
      };
    }
    const [total] = await database
      .select({ value: count() })
      .from(fraudAlerts);
    const [open] = await database
      .select({ value: count() })
      .from(fraudAlerts)
      .where(eq(fraudAlerts.status, "open"));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [resolvedToday] = await database
      .select({ value: count() })
      .from(fraudAlerts)
      .where(
        and(
          eq(fraudAlerts.status, "resolved"),
          gte(fraudAlerts.resolvedAt, today)
        )
      );
    return {
      totalCases: Number(total.value),
      openCases: Number(open.value),
      resolvedToday: Number(resolvedToday.value),
      avgResolutionTimeHours: 0, // not tracked
      totalLossPrevented: 0, // not tracked
    };
  }),
});
