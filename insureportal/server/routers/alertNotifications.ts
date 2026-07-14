import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
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
import { notification_logs, auditLog } from "@schema";
import { TRPCError } from "@trpc/server";

export const alertNotificationsRouter = router({
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return { totalAlerts: 0, unacknowledged: 0, critical: 0, warning: 0 };
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
      totalAlerts: Number(total.value),
      unacknowledged: Number(unread.value),
      critical: 0,
      warning: 0,
    };
  }),
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { alerts: [], total: 0 };
        const rows = await db
          .select()
          .from(notification_logs)
          .orderBy(desc(notification_logs.createdAt))
          .limit(input?.limit ?? 20);
        return { alerts: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  acknowledge: protectedProcedure
    .input(z.object({ alertId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const [updated] = await db
          .update(notification_logs)
          .set({ status: "read" })
          .where(eq(notification_logs.id, input.alertId))
          .returning();
        return { success: true, alert: updated };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  create: protectedProcedure
    .input(
      z.object({
        recipientId: z.string(),
        subject: z.string(),
        body: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const [alert] = await db
          .insert(notification_logs)
          .values({
            recipientId: input.recipientId,
            recipientType: "user",
            subject: input.subject,
            body: input.body,
            status: "pending",
          })
          .returning();
        return { success: true, alert };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  listPreferences: protectedProcedure.query(async () => ({
    preferences: [],
    total: 0,
  })),
  getPreference: protectedProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ input }) => ({ key: input.key, value: true })),
  updatePreference: protectedProcedure
    .input(z.object({ key: z.string(), value: z.boolean() }))
    .mutation(async ({ input }) => ({
      key: input.key,
      value: input.value,
      updated: true,
    })),
});
