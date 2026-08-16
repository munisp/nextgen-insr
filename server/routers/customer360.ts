import { TRPCError } from "@trpc/server";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";
import { z } from "zod";

import { customers } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";


// MOCKWARE FIX: getProfile returned a hardcoded "Default Customer" and
// analyzeSentiment returned canned positive sentiment. getProfile now reads
// the real customers table and sentiment analysis fails loudly because no
// LLM is configured.

export const customer360Router = router({
  dashboard: protectedProcedure.query(async () => {
    const database = await getDb();
    let totalRecords = 0;
    let activeRecords = 0;
    if (database) {
      const [total] = await database.select({ value: count() }).from(customers);
      const [active] = await database
        .select({ value: count() })
        .from(customers)
        .where(eq(customers.status, "active"));
      totalRecords = Number(total?.value ?? 0);
      activeRecords = Number(active?.value ?? 0);
    }
    return {
      totalRecords,
      activeRecords,
      lastUpdated: new Date().toISOString(),
      uptime: null, // no uptime probe wired — not fabricated
      version: "1.0.0",
    };
  }),

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
          .from(customers)
          .orderBy(desc(customers.id))
          .limit(input.limit)
          .offset(input.offset);

        const _totalRows = await database
          .select({ total: count() })
          .from(customers);
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
        .from(customers)
        .where(eq(customers.id, input.id))
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
      .from(customers);
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
        .from(customers)
        .orderBy(desc(customers.id))
        .limit(input.limit);

      return results;
    }),

  getProfile: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [customer] = await database
        .select()
        .from(customers)
        .where(eq(customers.id, input.id))
        .limit(1);
      if (!customer) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Customer ${input.id} not found` });
      }
      return {
        id: String(customer.id),
        name: `${customer.firstName} ${customer.lastName}`,
        segments: [], // no segmentation engine attached
        ltv: 0, // no LTV model attached
      };
    }),

  analyzeSentiment: protectedProcedure
    .input(z.object({ customerId: z.number().optional() }).optional())
    .query(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "Sentiment analysis not configured: no LLM provider is wired in this service",
      });
    }),
});
