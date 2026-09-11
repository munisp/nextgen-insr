import { TRPCError } from "@trpc/server";
import { desc, sql, count, gte } from "drizzle-orm";
import { z } from "zod";

import { transactions } from "../../drizzle/schema";
import { ussdSessionEvents } from "../../drizzle/schema.additions";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

/**
 * USSD Analytics Router
 *
 * B12 (zero-undelivered-scope wave 2c): dashboard + menu heatmap now read
 * REAL telemetry from ussd_session_events — rows captured at the production
 * capture point (ussdGateway.processInput). Every aggregate below is computed
 * from those rows only. When no session has ever been recorded the endpoints
 * FAIL LOUD with PRECONDITION_FAILED 'NO_SESSIONS_YET' — never a fabricated
 * or zero-painted dashboard.
 *
 * Note: ussd_session_events carries no failure signal (a failed gateway call
 * never produces an event), so no failure counts are reported here.
 */
const NO_SESSIONS = () =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "NO_SESSIONS_YET: no ussd_session_events rows recorded — analytics appear once real USSD sessions flow through ussdGateway.processInput",
  });

export const ussdAnalyticsRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(20), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0 };
      const results = await database.select().from(transactions).orderBy(desc(transactions.createdAt)).limit(input.limit).offset(input.offset);
      const [{ total }] = await database.select({ total: count() }).from(transactions);
      return { data: results, total: total ?? 0 };
    }),

  getDashboard: protectedProcedure
    .input(z.object({ days: z.number().min(1).max(90).default(7) }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw NO_SESSIONS();
      const since = new Date(Date.now() - input.days * 86_400_000);
      const startOfToday = new Date();
      startOfToday.setUTCHours(0, 0, 0, 0);

      const [totals] = await database
        .select({
          sessions: sql<string>`COUNT(DISTINCT ${ussdSessionEvents.sessionId})`,
          events: count(),
        })
        .from(ussdSessionEvents);
      const totalSessions = Number(totals?.sessions ?? 0);
      if (totalSessions === 0) throw NO_SESSIONS();

      const [windowed] = await database
        .select({
          sessions: sql<string>`COUNT(DISTINCT ${ussdSessionEvents.sessionId})`,
          events: count(),
          completed: sql<string>`COUNT(DISTINCT CASE WHEN ${ussdSessionEvents.endSession} THEN ${ussdSessionEvents.sessionId} END)`,
        })
        .from(ussdSessionEvents)
        .where(gte(ussdSessionEvents.createdAt, since));

      const [today] = await database
        .select({
          sessions: sql<string>`COUNT(DISTINCT ${ussdSessionEvents.sessionId})`,
          events: count(),
        })
        .from(ussdSessionEvents)
        .where(gte(ussdSessionEvents.createdAt, startOfToday));

      // Real per-day session counts for the requested window.
      const trendRows = await database
        .select({
          day: sql<string>`to_char(date_trunc('day', ${ussdSessionEvents.createdAt}), 'YYYY-MM-DD')`,
          sessions: sql<string>`COUNT(DISTINCT ${ussdSessionEvents.sessionId})`,
        })
        .from(ussdSessionEvents)
        .where(gte(ussdSessionEvents.createdAt, since))
        .groupBy(sql`date_trunc('day', ${ussdSessionEvents.createdAt})`)
        .orderBy(sql`date_trunc('day', ${ussdSessionEvents.createdAt})`);

      // Real session durations (last - first event per session, sessions with
      // 2+ events only); NULL when every session has a single event.
      const durResult = await database.execute(
        sql`SELECT AVG(dur_s) AS avg_seconds FROM (SELECT EXTRACT(EPOCH FROM (MAX(${ussdSessionEvents.createdAt}) - MIN(${ussdSessionEvents.createdAt}))) AS dur_s FROM ${ussdSessionEvents} GROUP BY ${ussdSessionEvents.sessionId} HAVING COUNT(*) > 1) d`
      );
      const durRow = (durResult.rows?.[0] ?? {}) as {
        avg_seconds?: string | null;
      };

      const windowSessions = Number(windowed?.sessions ?? 0);
      const windowCompleted = Number(windowed?.completed ?? 0);
      return {
        windowDays: input.days,
        sessionsToday: Number(today?.sessions ?? 0),
        eventsToday: Number(today?.events ?? 0),
        sessionsInWindow: windowSessions,
        eventsInWindow: Number(windowed?.events ?? 0),
        completedSessionsInWindow: windowCompleted,
        // null (not 0) when no session in the window ended — the rate is
        // then undefined, never painted as 0%.
        completionRate:
          windowSessions > 0
            ? Math.round((windowCompleted / windowSessions) * 1000) / 10
            : null,
        avgSessionDurationSeconds:
          durRow.avg_seconds == null
            ? null
            : Math.round(Number(durRow.avg_seconds)),
        dailyTrend: trendRows.map(r => ({
          day: r.day,
          sessions: Number(r.sessions),
        })),
        allTimeSessions: totalSessions,
        allTimeEvents: Number(totals?.events ?? 0),
      };
    }),

  getMenuHeatmap: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) throw NO_SESSIONS();
    const [{ total }] = await database
      .select({ total: count() })
      .from(ussdSessionEvents);
    if (Number(total ?? 0) === 0) throw NO_SESSIONS();

    // Real menu-path frequencies (cumulative input paths, e.g. "1>2").
    const pathRows = await database
      .select({
        menuPath: ussdSessionEvents.menuPath,
        hits: count(),
      })
      .from(ussdSessionEvents)
      .groupBy(ussdSessionEvents.menuPath)
      .orderBy(desc(count()))
      .limit(50);

    // Real per-input frequencies (which menu options users actually select).
    const inputRows = await database
      .select({
        input: ussdSessionEvents.userInput,
        hits: count(),
      })
      .from(ussdSessionEvents)
      .groupBy(ussdSessionEvents.userInput)
      .orderBy(desc(count()))
      .limit(50);

    return {
      totalEvents: Number(total),
      menuPaths: pathRows.map(r => ({
        menuPath: r.menuPath ?? "",
        hits: Number(r.hits),
      })),
      inputs: inputRows.map(r => ({
        input: r.input ?? "",
        hits: Number(r.hits),
      })),
    };
  }),
});
