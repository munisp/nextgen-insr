import { TRPCError } from "@trpc/server";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";
import { z } from "zod";

import { auditLog, transactions } from "../../drizzle/schema";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import {
  createSession,
  handleCallback,
  listSessions,
  getStats,
} from "../adapters/ussdGatewayAdapter";
import { getDb } from "../db";

// MOCKWARE FIX: processInput previously returned a canned menu and the
// session/transaction/analytics endpoints returned hardcoded data. Session
// handling is now wired to the real Go ussd-gateway via ussdGatewayAdapter
// and fails loudly when the gateway is unreachable; transactions are read
// from the real transactions table; analytics come from the gateway or are
// honest zeros.

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
  // Telco-facing USSD callback: forwarded to the real Go ussd-gateway.
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
      let sessionId = input.sessionId;
      if (!sessionId) {
        const created = await createSession(input.phoneNumber, "*384#");
        if (!created.success || !created.data) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `USSD gateway unavailable: ${created.error ?? "no response"}`,
          });
        }
        sessionId = created.data.sessionId;
      }
      const result = await handleCallback(sessionId, input.input);
      if (!result.success || !result.data) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `USSD gateway unavailable: ${result.error ?? "no response"}`,
        });
      }
      return {
        text: result.data.response,
        sessionId,
        agentId: input.agentId,
        end: result.data.endSession,
      };
    }),
  activeSessions: protectedProcedure.query(async () => {
    const result = await listSessions("active");
    if (!result.success || !result.data) {
      // Honest empty — gateway unreachable, no fabricated sessions.
      return {
        sessions: [] as any[],
        total: 0,
        degraded: true,
        error: result.error ?? "USSD gateway unavailable",
      };
    }
    return {
      sessions: result.data,
      total: result.data.length,
      degraded: false,
    };
  }),
  transactions: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { transactions: [], total: 0 };
    const rows = await database
      .select()
      .from(transactions)
      .where(eq(transactions.channel, "USSD"))
      .orderBy(desc(transactions.createdAt))
      .limit(50);
    return { transactions: rows, total: rows.length };
  }),
  menuTree: protectedProcedure.query(async () => {
    // Static menu definition served by the gateway configuration (not
    // runtime state).
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
    const result = await getStats();
    if (!result.success || !result.data) {
      // Honest zeros — gateway unreachable, no fabricated counts.
      return {
        totalTransactions: 0,
        totalAmount: 0,
        activeSessions: 0,
        avgSessionDuration: 0,
        completionRate: 0,
        degraded: true,
        error: result.error ?? "USSD gateway unavailable",
      };
    }
    return {
      totalTransactions: result.data.completedToday ?? 0,
      totalAmount: 0, // gateway does not report amounts
      activeSessions: result.data.activeSessions ?? 0,
      avgSessionDuration: Math.round((result.data.avgDurationMs ?? 0) / 1000),
      completionRate: 0, // not reported by the gateway
      degraded: false,
    };
  }),
});
