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


const notImplemented = (feature: string) =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: `${feature} is not implemented yet`,
  });

export const advancedNotificationsRouter = router({
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { totalNotifications: 0, unread: 0, channels: 0 };
    const [total] = await db
      .select({ value: count() })
      .from(notification_logs)
      .limit(100);
    const [unread] = await db
      .select({ value: count() })
      .from(notification_logs)
      .where(eq(notification_logs.status, "pending"))
      .limit(100);
    return {
      totalNotifications: Number(total.value),
      unread: Number(unread.value),
      channels: 4,
    };
  }),
  list: protectedProcedure
    .input(
      z
        .object({
          recipientId: z.string().optional(),
          status: z.string().optional(),
          limit: z.number().default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { notifications: [], total: 0 };
        const conditions: any[] = [];
        if (input?.recipientId)
          conditions.push(eq(notification_logs.recipientId, input.recipientId));
        if (input?.status)
          conditions.push(eq(notification_logs.status, input.status));
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const rows = await db
          .select()
          .from(notification_logs)
          .where(where)
          .orderBy(desc(notification_logs.createdAt))
          .limit(input?.limit ?? 20);
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
  send: protectedProcedure
    .input(
      z.object({
        recipientId: z.string(),
        recipientType: z.string().default("user"),
        subject: z.string(),
        body: z.string(),
        channel: z.string().default("in_app"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const [notif] = await db
          .insert(notification_logs)
          .values({
            recipientId: input.recipientId,
            recipientType: input.recipientType,
            subject: input.subject,
            body: input.body,
            status: "sent",
            sentAt: new Date(),
          })
          .returning();
        return { success: true, notification: notif };
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

  // F-12 (wave-4b): zero-payload dashboard — no advanced-notifications store is delivered. Fail loud.
  dashboard: protectedProcedure.query(() => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "dashboard: no advanced-notifications store is delivered",
    });
  }),

  listTemplates: protectedProcedure.query(async () => {
    throw notImplemented("Notification templates");
  }),
  sendNotification: protectedProcedure
    .input(z.object({ id: z.string().optional() }).default({}))
    .mutation(async () => {
      throw notImplemented("Templated notification send");
    }),
  listHistory: protectedProcedure
    .input(z.object({ id: z.string().optional() }).default({}))
    .query(async () => {
      throw notImplemented("Notification history");
    }),
  getPreferences: protectedProcedure
    .input(z.object({ id: z.string().optional() }).default({}))
    .query(async () => {
      throw notImplemented("Notification preferences");
    }),
});
