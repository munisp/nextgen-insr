import { TRPCError } from "@trpc/server";
import { desc, eq, count } from "drizzle-orm";
import { z } from "zod";

import { auditLog } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";


// NOTE: No real ML/fraud scoring model is attached to this service.
// Scoring endpoints fail loudly instead of returning fabricated zero scores.
// The list/getById/getSummary/getRecent queries read real audit_log rows.

const NOT_CONFIGURED = () =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: "ML scoring service not configured",
  });

export const mlScoringServiceRouter = router({
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

  // Honest empty analytics — no scoring has been performed by any real model.
  // F-12 (wave-4b): was a zero-payload stub — no delivered ML model or
  // ml_scores store exists. Fail loud, never fixture zeros.
  analytics: protectedProcedure.query(async () => {
    throw NOT_CONFIGURED();
  }),

  batchScore: protectedProcedure
    .input(z.object({ transactionIds: z.array(z.number()) }))
    .mutation(async () => {
      throw NOT_CONFIGURED();
    }),

  explainScore: protectedProcedure
    .input(z.object({ transactionId: z.number() }))
    .query(async () => {
      throw NOT_CONFIGURED();
    }),

  scoreTransaction: protectedProcedure
    .input(
      z.object({ transactionId: z.number(), amount: z.number().optional() })
    )
    .mutation(async () => {
      throw NOT_CONFIGURED();
    }),

  // F-12 (wave-4b): was a zero-payload stub (always-empty history) — no
  // delivered scoring store. Fail loud, never an honest-looking empty table.
  scoringHistory: protectedProcedure.query(async () => {
    throw NOT_CONFIGURED();
  }),
});
