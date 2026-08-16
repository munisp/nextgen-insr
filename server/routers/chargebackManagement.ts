import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count, sum } from "drizzle-orm";
import { z } from "zod";

import {
  disputes,
  transactions,
  refunds,
  auditLog,
} from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const chargebackManagementRouter = router({
  listChargebacks: protectedProcedure
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
              .from(disputes)
              .where(
                and(
                  eq(disputes.type, "chargeback"),
                  eq(disputes.status, input.status)
                )
              )
              .orderBy(desc(disputes.createdAt))
              .limit(input?.limit ?? 50)
          : await db
              .select()
              .from(disputes)
              .where(eq(disputes.type, "chargeback"))
              .orderBy(desc(disputes.createdAt))
              .limit(input?.limit ?? 50);
        return { chargebacks: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getChargeback: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [dispute] = await db
          .select()
          .from(disputes)
          .where(eq(disputes.id, input.id))
          .limit(1);
        if (!dispute) return null;
        const [tx] = dispute.transactionId
          ? await db
              .select()
              .from(transactions)
              .where(eq(transactions.id, dispute.transactionId))
              .limit(1)
          : [null];
        return { ...dispute, transaction: tx };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  createChargeback: protectedProcedure
    .input(
      z.object({
        transactionId: z.number(),
        reason: z.string(),
        amount: z.number().positive(),
        evidence: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [chargeback] = await db
          .insert(disputes)
          .values({
            transactionId: input.transactionId,
            type: "chargeback",
            reason: input.reason,
            amount: String(input.amount),
            status: "open",
          } as any)
          .returning();
        await db.insert(auditLog).values({
          action: "chargeback_created",
          resource: "disputes",
          resourceId: String(chargeback.id),
          status: "success",
          metadata: {
            transactionId: input.transactionId,
            amount: input.amount,
          },
        } as any);
        return chargeback;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  resolveChargeback: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        resolution: z.enum(["accepted", "rejected", "partial"]),
        refundAmount: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .update(disputes)
          .set({ status: "resolved", resolution: input.resolution })
          .where(eq(disputes.id, input.id));
        await db.insert(auditLog).values({
          action: "chargeback_resolved",
          resource: "disputes",
          resourceId: String(input.id),
          status: "success",
          metadata: {
            resolution: input.resolution,
            refundAmount: input.refundAmount,
          },
        });
        return { success: true, id: input.id, resolution: input.resolution };
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
    const [total] = await db
      .select({ value: count() })
      .from(disputes)
      .where(eq(disputes.type, "chargeback"))
      .limit(100);
    const [open] = await db
      .select({ value: count() })
      .from(disputes)
      .where(and(eq(disputes.type, "chargeback"), eq(disputes.status, "open")))
      .limit(100);
    const [resolved] = await db
      .select({ value: count() })
      .from(disputes)
      .where(
        and(eq(disputes.type, "chargeback"), eq(disputes.status, "resolved"))
      )
      .limit(100);
    return {
      totalChargebacks: Number(total.value),
      openChargebacks: Number(open.value),
      resolvedChargebacks: Number(resolved.value),
    };
  }),
});
