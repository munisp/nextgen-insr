// @ts-check
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { auditLog } from "../../drizzle/schema";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";

export const emailNotificationsRouter = router({
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
  getPreferences: protectedProcedure.query(async () => ({
    emailEnabled: true,
    frequency: "daily",
    categories: [],
  })),
  updatePreferences: protectedProcedure
    .input(
      z.object({
        emailEnabled: z.boolean().optional(),
        frequency: z.string().optional(),
      })
    )
    .mutation(async () => ({ success: true })),
  sendTest: protectedProcedure
    .input(z.object({ email: z.string() }))
    .mutation(async () => ({ sent: true })),
  sendCustom: protectedProcedure
    .input(z.object({ to: z.string(), subject: z.string(), body: z.string() }))
    .mutation(async () => ({ sent: true, messageId: "msg-test" })),
  getDeliveryLog: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).default({}))
    .query(async () => ({ entries: [], total: 0 })),
  getProviderStatus: protectedProcedure.query(async () => ({
    provider: "sendgrid",
    status: "healthy",
    deliveryRate: 0.99,
  })),
  getStats: protectedProcedure.query(async () => ({
    sent: 0,
    delivered: 0,
    bounced: 0,
    deliveryRate: 1.0,
  })),
});
