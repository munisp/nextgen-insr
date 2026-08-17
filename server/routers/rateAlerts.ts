// @ts-check
import { TRPCError } from "@trpc/server";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";
import { z } from "zod";

import { rateAlerts } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";


const notImplemented = (feature: string) =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: `${feature} is not implemented yet`,
  });

export const rateAlertsRouter = router({
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
          .from(rateAlerts)
          .orderBy(desc(rateAlerts.id))
          .limit(input.limit)
          .offset(input.offset);

        const _totalRows = await database
          .select({ total: count() })
          .from(rateAlerts);
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
        .from(rateAlerts)
        .where(eq(rateAlerts.id, input.id))
        .limit(1);

      if (!record) {
        throw new Error(`Record with id ${input.id} not found`);
      }
      return record;
    }),

  getSummary: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
    const _totalRows = await database
      .select({ total: count() })
      .from(rateAlerts);
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
        .from(rateAlerts)
        .orderBy(desc(rateAlerts.id))
        .limit(input.limit);

      return results;
    }),

  // F-12 (wave-4b): real INSERT on the delivered rate_alerts table
  // (agentId from the session, never from client-supplied demo fields).
  create: protectedProcedure
    .input(
      z.object({
        baseCurrency: z.string(),
        targetCurrency: z.string(),
        targetRate: z.number(),
        direction: z.enum(["above", "below"]),
        note: z.string().optional(),
        expiresAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "database unavailable" });
      }
      await database.insert(rateAlerts).values({
        agentId: ctx.user.id,
        baseCurrency: input.baseCurrency,
        targetCurrency: input.targetCurrency,
        targetRate: String(input.targetRate),
        direction: input.direction,
        note: input.note ?? null,
        expiresAt: input.expiresAt ?? null,
        status: "active",
      });
      return { success: true };
    }),

  // F-12 (wave-4b): real scoped DELETE (own alerts only).
  delete: protectedProcedure
    .input(z.object({ id: z.union([z.number(), z.string()]) }))
    .mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "database unavailable" });
      }
      await database
        .delete(rateAlerts)
        .where(and(eq(rateAlerts.id, Number(input.id)), eq(rateAlerts.agentId, ctx.user.id)));
      return { success: true };
    }),

  getCheckerStatus: protectedProcedure.query(async () => {
    throw notImplemented("Rate alert checker status");
  }),

  // F-12 (wave-4b): real aggregate counts from rate_alerts.
  getStats: protectedProcedure.query(async () => {
    const empty = { total: 0, active: 0, paused: 0, triggered: 0, expired: 0 };
    const database = await getDb();
    if (!database) return empty;
    const rows = await database
      .select({ status: rateAlerts.status, total: count() })
      .from(rateAlerts)
      .groupBy(rateAlerts.status);
    const out = { ...empty };
    for (const r of rows) {
      out.total += Number(r.total);
      if (r.status === "active") out.active = Number(r.total);
      else if (r.status === "paused") out.paused = Number(r.total);
      else if (r.status === "triggered") out.triggered = Number(r.total);
      else if (r.status === "expired") out.expired = Number(r.total);
    }
    return out;
  }),

  runCheck: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented("Rate alert check");
    }),

  // F-12 (wave-4b): real pause/resume (own alerts only).
  toggle: protectedProcedure
    .input(z.object({ id: z.union([z.number(), z.string()]) }))
    .mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "database unavailable" });
      }
      const [row] = await database
        .select()
        .from(rateAlerts)
        .where(and(eq(rateAlerts.id, Number(input.id)), eq(rateAlerts.agentId, ctx.user.id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "rate alert not found" });
      const next = row.status === "active" ? "paused" : "active";
      await database.update(rateAlerts).set({ status: next }).where(eq(rateAlerts.id, row.id));
      return { success: true, status: next };
    }),
  // Rate alert subscriptions with threshold logic
  subscribe: protectedProcedure
    .input(
      z.object({
        currencyPair: z.string(),
        threshold: z.number(),
        direction: z.enum(["above", "below"]),
        channel: z.enum(["email", "sms", "push"]).default("email"),
      })
    )
    .mutation(async () => {
      throw notImplemented("Rate alert subscription");
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        threshold: z.number().optional(),
        active: z.boolean().optional(),
      })
    )
    .mutation(async () => {
      throw notImplemented("Rate alert update");
    }),
  quickCreate: protectedProcedure
    .input(
      z.object({
        currencyPair: z.string(),
        threshold: z.number(),
        direction: z.enum(["above", "below"]),
      })
    )
    .mutation(async () => {
      throw notImplemented("Rate alert quick create");
    }),
});
