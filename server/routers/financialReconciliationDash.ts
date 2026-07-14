// @ts-check
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { eq, desc, and, sql, count, sum } from "drizzle-orm";
import {
  reconciliationBatches,
  reconciliationItems,
  transactions,
  auditLog,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

export const financialReconciliationDashRouter = router({
  listBatches: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().default(50),
          status: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = input?.status
          ? await db
              .select()
              .from(reconciliationBatches)
              .where(eq(reconciliationBatches.status, input.status))
              .orderBy(desc(reconciliationBatches.createdAt))
              .limit(input?.limit ?? 50)
          : await db
              .select()
              .from(reconciliationBatches)
              .orderBy(desc(reconciliationBatches.createdAt))
              .limit(input?.limit ?? 50);
        return { batches: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getBatch: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [batch] = await db
          .select()
          .from(reconciliationBatches)
          .where(eq(reconciliationBatches.id, input.id))
          .limit(1);
        if (!batch) return null;
        const items = await db
          .select()
          .from(reconciliationItems)
          .where(eq(reconciliationItems.batchId, input.id))
          .limit(100);
        return { ...batch, items };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  createBatch: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        type: z.string(),
        dateRange: z.object({ from: z.string(), to: z.string() }).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [batch] = await db
          .insert(reconciliationBatches)
          .values({
            name: input.name,
            type: input.type,
            status: "pending",
          } as any)
          .returning();
        await db.insert(auditLog).values({
          action: "reconciliation_batch_created",
          resource: "reconciliation_batches",
          resourceId: String(batch.id),
          status: "success",
          metadata: { name: input.name, type: input.type },
        } as any);
        return batch;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getStats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [totalBatches] = await db
      .select({ value: count() })
      .from(reconciliationBatches)
      .limit(100);
    const [totalItems] = await db
      .select({ value: count() })
      .from(reconciliationItems)
      .limit(100);
    const [matched] = await db
      .select({ value: count() })
      .from(reconciliationItems)
      .where(eq(reconciliationItems.matchStatus, "matched"))
      .limit(100);
    return {
      totalBatches: Number(totalBatches.value),
      totalItems: Number(totalItems.value),
      matchedItems: Number(matched.value),
      matchRate:
        Number(totalItems.value) > 0
          ? Math.round((Number(matched.value) / Number(totalItems.value)) * 100)
          : 0,
    };
  }),
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().default(20),
          offset: z.number().default(0),
        })
        .default({})
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { items: [], total: 0 };
        return { items: [], total: 0 };
      } catch {
        return { items: [], total: 0 };
      }
    }),
});
