import { TRPCError } from "@trpc/server";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";
import { z } from "zod";

import { auditLog } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
// Notification categories (16 across 4 groups):
// Transactions: txn_success, txn_failed, txn_pending, txn_reversed
// Security: sec_fraud, sec_login, sec_password, sec_mfa
// Financial: fin_settlement, fin_commission, fin_float, fin_payout
// System: sys_maintenance, sys_update, sys_alert, sys_report
export const userNotifPreferencesRouter = router({
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
  // F-12 (wave-4b): no user notification-preference store exists — these
  // were fixture defaults (all-true prefs) and echo-facade mutations
  // (returned the input as fake success). All fail loud until a store is
  // delivered.
  getPreferences: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getPreferences: no notification-preference store is delivered",
    });
  }),
  updateQuietHours: protectedProcedure
    .input(z.object({ start: z.string(), end: z.string() }))
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "updateQuietHours: no notification-preference store is delivered",
      });
    }),
  updateDigestMode: protectedProcedure
    .input(z.object({ mode: z.enum(["instant", "hourly", "daily"]) }))
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "updateDigestMode: no notification-preference store is delivered",
      });
    }),
  bulkUpdate: protectedProcedure
    .input(
      z.object({
        categories: z.array(z.string()),
        channels: z.object({
          email: z.boolean(),
          sms: z.boolean(),
          push: z.boolean(),
          inApp: z.boolean(),
        }),
      })
    )
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "bulkUpdate: no notification-preference store is delivered",
      });
    }),
  resetToDefaults: protectedProcedure.mutation(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "resetToDefaults: no notification-preference store is delivered",
    });
  }),
  enableAllForChannel: protectedProcedure
    .input(z.object({ channel: z.string() }))
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "enableAllForChannel: no notification-preference store is delivered",
      });
    }),
  updateCategory: protectedProcedure
    .input(z.object({ categoryId: z.string(), enabled: z.boolean() }))
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "updateCategory: no notification-preference store is delivered",
      });
    }),
});
