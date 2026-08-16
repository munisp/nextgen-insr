import { TRPCError } from "@trpc/server";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";
import { z } from "zod";

import { auditLog } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";


// MOCKWARE FIX: The Sprint 78 endpoints previously returned fabricated USSD
// sessions with canned keystrokes over openProcedure. No USSD session replay
// store exists in the schema, so session queries now return honest empty
// results, single-session lookups fail loudly, and all endpoints require
// authentication.

export const ussdSessionReplayRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
      const results = await database
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.id))
        .limit(input.limit)
        .offset(input.offset);

      const [totalResult] = await database
        .select({ total: count() })
        .from(auditLog);

      return {
        data: results,
        total: totalResult?.total ?? 0,
        limit: input.limit,
        offset: input.offset,
      };
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
    const [totalResult] = await database
      .select({ total: count() })
      .from(auditLog);

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

  // ── Sprint 78 domain-specific procedures ──────────────────────────────────
  listSessions: protectedProcedure
    .input(
      z
        .object({
          status: z.string().optional(),
          carrier: z.string().optional(),
        })
        .optional()
    )
    .query(async () => {
      // No USSD session replay store exists in the schema — honest empty.
      return { sessions: [] as any[], total: 0 };
    }),

  getSession: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `USSD session ${input.sessionId} not found: no session replay store is configured`,
      });
    }),

  replaySession: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `USSD session ${input.sessionId} not found: no session replay store is configured`,
      });
    }),

  getAnalytics: protectedProcedure.query(async () => {
    // Honest zero analytics — no USSD sessions have been recorded.
    return {
      totalSessions: 0,
      completionRate: 0,
      avgDuration: 0,
      dropOffScreens: [] as Array<{
        screen: string;
        dropOffs: number;
        percentage: number;
      }>,
    };
  }),
});
