// @ts-check

import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { auditLog } from "../../drizzle/schema";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";

export const ussdGatewayRouter = router({
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

  // ── Sprint 28 domain procedures ──
  processInput: publicProcedure
    .input(
      z.object({
        agentId: z.string(),
        phoneNumber: z.string(),
        input: z.string(),
        sessionId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return {
        text: "Welcome to AgentPOS\n1. Cash In\n2. Cash Out\n3. Balance",
        sessionId: input.sessionId || "USSD-" + Date.now(),
        agentId: input.agentId,
        end: false,
      };
    }),
  activeSessions: protectedProcedure.query(async () => {
    return {
      sessions: [
        {
          sessionId: "USSD-001",
          phoneNumber: "08012345678",
          screen: "main_menu",
          startedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    };
  }),
  transactions: protectedProcedure.query(async () => {
    return {
      transactions: [
        {
          id: "TX-001",
          type: "cash_in",
          amount: 50000,
          status: "completed",
          agentId: "AGT001",
        },
      ],
      total: 1,
    };
  }),
  menuTree: protectedProcedure.query(async () => {
    return {
      menuTree: {
        id: "root",
        label: "Main Menu",
        children: [
          { id: "1", label: "Cash In" },
          { id: "2", label: "Cash Out" },
          { id: "3", label: "Balance" },
        ],
      },
    };
  }),
  analytics: protectedProcedure.query(async () => {
    return {
      totalTransactions: 1250,
      totalAmount: 25000000,
      activeSessions: 15,
      avgSessionDuration: 45,
      completionRate: 85,
    };
  }),
});
