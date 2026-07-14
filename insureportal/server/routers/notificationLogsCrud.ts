// Sprint 87: Delivery tracking, retry scheduling, analytics
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { notification_logs } from "@schema";
import { eq, desc, and, count, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const notification_logsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        channelId: z.number().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const conditions: any[] = [];
        if (input.status)
          conditions.push(eq(notification_logs.status, input.status));
        if (input.channelId)
          conditions.push(eq(notification_logs.channelId, input.channelId));
        const rows = await db
          .select()
          .from(notification_logs)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(notification_logs.id))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(notification_logs)
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
          .from(notification_logs)
          .where(eq(notification_logs.id, input.id))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Notification log not found",
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
  getAnalytics: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [stats] = await db
      .select({
        total: count(),
        sent: sql<number>`COUNT(*) FILTER (WHERE status = 'sent')`,
        delivered: sql<number>`COUNT(*) FILTER (WHERE status = 'delivered')`,
        failed: sql<number>`COUNT(*) FILTER (WHERE status = 'failed')`,
        pending: sql<number>`COUNT(*) FILTER (WHERE status = 'pending')`,
      })
      .from(notification_logs)
      .limit(100);
    return {
      ...stats,
      deliveryRate:
        stats.total > 0
          ? Math.round((stats.delivered / stats.total) * 10000) / 100
          : 0,
      failureRate:
        stats.total > 0
          ? Math.round((stats.failed / stats.total) * 10000) / 100
          : 0,
    };
  }),
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .delete(notification_logs)
          .where(eq(notification_logs.id, input.id));
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
