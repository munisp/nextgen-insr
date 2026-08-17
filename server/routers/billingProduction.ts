import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { disputes, transactions } from "../../drizzle/schema";
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
  // F-12 (wave-4b, audit FAIL-3): every proc below was a success-echo
  // facade or zero-payload. Undelivered stores (payment methods, billing
  // alerts, dunning, grace periods, reconciliation, rate limits, invoice
  // generation) fail loud; disputes are real against the disputes table.
  generateMonthlyInvoices: protectedProcedure.mutation(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "generateMonthlyInvoices: no invoice-generation engine is delivered",
    });
  }),
  getPaymentMethods: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getPaymentMethods: no payment-method store is delivered",
    });
  }),
  addPaymentMethod: protectedProcedure
    .input(z.object({ type: z.string(), token: z.string() }))
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "addPaymentMethod: no payment-method store is delivered",
      });
    }),
  getBillingAlerts: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getBillingAlerts: no billing-alert store is delivered",
    });
  }),
  configureBillingAlerts: protectedProcedure
    .input(z.object({ threshold: z.number(), enabled: z.boolean() }))
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "configureBillingAlerts: no billing-alert store is delivered",
      });
    }),
  getDunningStatus: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getDunningStatus: no dunning pipeline is delivered",
    });
  }),
  applyGracePeriod: protectedProcedure
    .input(z.object({ invoiceId: z.string(), days: z.number() }))
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "applyGracePeriod: no grace-period store is delivered",
      });
    }),
  getReconciliationSchedule: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getReconciliationSchedule: no reconciliation engine is delivered",
    });
  }),
  triggerReconciliation: protectedProcedure.mutation(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "triggerReconciliation: no reconciliation engine is delivered",
    });
  }),
  getRateLimits: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getRateLimits: no rate-limit store is delivered",
    });
  }),
  updateRateLimits: protectedProcedure
    .input(
      z.object({
        perMinute: z.number().optional(),
        perHour: z.number().optional(),
      })
    )
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "updateRateLimits: no rate-limit store is delivered",
      });
    }),
  createDispute: protectedProcedure
    .input(z.object({ invoiceId: z.string(), reason: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "database unavailable",
        });
      }
      const ref = `DSP-${Date.now().toString(36).toUpperCase()}`;
      const [row] = await db
        .insert(disputes)
        .values({
          ref,
          agentId: ctx.user.id,
          transactionRef: input.invoiceId,
          reason: input.reason,
          description: input.reason,
          slaDeadlineAt: new Date(Date.now() + 72 * 3600 * 1000),
        })
        .returning({ id: disputes.id, ref: disputes.ref });
      return { success: true as const, disputeId: row.ref };
    }),
  getDisputes: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { disputes: [] };
    const rows = await db
      .select()
      .from(disputes)
      .where(eq(disputes.agentId, ctx.user.id))
      .orderBy(desc(disputes.id))
      .limit(100);
    return { disputes: rows };
  }),
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
