/**
 * weeklyReports.ts — B7: weekly report document engine (REAL generation).
 *
 * generateWeeklyReport (admin) computes report sections from REAL rows via
 * server/lib/weeklyReport.ts (transactions / premiums / claims / policies /
 * agents — data sources documented per section in the lib) and persists the
 * document in generated_reports (migration 0054). getWeeklyReport /
 * listWeeklyReports / latest read that catalog.
 *
 * The legacy transaction-row listing procedures (list / getById / getSummary /
 * getRecent) are unchanged — they already answered from the real transactions
 * table. Email delivery / scheduling / recipients still have NO delivered
 * data source and continue to FAIL LOUD with NOT_IMPLEMENTED.
 *
 * Nothing here invents numbers: requested sections with no data source are
 * recorded in the report with an explicit 'no_data_source' marker.
 */
import { TRPCError } from "@trpc/server";
import { desc, eq, sql, count } from "drizzle-orm";
import { z } from "zod";

import { transactions } from "../../drizzle/schema";
import { generatedReports } from "../../drizzle/schema.additions";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  computeWeeklyReportSections,
  defaultWeekWindow,
} from "../lib/weeklyReport";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

function requireDb(db: Db | null): Db {
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database unavailable",
    });
  }
  return db;
}

const notImplemented = (feature: string) =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: `${feature} is not implemented yet`,
  });

const weekWindowInput = z.object({
  weekStart: z.coerce.date().optional(),
  weekEnd: z.coerce.date().optional(),
  sections: z.array(z.string().min(1).max(64)).max(32).optional(),
});

async function generateReport(
  db: Db,
  userId: number | null,
  input: z.infer<typeof weekWindowInput>
) {
  const window =
    input.weekStart && input.weekEnd
      ? { weekStart: input.weekStart, weekEnd: input.weekEnd }
      : input.weekStart || input.weekEnd
        ? (() => {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "weekStart and weekEnd must be supplied together (or neither, for the last complete ISO week)",
            });
          })()
        : defaultWeekWindow(new Date());
  if (!(window.weekStart < window.weekEnd)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `weekStart (${window.weekStart.toISOString()}) must be before weekEnd (${window.weekEnd.toISOString()})`,
    });
  }
  const sections = await computeWeeklyReportSections(
    db,
    window.weekStart,
    window.weekEnd,
    input.sections
  );
  const [row] = await db
    .insert(generatedReports)
    .values({
      weekStart: window.weekStart,
      weekEnd: window.weekEnd,
      generatedBy: userId,
      sectionsJson: sections,
      status: "completed",
    })
    .returning();
  return row;
}

export const weeklyReportsRouter = router({
  // ── B7: real report document engine ──────────────────────────────────────

  /** Admin: compute sections from real data and persist the report document. */
  generateWeeklyReport: adminProcedure
    .input(weekWindowInput)
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      return generateReport(db, ctx.user.id, input);
    }),

  /**
   * Back-compat alias for the client (WeeklyReports.tsx calls
   * weeklyReports.generate): same real generation, admin-gated.
   */
  generate: adminProcedure
    .input(
      z
        .object({
          id: z.union([z.number(), z.string()]).optional(),
          weekStart: z.coerce.date().optional(),
          weekEnd: z.coerce.date().optional(),
          sections: z.array(z.string().min(1).max(64)).max(32).optional(),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      return generateReport(db, ctx.user.id, input ?? {});
    }),

  getWeeklyReport: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = requireDb(await getDb());
      const [row] = await db
        .select()
        .from(generatedReports)
        .where(eq(generatedReports.id, input.id))
        .limit(1);
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `weekly report with id ${input.id} not found`,
        });
      }
      return row;
    }),

  listWeeklyReports: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = requireDb(await getDb());
      const data = await db
        .select()
        .from(generatedReports)
        .orderBy(desc(generatedReports.weekStart), desc(generatedReports.id))
        .limit(input.limit)
        .offset(input.offset);
      const [totalRow] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(generatedReports);
      return {
        data,
        total: Number(totalRow.total),
        limit: input.limit,
        offset: input.offset,
      };
    }),

  /**
   * Latest generated report. Fails loud (PRECONDITION_FAILED) when no report
   * has ever been generated — an empty catalog is honest, a stub is not.
   */
  latest: protectedProcedure.query(async () => {
    const db = requireDb(await getDb());
    const [row] = await db
      .select()
      .from(generatedReports)
      .orderBy(desc(generatedReports.weekStart), desc(generatedReports.id))
      .limit(1);
    if (!row) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "no weekly report has been generated yet — call generateWeeklyReport first",
      });
    }
    return row;
  }),

  // ── Legacy transaction-row listing (already real; unchanged) ─────────────

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
          .from(transactions)
          .orderBy(desc(transactions.id))
          .limit(input.limit)
          .offset(input.offset);

        const _totalRows = await database
          .select({ total: count() })
          .from(transactions);
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

  // ── Undelivered surfaces: still fail loud (no data source exists) ────────

  addRecipient: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented("Weekly report recipients");
    }),

  getEmailConfig: protectedProcedure.query(async () => {
    throw notImplemented("Weekly report email config");
  }),

  getPdfHtml: protectedProcedure.query(async () => {
    throw notImplemented("Weekly report PDF rendering");
  }),

  getSchedule: protectedProcedure.query(async () => {
    throw notImplemented("Weekly report schedule");
  }),

  listRecipients: protectedProcedure.query(async () => {
    throw notImplemented("Weekly report recipient list");
  }),

  removeRecipient: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented("Weekly report recipients");
    }),

  sendEmail: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented("Weekly report email delivery");
    }),

  updateEmailConfig: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented("Weekly report email config");
    }),

  updateSchedule: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented("Weekly report schedule");
    }),
});
