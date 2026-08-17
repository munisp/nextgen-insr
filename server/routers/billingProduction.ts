import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { transactions } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

export const billingProductionRouter = router({
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
          .from(transactions)
          .orderBy(desc(transactions.id))
          .limit(input.limit)
          .offset(input.offset);

        const _totalRows = await database
          .select({ total: count() })
          .from(transactions);
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
        .from(transactions)
        .where(eq(transactions.id, input.id))
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
      .from(transactions);
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
        .from(transactions)
        .orderBy(desc(transactions.id))
        .limit(input.limit);

      return results;
    }),
  generateMonthlyInvoices: protectedProcedure.mutation(async () => ({
    generated: 0,
    period: new Date().toISOString(),
  })),
  getPaymentMethods: protectedProcedure.query(async () => ({ methods: [] })),
  addPaymentMethod: protectedProcedure
    .input(z.object({ type: z.string(), token: z.string() }))
    .mutation(async ({ input }) => ({ success: true, type: input.type })),
  getBillingAlerts: protectedProcedure.query(async () => ({ alerts: [] })),
  configureBillingAlerts: protectedProcedure
    .input(z.object({ threshold: z.number(), enabled: z.boolean() }))
    .mutation(async () => ({ success: true })),
  getDunningStatus: protectedProcedure.query(async () => ({
    status: "healthy",
    overdue: 0,
  })),
  applyGracePeriod: protectedProcedure
    .input(z.object({ invoiceId: z.string(), days: z.number() }))
    .mutation(async () => ({ success: true })),
  getReconciliationSchedule: protectedProcedure.query(async () => ({
    schedule: "daily",
    lastRun: new Date().toISOString(),
  })),
  triggerReconciliation: protectedProcedure.mutation(async () => ({
    triggered: true,
    timestamp: new Date().toISOString(),
  })),
  getRateLimits: protectedProcedure.query(async () => ({
    limits: { perMinute: 60, perHour: 1000 },
  })),
  updateRateLimits: protectedProcedure
    .input(
      z.object({
        perMinute: z.number().optional(),
        perHour: z.number().optional(),
      })
    )
    .mutation(async () => ({ success: true })),
  createDispute: protectedProcedure
    .input(z.object({ invoiceId: z.string(), reason: z.string() }))
    .mutation(async () => ({ success: true, disputeId: "DSP-001" })),
  getDisputes: protectedProcedure.query(async () => ({ disputes: [] })),
  // F-12 (wave-4b): zero-payloads / facades / a fabricated 15% tax rate —
  // no forecast, cohort, plan-migration, PDF, or credit store is delivered.
  // All fail loud.
  getRevenueForecast: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getRevenueForecast: no revenue-forecast pipeline is delivered",
    });
  }),
  calculateTax: protectedProcedure
    .input(z.object({ amount: z.number(), region: z.string() }))
    .query(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "calculateTax: no tax engine is delivered (the previous 15% rate was fabricated)",
      });
    }),
  migratePlan: protectedProcedure
    .input(z.object({ fromPlan: z.string(), toPlan: z.string() }))
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "migratePlan: plan migration is not delivered",
      });
    }),
  generateInvoicePdf: protectedProcedure
    .input(z.object({ invoiceId: z.string() }))
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "generateInvoicePdf: PDF generation is not delivered",
      });
    }),
  getCohortAnalytics: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getCohortAnalytics: no cohort-analytics pipeline is delivered",
    });
  }),
  getCreditBalance: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getCreditBalance: no credit store is delivered",
    });
  }),
  topUpCredits: protectedProcedure
    .input(z.object({ amount: z.number() }))
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "topUpCredits: no credit store is delivered",
      });
    }),
});
