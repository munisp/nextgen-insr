import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  publicProcedure as openProcedure,
  protectedProcedure,
  router,
} from "../_core/trpc";
import { getDb } from "../db";
import { auditLog } from "@schema";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";

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
  listSessions: openProcedure
    .input(
      z
        .object({
          status: z.string().optional(),
          carrier: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const sessions = [
        {
          sessionId: "SESS-001",
          msisdn: "+2348012345678",
          carrier: "MTN_NG",
          status: "completed",
          startedAt: "2024-06-01T10:00:00Z",
          duration: 45,
          keystrokes: [
            {
              input: "*384#",
              screenText: "Welcome to AgentPOS",
              timestamp: "2024-06-01T10:00:01Z",
            },
            {
              input: "1",
              screenText: "Premium Payment",
              timestamp: "2024-06-01T10:00:10Z",
            },
            {
              input: "50000",
              screenText: "Enter Amount",
              timestamp: "2024-06-01T10:00:20Z",
            },
            {
              input: "1234",
              screenText: "Confirm PIN",
              timestamp: "2024-06-01T10:00:35Z",
            },
          ],
        },
        {
          sessionId: "SESS-002",
          msisdn: "+2348098765432",
          carrier: "MTN_NG",
          status: "completed",
          startedAt: "2024-06-01T11:00:00Z",
          duration: 30,
          keystrokes: [
            {
              input: "*384#",
              screenText: "Welcome to AgentPOS",
              timestamp: "2024-06-01T11:00:01Z",
            },
            {
              input: "2",
              screenText: "Claim Payout",
              timestamp: "2024-06-01T11:00:10Z",
            },
          ],
        },
        {
          sessionId: "SESS-003",
          msisdn: "+2348055555555",
          carrier: "Airtel_NG",
          status: "abandoned",
          startedAt: "2024-06-01T12:00:00Z",
          duration: 15,
          keystrokes: [
            {
              input: "*384#",
              screenText: "Welcome to AgentPOS",
              timestamp: "2024-06-01T12:00:01Z",
            },
          ],
        },
        {
          sessionId: "SESS-004",
          msisdn: "+2348066666666",
          carrier: "Glo_NG",
          status: "completed",
          startedAt: "2024-06-02T09:00:00Z",
          duration: 60,
          keystrokes: [
            {
              input: "*384#",
              screenText: "Welcome to AgentPOS",
              timestamp: "2024-06-02T09:00:01Z",
            },
            {
              input: "3",
              screenText: "Balance",
              timestamp: "2024-06-02T09:00:10Z",
            },
          ],
        },
      ];
      let filtered = sessions;
      if (input?.status)
        filtered = filtered.filter(s => s.status === input.status);
      if (input?.carrier)
        filtered = filtered.filter(s => s.carrier === input.carrier);
      return { sessions: filtered, total: filtered.length };
    }),

  getSession: openProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      const sessions: Record<
        string,
        {
          sessionId: string;
          msisdn: string;
          carrier: string;
          status: string;
          startedAt: string;
          duration: number;
          keystrokes: Array<{
            input: string;
            screenText: string;
            timestamp: string;
          }>;
        }
      > = {
        "SESS-001": {
          sessionId: "SESS-001",
          msisdn: "+2348012345678",
          carrier: "MTN_NG",
          status: "completed",
          startedAt: "2024-06-01T10:00:00Z",
          duration: 45,
          keystrokes: [
            {
              input: "*384#",
              screenText: "Welcome to AgentPOS",
              timestamp: "2024-06-01T10:00:01Z",
            },
            {
              input: "1",
              screenText: "Premium Payment",
              timestamp: "2024-06-01T10:00:10Z",
            },
            {
              input: "50000",
              screenText: "Enter Amount",
              timestamp: "2024-06-01T10:00:20Z",
            },
            {
              input: "1234",
              screenText: "Confirm PIN",
              timestamp: "2024-06-01T10:00:35Z",
            },
          ],
        },
        "SESS-002": {
          sessionId: "SESS-002",
          msisdn: "+2348098765432",
          carrier: "MTN_NG",
          status: "completed",
          startedAt: "2024-06-01T11:00:00Z",
          duration: 30,
          keystrokes: [
            {
              input: "*384#",
              screenText: "Welcome to AgentPOS",
              timestamp: "2024-06-01T11:00:01Z",
            },
            {
              input: "2",
              screenText: "Claim Payout",
              timestamp: "2024-06-01T11:00:10Z",
            },
          ],
        },
      };
      const session = sessions[input.sessionId];
      if (!session)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      return session;
    }),

  replaySession: openProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      const sessions: Record<
        string,
        {
          keystrokes: Array<{
            input: string;
            screenText: string;
            timestamp: string;
          }>;
        }
      > = {
        "SESS-001": {
          keystrokes: [
            {
              input: "*384#",
              screenText: "Welcome to AgentPOS",
              timestamp: "2024-06-01T10:00:01Z",
            },
            {
              input: "1",
              screenText: "Premium Payment",
              timestamp: "2024-06-01T10:00:10Z",
            },
            {
              input: "50000",
              screenText: "Enter Amount",
              timestamp: "2024-06-01T10:00:20Z",
            },
            {
              input: "1234",
              screenText: "Confirm PIN",
              timestamp: "2024-06-01T10:00:35Z",
            },
          ],
        },
      };
      const session = sessions[input.sessionId];
      if (!session)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      return {
        totalSteps: session.keystrokes.length,
        keystrokes: session.keystrokes,
      };
    }),

  getAnalytics: openProcedure.query(async () => {
    return {
      totalSessions: 4,
      completionRate: 75,
      avgDuration: 37.5,
      dropOffScreens: [
        { screen: "Enter Amount", dropOffs: 12, percentage: 15 },
        { screen: "Confirm PIN", dropOffs: 8, percentage: 10 },
        { screen: "Welcome", dropOffs: 5, percentage: 6.25 },
      ],
    };
  }),
});
