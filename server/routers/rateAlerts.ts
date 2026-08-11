// @ts-check
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { rateAlerts } from "../../drizzle/schema";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";

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

  create: protectedProcedure
    .input(z.object({ data: z.record(z.string(), z.any()).optional() }))
    .mutation(async () => {
      throw notImplemented("Rate alert creation");
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.union([z.number(), z.string()]) }))
    .mutation(async () => {
      throw notImplemented("Rate alert deletion");
    }),

  getCheckerStatus: protectedProcedure.query(async () => {
    throw notImplemented("Rate alert checker status");
  }),

  getStats: protectedProcedure.query(async () => {
    throw notImplemented("Rate alert stats");
  }),

  rearm: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented("Rate alert rearm");
    }),

  runCheck: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented("Rate alert check");
    }),

  toggle: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented("Rate alert toggle");
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
