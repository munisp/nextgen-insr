// @ts-check
/**
 * cbnReporting.ts — tRPC router for CBN regulatory reporting
 *
 * Proxies to the Python cbn-reporting-engine microservice and provides
 * direct DB-based report generation for offline/fallback scenarios.
 */
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { transactions, fraudAlerts } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

const CBN_SERVICE_URL =
  process.env.CBN_REPORTING_SERVICE_URL ?? "http://localhost:8010";

async function callCbnService(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown
) {
  try {
    const res = await fetch(`${CBN_SERVICE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": process.env.INTERNAL_API_KEY ?? "internal-key-insureportal",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`CBN service error: ${res.status}`);
    return res.json();
  } catch {
    return null;
  }
}

async function generateMonthlyReportFromDb(
  year: number,
  month: number,
  institutionCode: string
) {
  const db = (await getDb())!;
  if (!db) throw new Error("Database connection unavailable");
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59);
  const txStats = await db.execute(sql`
    SELECT COUNT(*) AS total_transactions,
      COUNT(*) FILTER (WHERE status = 'completed') AS successful,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      COUNT(*) FILTER (WHERE status = 'reversed') AS reversed,
      COALESCE(SUM(CAST(amount AS NUMERIC)) FILTER (WHERE status = 'completed'), 0) AS total_volume,
      COALESCE(SUM(CAST(COALESCE(fee, '0') AS NUMERIC)) FILTER (WHERE status = 'completed'), 0) AS total_fees,
      COALESCE(SUM(CAST(COALESCE(commission, '0') AS NUMERIC)) FILTER (WHERE status = 'completed'), 0) AS total_commission,
      COUNT(DISTINCT "agentId") AS active_agents
    FROM transactions WHERE "createdAt" BETWEEN ${from} AND ${to}
  `);
  const byType = await db.execute(sql`
    SELECT type, COUNT(*) AS count, COALESCE(SUM(CAST(amount AS NUMERIC)), 0) AS volume
    FROM transactions WHERE "createdAt" BETWEEN ${from} AND ${to} AND status = 'completed'
    GROUP BY type ORDER BY volume DESC
  `);
  const r = txStats.rows[0] as Record<string, string>;
  return {
    reportType: "monthly_activity",
    period: `${year}-${String(month).padStart(2, "0")}`,
    institutionCode,
    generatedAt: new Date().toISOString(),
    summary: {
      totalTransactions: parseInt(r.total_transactions ?? "0", 10),
      successful: parseInt(r.successful ?? "0", 10),
      failed: parseInt(r.failed ?? "0", 10),
      reversed: parseInt(r.reversed ?? "0", 10),
      totalVolume: parseFloat(r.total_volume ?? "0"),
      totalFees: parseFloat(r.total_fees ?? "0"),
      totalCommission: parseFloat(r.total_commission ?? "0"),
      activeAgents: parseInt(r.active_agents ?? "0", 10),
    },
    byType: byType.rows,
    status: "generated",
    cbnReference: null,
  };
}

async function generateQuarterlyFraudReportFromDb(
  year: number,
  quarter: number,
  institutionCode: string
) {
  const db = (await getDb())!;
  if (!db) throw new Error("Database connection unavailable");
  const quarterStart = new Date(year, (quarter - 1) * 3, 1);
  const quarterEnd = new Date(year, quarter * 3, 0, 23, 59, 59);
  const fraudStats = await db.execute(sql`
    SELECT COUNT(*) AS total_alerts,
      COUNT(*) FILTER (WHERE status = 'resolved') AS resolved,
      COUNT(*) FILTER (WHERE status = 'open') AS open_alerts,
      COUNT(*) FILTER (WHERE status = 'escalated') AS escalated,
      COALESCE(SUM(CAST(COALESCE(amount, '0') AS NUMERIC)), 0) AS total_fraud_amount,
      COUNT(DISTINCT "agentId") AS agents_flagged
    FROM fraud_alerts WHERE "createdAt" BETWEEN ${quarterStart} AND ${quarterEnd}
  `);
  const r = fraudStats.rows[0] as Record<string, string>;
  return {
    reportType: "quarterly_fraud",
    period: `${year}-Q${quarter}`,
    institutionCode,
    generatedAt: new Date().toISOString(),
    summary: {
      totalAlerts: parseInt(r.total_alerts ?? "0", 10),
      resolved: parseInt(r.resolved ?? "0", 10),
      openAlerts: parseInt(r.open_alerts ?? "0", 10),
      escalated: parseInt(r.escalated ?? "0", 10),
      totalFraudAmount: parseFloat(r.total_fraud_amount ?? "0"),
      agentsFlagged: parseInt(r.agents_flagged ?? "0", 10),
    },
    status: "generated",
    cbnReference: null,
  };
}

export const cbnReportingRouter = router({
  // ── Generate Monthly Activity Report ──────────────────────────────────────
  // F-12 (wave-4b): zero-payload generateMonthlyReport — the CBN reporting pipeline
  // for this proc is not delivered. Fail loud.
  generateMonthlyReport: protectedProcedure.mutation(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "generateMonthlyReport: the CBN reporting pipeline is not delivered",
    });
  }),

  // ── Generate Quarterly Fraud Report ───────────────────────────────────────
  // F-12 (wave-4b): zero-payload generateQuarterlyFraudReport — the CBN reporting pipeline
  // for this proc is not delivered. Fail loud.
  generateQuarterlyFraudReport: protectedProcedure.mutation(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "generateQuarterlyFraudReport: the CBN reporting pipeline is not delivered",
    });
  }),

  // ── File SAR ──────────────────────────────────────────────────────────────
  // F-12 (wave-4b): zero-payload fileSar — the CBN reporting pipeline
  // for this proc is not delivered. Fail loud.
  fileSar: protectedProcedure.mutation(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "fileSar: the CBN reporting pipeline is not delivered",
    });
  }),

  // ── Get pending submissions ────────────────────────────────────────────────
  // F-12 (S87-02): the dashboard's aggregate filing counts. Real source is the
  // CBN reporting service (CAT-A Go service); when it is not reachable the
  // procedure returns null (honest) rather than fixture counts.
  // F-12 (wave-4b): zero-payload summary — the CBN reporting pipeline
  // for this proc is not delivered. Fail loud.
  summary: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "summary: the CBN reporting pipeline is not delivered",
    });
  }),

  // F-12 (wave-4b): zero-payload getPendingSubmissions — the CBN reporting pipeline
  // for this proc is not delivered. Fail loud.
  getPendingSubmissions: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getPendingSubmissions: the CBN reporting pipeline is not delivered",
    });
  }),

  // ── Mark report as submitted ───────────────────────────────────────────────
  // F-12 (wave-4b): zero-payload markSubmitted — the CBN reporting pipeline
  // for this proc is not delivered. Fail loud.
  markSubmitted: protectedProcedure.mutation(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "markSubmitted: the CBN reporting pipeline is not delivered",
    });
  }),

  // ── Health check ──────────────────────────────────────────────────────────
  // F-12 (wave-4b): zero-payload health — the CBN reporting pipeline
  // for this proc is not delivered. Fail loud.
  health: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "health: the CBN reporting pipeline is not delivered",
    });
  }),

  // ── Compliance dashboard ──────────────────────────────────────────────────
  complianceDashboard: protectedProcedure
    .input(
      z.object({
        year: z
          .number()
          .int()
          .min(2020)
          .max(2100)
          .default(() => new Date().getFullYear()),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          return {
            year: input.year,
            monthlyStats: [],
            totalSars: 0,
            pendingSubmissions: 0,
          };
        const yearStart = new Date(input.year, 0, 1);
        const yearEnd = new Date(input.year, 11, 31, 23, 59, 59);
        const monthlyStats = await db.execute(sql`
          SELECT EXTRACT(MONTH FROM "createdAt") AS month, COUNT(*) AS tx_count,
            COALESCE(SUM(CAST(amount AS NUMERIC)) FILTER (WHERE status = 'completed'), 0) AS volume,
            COUNT(*) FILTER (WHERE status = 'completed') AS successful
          FROM transactions WHERE "createdAt" BETWEEN ${yearStart} AND ${yearEnd}
          GROUP BY month ORDER BY month
        `);
        const sarCount = await db.execute(sql`
          SELECT COUNT(*) AS sar_count FROM transactions
          WHERE "createdAt" BETWEEN ${yearStart} AND ${yearEnd}
            AND CAST(amount AS NUMERIC) >= 5000000 AND status = 'completed'
        `);
        const sarRow = sarCount.rows[0] as Record<string, string>;
        return {
          year: input.year,
          monthlyStats: (
            monthlyStats.rows as Array<Record<string, string>>
          ).map(r => ({
            month: parseInt(r.month, 10),
            txCount: parseInt(r.tx_count, 10),
            volume: parseFloat(r.volume),
            successful: parseInt(r.successful, 10),
          })),
          totalSars: parseInt(sarRow.sar_count ?? "0", 10),
          pendingSubmissions: 0,
          nextReportDue: new Date(
            input.year,
            new Date().getMonth() + 1,
            10
          ).toISOString(),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().default(20),
          offset: z.number().default(0),
        })
        .default({ limit: 20, offset: 0 })
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { items: [], total: 0 };
        return { items: [], total: 0 };
      } catch {
        return { items: [], total: 0 };
      }
    }),
});
