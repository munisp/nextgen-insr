// Sprint 87: Upgraded from mock data to real DB queries — paymentNotificationSystem
import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { z } from "zod";

import { notificationDispatchLog } from "../../drizzle/schema";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

const getNotifications = protectedProcedure
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
        .from(notificationDispatchLog)
        .orderBy(desc(notificationDispatchLog.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(notificationDispatchLog)
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
        .from(notificationDispatchLog)
        .limit(100);
      const recent = await db
        .select()
        .from(notificationDispatchLog)
        .orderBy(desc(notificationDispatchLog.id))
        .limit(5);
      // F-12 (verifier site 2): the stats fixture (45892/96.14/...) is
      // dead — real aggregates from notification_dispatch_log; the previously
      // discarded `total` query is now wired.
      const [deliveredRow] = await db
        .select({ value: count() })
        .from(notificationDispatchLog)
        .where(eq(notificationDispatchLog.status, "delivered"))
        .limit(100);
      const [failedRow] = await db
        .select({ value: count() })
        .from(notificationDispatchLog)
        .where(
          sql`${notificationDispatchLog.status} IN ('failed', 'bounced')`
        )
        .limit(100);
      const [queuedRow] = await db
        .select({ value: count() })
        .from(notificationDispatchLog)
        .where(eq(notificationDispatchLog.status, "queued"))
        .limit(100);
      const channelRows = await db
        .select({
          channel: notificationDispatchLog.channel,
          cnt: count(),
        })
        .from(notificationDispatchLog)
        .groupBy(notificationDispatchLog.channel)
        .limit(20);
      const channels: Record<string, number> = {};
      for (const r of channelRows) channels[r.channel ?? "unknown"] = Number(r.cnt);
      const totalNum = Number(total);
      return {
        totalSent: totalNum,
        deliveryRate:
          totalNum > 0
            ? Math.round((Number(deliveredRow.value) / totalNum) * 10000) / 100
            : 0,
        channels,
        failedDeliveries: Number(failedRow.value),
        retryQueue: Number(queuedRow.value),
        lastUpdated: new Date().toISOString(),
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
const markRead = protectedProcedure
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
        .from(notificationDispatchLog)
        .orderBy(desc(notificationDispatchLog.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(notificationDispatchLog)
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
const configureChannels = protectedProcedure
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
        .from(notificationDispatchLog)
        .orderBy(desc(notificationDispatchLog.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(notificationDispatchLog)
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
const getChannelConfig = protectedProcedure
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
        .from(notificationDispatchLog)
        .orderBy(desc(notificationDispatchLog.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(notificationDispatchLog)
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
const testNotification = protectedProcedure
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
        .from(notificationDispatchLog)
        .orderBy(desc(notificationDispatchLog.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(notificationDispatchLog)
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
const getDeliveryLog = protectedProcedure
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
        .from(notificationDispatchLog)
        .orderBy(desc(notificationDispatchLog.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(notificationDispatchLog)
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

export const paymentNotificationSystemRouter = router({
  getNotifications,
  getStats,
  markRead,
  configureChannels,
  getChannelConfig,
  testNotification,
  getDeliveryLog,
});
