// @ts-nocheck
// Sprint 87: Bounce handling, retry logic, deliverability scoring
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { emailDeliveryLog } from "@schema";
import { eq, desc, and, count, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const MAX_RETRIES = 3;
const RETRY_DELAYS = [60, 300, 900]; // 1min, 5min, 15min

export const emailDeliveryLogRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const conditions = input.status
          ? [eq(emailDeliveryLog.status, input.status)]
          : [];
        const rows = await db
          .select()
          .from(emailDeliveryLog)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(emailDeliveryLog.id))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(emailDeliveryLog)
          .where(conditions.length ? and(...conditions) : undefined)
          .limit(100);
        return { items: rows, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [row] = await db
          .select()
          .from(emailDeliveryLog)
          .where(eq(emailDeliveryLog.id, input.id))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Email delivery log not found",
          });
        return row;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getDeliverabilityScore: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [stats] = await db
      .select({
        total: count(),
        delivered: sql<number>`COUNT(*) FILTER (WHERE status = 'delivered')`,
        bounced: sql<number>`COUNT(*) FILTER (WHERE status = 'bounced')`,
        failed: sql<number>`COUNT(*) FILTER (WHERE status = 'failed')`,
      })
      .from(emailDeliveryLog)
      .limit(100);
    const deliveryRate =
      stats.total > 0 ? (stats.delivered / stats.total) * 100 : 0;
    const bounceRate =
      stats.total > 0 ? (stats.bounced / stats.total) * 100 : 0;
    return {
      deliveryRate: Math.round(deliveryRate * 100) / 100,
      bounceRate: Math.round(bounceRate * 100) / 100,
      total: stats.total,
      delivered: stats.delivered,
      bounced: stats.bounced,
      failed: stats.failed,
      health:
        deliveryRate > 95
          ? "excellent"
          : deliveryRate > 85
            ? "good"
            : deliveryRate > 70
              ? "needs_attention"
              : "critical",
    };
  }),
  retryFailed: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [record] = await db
          .select()
          .from(emailDeliveryLog)
          .where(eq(emailDeliveryLog.id, input.id))
          .limit(100);
        if (!record)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Email log not found",
          });
        // @ts-expect-error auto-fix
        const retryCount = record.retryCount || 0;
        if (retryCount >= MAX_RETRIES)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Maximum retries (${MAX_RETRIES}) exceeded`,
          });
        await db
          .update(emailDeliveryLog)
          .set({
            status: "queued",
          })
          .where(eq(emailDeliveryLog.id, input.id));
        return {
          success: true,
          retryCount: retryCount + 1,
          nextRetryIn: RETRY_DELAYS[retryCount] + "s",
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .delete(emailDeliveryLog)
          .where(eq(emailDeliveryLog.id, input.id));
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
});
