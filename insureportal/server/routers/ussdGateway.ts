import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { auditLog } from "@schema";
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
        text: "Welcome to AgentPOS\n1. Premium Payment\n2. Claim Payout\n3. Balance",
        sessionId: input.sessionId || "USSD-" + Date.now(),
        agentId: input.agentId,
        end: false,
      };
    }),
  // DD-LEGACY: previously returned a fabricated session (with a phone
  // number) and a fake completed ₦50,000 premium_payment. Fail loud.
  activeSessions: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message:
        "ussdGateway.activeSessions is not implemented: no USSD session store exists in this service. Previously returned a fabricated session.",
    });
  }),
  transactions: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message:
        "ussdGateway.transactions is not implemented: no USSD transaction store exists in this service. Previously returned a fabricated completed premium payment.",
    });
  }),
  menuTree: protectedProcedure.query(async () => {
    return {
      menuTree: {
        id: "root",
        label: "Main Menu",
        children: [
          { id: "1", label: "Premium Payment" },
          { id: "2", label: "Claim Payout" },
          { id: "3", label: "Balance" },
        ],
      },
    };
  }),
  analytics: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message:
        "ussdGateway.analytics is not implemented: no USSD analytics pipeline exists in this service. Previously returned fabricated figures.",
    });
  }),
});
