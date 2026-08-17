import { TRPCError } from "@trpc/server";
import {
  eq,
  desc,
  and,
  sql,
  count,
  sum,
  isNull,
  gte,
  lte,
  or,
  asc,
} from "drizzle-orm";
import { z } from "zod";

import { notification_logs, auditLog } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";

export function createNotification(params: {
  channel: string;
  category: string;
  priority: string;
  title: string;
  body: string;
  agentId?: number;
  agentName?: string;
  actionUrl?: string;
}) {
  return {
    id: `notif_${Date.now()}_${Date.now().toString(36).slice(2, 8)}`,
    channel: params.channel,
    category: params.category,
    priority: params.priority,
    title: params.title,
    body: params.body,
    agentId: params.agentId,
    agentName: params.agentName,
    actionUrl: params.actionUrl,
    read: false,
    starred: false,
    archived: false,
    createdAt: new Date(),
  };
}

export const notificationInboxRouter = router({
  // F-12 (wave-4b): userId was client-supplied — any caller could read
  // any user's stats. Session-scoped to the caller.
  getStats: protectedProcedure.query(async ({ ctx }) => {
      try {
        const db = await getDb();
        if (!db) return { total: 0, unread: 0, archived: 0 };
        const [total] = await db
          .select({ value: count() })
          .from(notification_logs)
          .where(eq(notification_logs.recipientId, String(ctx.user.id)))
          .limit(100);
        const [unread] = await db
          .select({ value: count() })
          .from(notification_logs)
          .where(
            and(
              eq(notification_logs.recipientId, String(ctx.user.id)),
              eq(notification_logs.status, "pending")
            )
          )
          .limit(100);
        return {
          total: Number(total.value),
          unread: Number(unread.value),
          archived: 0,
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
  list: protectedProcedure
    .input(
      z.object({
        // F-12 (wave-4b): userId optional — defaults to the session user so
        // F-12 (wave-4b): optional client userId still allowed cross-user
        // reads — removed; always the caller.
        status: z.string().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const db = await getDb();
        if (!db) return { notifications: [], total: 0 };
        const conditions: any[] = [
          eq(notification_logs.recipientId, String(ctx.user.id)),
        ];
        if (input.status)
          conditions.push(eq(notification_logs.status, input.status));
        const where = and(...conditions);
        const rows = await db
          .select()
          .from(notification_logs)
          .where(where)
          .orderBy(desc(notification_logs.createdAt))
          .limit(input.limit)
          .offset(input.offset);
        return { notifications: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  markRead: protectedProcedure
    .input(z.object({ notificationId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const [updated] = await db
          .update(notification_logs)
          .set({ status: "read" })
          .where(eq(notification_logs.id, input.notificationId))
          .returning();
        return { success: true, notification: updated };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  // F-12 (wave-4b): userId was client-supplied — any caller could mark
  // any user's notifications read. Session-scoped to the caller.
  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db
          .update(notification_logs)
          .set({ status: "read" })
          .where(
            and(
              eq(notification_logs.recipientId, String(ctx.user.id)),
              eq(notification_logs.status, "pending")
            )
          );
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
  delete: protectedProcedure
    .input(z.object({ notificationId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db
          .delete(notification_logs)
          .where(eq(notification_logs.id, input.notificationId));
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

  archive: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(() => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "Notification archiving is not implemented yet",
      });
    }),

  bulkDelete: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(() => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "Bulk notification delete is not implemented yet",
      });
    }),

  getUnreadCounts: protectedProcedure.query(() => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "Unread notification counts are not implemented yet",
    });
  }),

  toggleStar: protectedProcedure.query(() => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "Notification starring is not implemented yet",
    });
  }),
});
