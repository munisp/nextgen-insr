import { TRPCError } from "@trpc/server";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";
import { z } from "zod";

import { transactions } from "../../drizzle/schema";
import { permifyCheck } from "../_core/permify";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

// ── Middleware Integration (Sprint 44) ──────────────────────────────
import { fluvioProduce } from "../fluvio";
import { publishEvent, type KafkaTopic } from "../kafkaClient";
import { cacheSet, cacheGet } from "../redisClient";
import { tbCreateTransfer } from "../tbClient";

export const loanDisbursementRouter = router({
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
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
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  getSummary: protectedProcedure.query(async () => {
    try {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
      const _totalRows = await database
        .select({ total: count() })
        .from(transactions);
      const totalResult = Array.isArray(_totalRows)
        ? _totalRows[0]
        : _totalRows;

      return {
        totalRecords: totalResult?.total ?? 0,
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),

  getRecent: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(7),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ input }) => {
      try {
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
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // ── Sprint 28 domain procedures ──
  list: protectedProcedure.query(async () => {
    return {
      applications: [
        {
          id: "LA-001",
          agentId: "AGT-001",
          amount: 500000,
          status: "disbursed",
          productId: "LP-001",
        },
      ],
      total: 1,
    };
  }),
  products: protectedProcedure.query(async () => {
    return {
      products: [
        {
          id: "LP-001",
          name: "Agent Working Capital",
          maxAmount: 2000000,
          interestRate: 15,
          tenorMonths: 12,
        },
      ],
    };
  }),
  analytics: protectedProcedure.query(async () => {
    return {
      totalApplications: 200,
      totalDisbursed: 50000000,
      activeLoans: 120,
      defaultRate: 2.5,
      avgLoanSize: 400000,
    };
  }),
});
