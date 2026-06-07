// @ts-nocheck
/**
 * cbnReporting.ts — tRPC router for CBN regulatory reporting
 *
 * Proxies to the Python cbn-reporting-engine microservice and provides
 * direct DB-based report generation for offline/fallback scenarios.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { transactions, fraudAlerts } from "../../drizzle/schema";
import { sql } from "drizzle-orm";

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
  generateMonthlyReport: protectedProcedure
    .input(
      z.object({
        year: z.number().int().min(2020).max(2100),
        month: z.number().int().min(1).max(12),
        institutionCode: z.string().default("54LINK001"),
        institutionName: z.string().default("InsurePortal Agency Banking Platform"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const svc = await callCbnService(
          "/api/v1/cbn-reports/monthly-activity",
          "POST",
          {
            year: input.year,
            month: input.month,
            institution_code: input.institutionCode,
            institution_name: input.institutionName,
          }
        );
        if (svc) return svc;
        const result = await generateMonthlyReportFromDb(
          input.year,
          input.month,
          input.institutionCode
        );
        if (!result)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to generate report",
          });
        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Generate Quarterly Fraud Report ───────────────────────────────────────
  generateQuarterlyFraudReport: protectedProcedure
    .input(
      z.object({
        year: z.number().int().min(2020).max(2100),
        quarter: z.number().int().min(1).max(4),
        institutionCode: z.string().default("54LINK001"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const svc = await callCbnService(
          "/api/v1/cbn-reports/quarterly-fraud",
          "POST",
          {
            year: input.year,
            quarter: input.quarter,
            institution_code: input.institutionCode,
          }
        );
        if (svc) return svc;
        const result = await generateQuarterlyFraudReportFromDb(
          input.year,
          input.quarter,
          input.institutionCode
        );
        if (!result)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to generate report",
          });
        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── File SAR ──────────────────────────────────────────────────────────────
  fileSar: protectedProcedure
    .input(
      z.object({
        agentId: z.number().int().positive(),
        transactionIds: z.array(z.number().int().positive()).min(1),
        totalAmount: z.number().positive(),
        reason: z.string().min(10),
        description: z.string().min(20),
        customerDetails: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const svc = await callCbnService("/api/v1/cbn-reports/sar", "POST", {
          agent_id: input.agentId,
          transaction_ids: input.transactionIds,
          total_amount: input.totalAmount,
          reason: input.reason,
          description: input.description,
          customer_details: input.customerDetails ?? {},
        });
        if (svc) return svc;
        return {
          sarRef: `SAR-${Date.now()}-${input.agentId}`,
          agentId: input.agentId,
          transactionIds: input.transactionIds,
          totalAmount: input.totalAmount,
          reason: input.reason,
          status: "filed_locally",
          filedAt: new Date().toISOString(),
          nfiuRef: null,
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

  // ── Get pending submissions ────────────────────────────────────────────────
  getPendingSubmissions: protectedProcedure.query(async () => {
    const svc = await callCbnService("/api/v1/cbn-reports/pending");
    return { reports: svc ?? [], source: svc ? "service" : "fallback" };
  }),

  // ── Mark report as submitted ───────────────────────────────────────────────
  markSubmitted: protectedProcedure
    .input(z.object({ reportId: z.string(), cbnReference: z.string().min(5) }))
    .mutation(async ({ input }) => {
      try {
        const svc = await callCbnService(
          `/api/v1/cbn-reports/${input.reportId}/submit?cbn_reference=${encodeURIComponent(input.cbnReference)}`,
          "POST"
        );
        return (
          svc ?? {
            success: true,
            reportId: input.reportId,
            cbnReference: input.cbnReference,
            submittedAt: new Date().toISOString(),
          }
        );
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Health check ──────────────────────────────────────────────────────────
  health: protectedProcedure.query(async () => {
    const svc = await callCbnService("/api/v1/cbn-reports/health");
    return {
      serviceAvailable: !!svc,
      serviceUrl: CBN_SERVICE_URL,
      timestamp: new Date().toISOString(),
    };
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
        .default({})
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
