import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";
import { z } from "zod";

import { transactions } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

export const cardRequestRouter = router({
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
      const [record] = await database
        .select()
        .from(transactions)
        .where(eq(transactions.id, input.id))
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
      .from(transactions);
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
        .from(transactions)
        .orderBy(desc(transactions.id))
        .limit(input.limit);

      return results;
    }),

  list: protectedProcedure.query(async () => {
    return {
      requests: [
        {
          id: "CR-001",
          agentId: "AGT-001",
          cardType: "debit",
          status: "delivered",
          requestedAt: "2024-06-01",
        },
      ],
      total: 1,
    };
  }),
  analytics: protectedProcedure.query(async () => {
    return {
      total: 300,
      byStatus: { delivered: 250, pending: 30, rejected: 20 },
      byType: { debit: 200, prepaid: 100 },
      avgDeliveryDays: 7,
    };
  }),
});
