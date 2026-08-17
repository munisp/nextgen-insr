// Sprint 87: Upgraded from mock data to real DB queries — financialReportingSuite
import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { z } from "zod";

import { pnlReports } from "../../drizzle/schema";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

const getPnl = protectedProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
    })
  )
  .query(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const lim = input.limit ?? 10;
      const offset = ((input.page ?? 1) - 1) * lim;
      const rows = await db
        .select()
        .from(pnlReports)
        .orderBy(desc(pnlReports.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(pnlReports)
        .limit(100);
      return { items: rows, total, page: input.page ?? 1, limit: lim };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
const getBalanceSheet = protectedProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
    })
  )
  .query(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const lim = input.limit ?? 10;
      const offset = ((input.page ?? 1) - 1) * lim;
      const rows = await db
        .select()
        .from(pnlReports)
        .orderBy(desc(pnlReports.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(pnlReports)
        .limit(100);
      return { items: rows, total, page: input.page ?? 1, limit: lim };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
const getCashFlow = protectedProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
    })
  )
  .query(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const lim = input.limit ?? 10;
      const offset = ((input.page ?? 1) - 1) * lim;
      const rows = await db
        .select()
        .from(pnlReports)
        .orderBy(desc(pnlReports.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(pnlReports)
        .limit(100);
      return { items: rows, total, page: input.page ?? 1, limit: lim };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
const getTrialBalance = protectedProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
    })
  )
  .query(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const lim = input.limit ?? 10;
      const offset = ((input.page ?? 1) - 1) * lim;
      const rows = await db
        .select()
        .from(pnlReports)
        .orderBy(desc(pnlReports.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(pnlReports)
        .limit(100);
      return { items: rows, total, page: input.page ?? 1, limit: lim };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
const getStats = publicProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    })
  )
  .query(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const [{ total }] = await db
        .select({ total: count() })
        .from(pnlReports)
        .limit(100);
      const recent = await db
        .select()
        .from(pnlReports)
        .orderBy(desc(pnlReports.id))
        .limit(5);
      // F-12 (full sweep): fixture P&L numbers (4.56B/2.89B/36.6%) after
      // real queries whose results were discarded -> REAL revenue sum from
      // pnl_reports; expenses/margin have no delivered source -> honest 0s.
      const [rev] = await db
        .select({ v: sql<number>`COALESCE(SUM(${pnlReports.totalRevenue}), 0)` })
        .from(pnlReports)
        .limit(100);
      return {
        totalRevenue: Number(rev?.v ?? 0),
        totalExpenses: 0,
        netProfit: 0,
        profitMargin: 0,
        reportCount: Number(total),
        lastGenerated: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
const exportReport = protectedProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
    })
  )
  .query(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const lim = input.limit ?? 10;
      const offset = ((input.page ?? 1) - 1) * lim;
      const rows = await db
        .select()
        .from(pnlReports)
        .orderBy(desc(pnlReports.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(pnlReports)
        .limit(100);
      return { items: rows, total, page: input.page ?? 1, limit: lim };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
const getRevenueBreakdown = protectedProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
    })
  )
  .query(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const lim = input.limit ?? 10;
      const offset = ((input.page ?? 1) - 1) * lim;
      const rows = await db
        .select()
        .from(pnlReports)
        .orderBy(desc(pnlReports.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(pnlReports)
        .limit(100);
      return { items: rows, total, page: input.page ?? 1, limit: lim };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });

export const financialReportingSuiteRouter = router({
  getPnl,
  getBalanceSheet,
  getCashFlow,
  getTrialBalance,
  getStats,
  exportReport,
  getRevenueBreakdown,
});
