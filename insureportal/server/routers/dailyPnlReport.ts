import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { pnlReports, transactions } from "@schema";
import { desc, eq, sql, and, gte, lte, count, sum } from "drizzle-orm";

/**
 * Daily P&L Report Router
 * 
 * Generates profit & loss reports by period (daily/weekly/monthly).
 * Aggregates revenue from transactions, commissions, and fees.
 * Supports agent-level and region-level breakdowns.
 * 
 * Revenue Components:
 * - Transaction fees (1.5% of transfer value)
 * - Commission splits (agent 60%, platform 40%)
 * - Float interest income
 * - Premium financing fees
 * 
 * Cost Components:
 * - Bank charges (per-transaction)
 * - Agent payouts
 * - Infrastructure costs (allocated)
 */
export const dailyPnlReportRouter = router({
  // List P&L reports by period
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(30),
        offset: z.number().min(0).default(0),
        periodType: z.enum(["daily", "weekly", "monthly"]).optional(),
        agentId: z.number().optional(),
        regionCode: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0 };

      const conditions = [];
      if (input.periodType) conditions.push(eq(pnlReports.periodType, input.periodType));
      if (input.agentId) conditions.push(eq(pnlReports.agentId, input.agentId));
      if (input.regionCode) conditions.push(eq(pnlReports.regionCode, input.regionCode));

      const query = database.select().from(pnlReports)
        .orderBy(desc(pnlReports.id))
        .limit(input.limit)
        .offset(input.offset);

      const results = conditions.length > 0
        ? await query.where(and(...conditions))
        : await query;

      const [{ total }] = await database.select({ total: count() }).from(pnlReports);

      return { data: results, total: total ?? 0 };
    }),

  // Generate P&L summary for a date range
  generateSummary: protectedProcedure
    .input(
      z.object({
        dateFrom: z.string(),
        dateTo: z.string(),
        groupBy: z.enum(["agent", "region", "product"]).default("agent"),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return null;

      // Aggregate from pnl_reports table
      const reports = await database
        .select({
          totalRevenue: sum(pnlReports.totalRevenue),
          totalCommission: sum(pnlReports.totalCommission),
          totalFees: sum(pnlReports.totalFees),
          count: count(),
        })
        .from(pnlReports)
        .where(and(
          gte(pnlReports.period, input.dateFrom),
          lte(pnlReports.period, input.dateTo),
        ));

      const summary = reports[0];
      const revenue = Number(summary?.totalRevenue ?? 0);
      const commission = Number(summary?.totalCommission ?? 0);
      const fees = Number(summary?.totalFees ?? 0);
      const netProfit = revenue - commission - fees;

      return {
        period: { from: input.dateFrom, to: input.dateTo },
        revenue,
        commission,
        fees,
        netProfit,
        margin: revenue > 0 ? ((netProfit / revenue) * 100).toFixed(1) : "0.0",
        reportCount: summary?.count ?? 0,
        lastUpdated: new Date().toISOString(),
      };
    }),

  // Get top agents by revenue
  topAgents: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(10),
        period: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [];

      const results = await database
        .select({
          agentId: pnlReports.agentId,
          totalRevenue: sum(pnlReports.totalRevenue),
          totalCommission: sum(pnlReports.totalCommission),
        })
        .from(pnlReports)
        .groupBy(pnlReports.agentId)
        .orderBy(desc(sum(pnlReports.totalRevenue)))
        .limit(input.limit);

      return results.map((r) => ({
        agentId: r.agentId,
        revenue: Number(r.totalRevenue ?? 0),
        commission: Number(r.totalCommission ?? 0),
        netContribution: Number(r.totalRevenue ?? 0) - Number(r.totalCommission ?? 0),
      }));
    }),

  // Get single report by ID
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [report] = await database
        .select()
        .from(pnlReports)
        .where(eq(pnlReports.id, input.id))
        .limit(1);

      if (!report) throw new Error(`P&L report #${input.id} not found`);
      return report;
    }),
});
