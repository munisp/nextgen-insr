// @ts-check

import { z } from "zod";
import { publicProcedure, router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { notification_logs, auditLog } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

export const realtimeNotificationsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({ limit: z.number().default(50), read: z.boolean().optional() })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows =
          input?.read !== undefined
            ? await db
                .select()
                .from(notification_logs)
                .where(
                  eq(notification_logs.status, input.read ? "read" : "pending")
                )
                .orderBy(desc(notification_logs.createdAt))
                .limit(input?.limit ?? 50)
            : await db
                .select()
                .from(notification_logs)
                .orderBy(desc(notification_logs.createdAt))
                .limit(input?.limit ?? 50);
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
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .update(notification_logs)
          .set({ status: "read" })
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
  markAllRead: protectedProcedure.mutation(async () => {
    const db = (await getDb())!;
    await db
      .update(notification_logs)
      .set({ status: "read" })
      .where(eq(notification_logs.status, "pending"));
    return { success: true };
  }),
  send: protectedProcedure
    .input(
      z.object({
        title: z.string(),
        message: z.string(),
        type: z.enum(["info", "warning", "error", "success"]).default("info"),
        userId: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [notif] = await db
          .insert(notification_logs)
          .values({
            recipientId: input.userId ? String(input.userId) : "system",
            recipientType: input.userId ? "user" : "system",
            subject: input.title,
            body: input.message,
            status: "pending",
          })
          .returning();
        return notif;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  dashboard: protectedProcedure.query(async () => {
    return {
      totalRecords: 0,
      activeRecords: 0,
      lastUpdated: new Date().toISOString(),
      uptime: 99.9,
      version: "1.0.0",
      totalNotifications: 45892,
      unreadCount: 234,
      sentLast24h: 1250,
      byChannel: [
        { channel: "email", count: 400 },
        { channel: "sms", count: 350 },
        { channel: "push", count: 300 },
        { channel: "inApp", count: 200 },
      ],
      recentNotifications: [
        {
          id: "N-001",
          title: "Payment Received",
          type: "transaction",
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }),

  getStats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
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
      channels: 5,
    };
  }),

  broadcast: publicProcedure
    .input(
      z.object({
        title: z.string(),
        body: z.string(),
        type: z.string().optional(),
        priority: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return { sent: 0, failed: 0, messageId: "MSG-001", title: input.title };
    }),
});
