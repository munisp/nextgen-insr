import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";
import { z } from "zod";

import { auditLog, notificationDispatchLog } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

// MOCKWARE FIX: templates/messages/analytics were hardcoded. There is no
// WhatsApp template table in the schema, so templates returns an honest
// empty list; messages and analytics are read from the real
// notification_dispatch_log table (channel = 'whatsapp').

export const whatsappChannelRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const database = await getDb();
        if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
        const results = await database
          .select()
          .from(auditLog)
          .orderBy(desc(auditLog.id))
          .limit(input.limit)
          .offset(input.offset);

        const _totalRows = await database
          .select({ total: count() })
          .from(auditLog);
        const totalResult = Array.isArray(_totalRows)
          ? _totalRows[0]
          : _totalRows;

        return {
          data: results,
          total: totalResult?.total ?? 0,
          limit: input.limit,
          offset: input.offset,
        };
      } catch {
        return { data: [], total: 0, limit: 0, offset: 0 };
      }
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
      const [record] = await database
        .select()
        .from(auditLog)
        .where(eq(auditLog.id, input.id))
        .limit(1);

      if (!record) {
        throw new Error(`Record with id ${input.id} not found`);
      }
      return record;
    }),

  getSummary: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
    const _totalRows = await database.select({ total: count() }).from(auditLog);
    const totalResult = Array.isArray(_totalRows) ? _totalRows[0] : _totalRows;

    return {
      totalRecords: totalResult?.total ?? 0,
      lastUpdated: new Date().toISOString(),
    };
  }),

  getRecent: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(7),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
      const since = new Date();
      since.setDate(since.getDate() - input.days);

      const results = await database
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.id))
        .limit(input.limit);

      return results;
    }),

  templates: protectedProcedure.query(async () => {
    // No WhatsApp template store exists in the schema — honest empty.
    return {
      templates: [] as any[],
      total: 0,
    };
  }),
  messages: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { messages: [], total: 0 };
    const rows = await database
      .select()
      .from(notificationDispatchLog)
      .where(eq(notificationDispatchLog.channel, "whatsapp"))
      .orderBy(desc(notificationDispatchLog.createdAt))
      .limit(50);
    return { messages: rows, total: rows.length };
  }),
  analytics: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) {
      return {
        totalSent: 0,
        delivered: 0,
        read: 0,
        failed: 0,
        deliveryRate: 0,
        templateCount: 0,
        responseRate: 0,
      };
    }
    const [sent] = await database
      .select({ value: count() })
      .from(notificationDispatchLog)
      .where(eq(notificationDispatchLog.channel, "whatsapp"));
    const [delivered] = await database
      .select({ value: count() })
      .from(notificationDispatchLog)
      .where(
        and(
          eq(notificationDispatchLog.channel, "whatsapp"),
          eq(notificationDispatchLog.status, "delivered")
        )
      );
    const [failed] = await database
      .select({ value: count() })
      .from(notificationDispatchLog)
      .where(
        and(
          eq(notificationDispatchLog.channel, "whatsapp"),
          eq(notificationDispatchLog.status, "failed")
        )
      );
    const totalSent = Number(sent.value);
    const deliveredCount = Number(delivered.value);
    return {
      totalSent,
      delivered: deliveredCount,
      read: 0, // read receipts are not tracked
      failed: Number(failed.value),
      deliveryRate: totalSent > 0 ? Math.round((deliveredCount / totalSent) * 100) : 0,
      templateCount: 0, // no template store exists
      responseRate: 0, // responses are not tracked
    };
  }),
});
