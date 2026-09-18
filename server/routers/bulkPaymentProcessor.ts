// Sprint 87: Upgraded from mock data to real DB queries — bulkPaymentProcessor
import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { z } from "zod";

import { merchantPayouts } from "../../drizzle/schema";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

const uploadBatch = protectedProcedure
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
        .from(merchantPayouts)
        .orderBy(desc(merchantPayouts.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(merchantPayouts)
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
const validateBatch = protectedProcedure
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
        .from(merchantPayouts)
        .orderBy(desc(merchantPayouts.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(merchantPayouts)
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
const getBatchStatus = protectedProcedure
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
        .from(merchantPayouts)
        .orderBy(desc(merchantPayouts.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(merchantPayouts)
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
const listBatches = protectedProcedure
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
        .from(merchantPayouts)
        .orderBy(desc(merchantPayouts.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(merchantPayouts)
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
        .from(merchantPayouts)
        .limit(100);
      const recent = await db
        .select()
        .from(merchantPayouts)
        .orderBy(desc(merchantPayouts.id))
        .limit(5);
      // F-12 (full sweep): fixture stats returned after real queries whose
      // results were discarded -> REAL aggregates from merchant_payouts.
      // avgProcessingTime has no telemetry store -> honest null.
      const [tot] = await db.select({ value: count() }).from(merchantPayouts).limit(100);
      const statusRows = await db
        .select({ status: merchantPayouts.status, cnt: count() })
        .from(merchantPayouts)
        .groupBy(merchantPayouts.status)
        .limit(20);
      const byStatus: Record<string, number> = {};
      for (const r of statusRows) byStatus[r.status ?? "unknown"] = Number(r.cnt);
      const [amt] = await db
        .select({ v: sql<number>`COALESCE(SUM(${merchantPayouts.amount}), 0)` })
        .from(merchantPayouts)
        .limit(100);
      return {
        totalBatches: Number(tot.value),
        processed: byStatus["processed"] ?? byStatus["completed"] ?? 0,
        failed: byStatus["failed"] ?? 0,
        pending: byStatus["pending"] ?? 0,
        totalAmount: Number(amt?.v ?? 0),
        avgProcessingTime: null,
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
// PAY-6: batch payout semantics (per-item status, mid-batch float-exhaustion
// halt, batch-level rollback) require a real batch model that does not exist
// in this schema. The previous implementation inserted/read a single
// merchantPayouts row and returned "processBatch completed" — fake success.
// Fail-loud until a real batch processor is built; single payouts belong to
// merchantPayoutSettlement.initiatePayout/processPayout.
const processBatch = protectedProcedure
  .input(z.object({ id: z.number().optional(), data: z.record(z.string(), z.any()).optional() }))
  .mutation(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message:
        "Batch payout processing is not implemented: there is no batch table, per-item status model, or exhaustion-halt semantics. " +
        "Use merchantPayoutSettlement for single payouts. This endpoint fails loudly rather than fabricating success.",
    });
  });
// PAY-6: see processBatch — no batch model exists to cancel. Fail-loud.
const cancelBatch = protectedProcedure
  .input(z.object({ id: z.number().optional(), data: z.record(z.string(), z.any()).optional() }))
  .mutation(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message:
        "Batch cancellation is not implemented: no batch lifecycle exists. " +
        "Cancel individual payouts via merchantPayoutSettlement instead.",
    });
  });

export const bulkPaymentProcessorRouter = router({
  uploadBatch,
  validateBatch,
  getBatchStatus,
  listBatches,
  getStats,
  processBatch,
  cancelBatch,
});
