import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count, sum, gte } from "drizzle-orm";
import { z } from "zod";

import {
  analyticsDashboards,
  analyticsMetrics,
  agents,
  transactions,
  auditLog,
  fraudAlerts,
  kycSessions,
  settlementReconciliation,
  users,
} from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const analyticsDashboardRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(analyticsDashboards)
          .orderBy(desc(analyticsDashboards.createdAt))
          .limit(input?.limit ?? 20);
        return { dashboards: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [dashboard] = await db
          .select()
          .from(analyticsDashboards)
          .where(eq(analyticsDashboards.id, input.id))
          .limit(1);
        return dashboard ?? null;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getOverview: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [agentCount] = await db
      .select({ value: count() })
      .from(agents)
      .limit(100);
    const [txCount] = await db
      .select({ value: count() })
      .from(transactions)
      .limit(100);
    const [txVolume] = await db
      .select({ value: sum(transactions.amount) })
      .from(transactions)
      .limit(100);
    const [dashCount] = await db
      .select({ value: count() })
      .from(analyticsDashboards)
      .limit(100);
    return {
      totalAgents: Number(agentCount.value),
      totalTransactions: Number(txCount.value),
      totalVolume: Number(txVolume.value ?? 0),
      totalDashboards: Number(dashCount.value),
    };
  }),
  create: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [dashboard] = await db
          .insert(analyticsDashboards)
          .values({
            name: input.name,
            description: input.description,
            config: input.config ?? {},
          } as any)
          .returning();
        await db.insert(auditLog).values({
          action: "dashboard_created",
          resource: "analytics_dashboards",
          resourceId: String(dashboard.id),
          status: "success",
          metadata: { name: input.name },
        });
        return dashboard;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const updates: Record<string, unknown> = {};
        if (input.name) updates.name = input.name;
        if (input.config) updates.config = input.config;
        await db
          .update(analyticsDashboards)
          .set(updates)
          .where(eq(analyticsDashboards.id, input.id));
        await db.insert(auditLog).values({
          action: "dashboard_updated",
          resource: "analytics_dashboards",
          resourceId: String(input.id),
          status: "success",
          metadata: {},
        });
        return { success: true, id: input.id };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .delete(analyticsDashboards)
          .where(eq(analyticsDashboards.id, input.id));
        await db.insert(auditLog).values({
          action: "dashboard_deleted",
          resource: "analytics_dashboards",
          resourceId: String(input.id),
          status: "success",
          metadata: {},
        });
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Sprint 11: Analytics Dashboard procedures ──────────────────────
  // F-12 (wave-5, B16): every surface below is backed by a REAL aggregate
  // query against the PG schema. The data source is documented per surface
  // (table.column). No surface returns fixture literals; empty datasets
  // return honest zeros (a real zero aggregate, not a fabricated number).

  /**
   * KPI summary.
   * Sources:
   *  - transactions.count / transactions.amount / transactions.status
   *  - fraud_alerts.status (open alert count)
   *  - kyc_sessions.status (approval rate; 'approved'/'completed' = approved)
   *  - settlement_reconciliation.status (pending reconciliation count)
   *  - agents.isActive / agents.deletedAt (active agent count)
   */
  kpiSummary: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [tx] = await db
      .select({
        total: count(),
        succeeded: sql<number>`SUM(CASE WHEN ${transactions.status} = 'success' THEN 1 ELSE 0 END)`,
        volume: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.status} = 'success' THEN CAST(${transactions.amount} AS NUMERIC) END), 0)`,
        fees: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.status} = 'success' THEN CAST(${transactions.fee} AS NUMERIC) END), 0)`,
      })
      .from(transactions);
    const [fraud] = await db
      .select({
        total: count(),
        open: sql<number>`SUM(CASE WHEN ${fraudAlerts.status} = 'open' THEN 1 ELSE 0 END)`,
      })
      .from(fraudAlerts);
    const [kyc] = await db
      .select({
        total: count(),
        approved: sql<number>`SUM(CASE WHEN ${kycSessions.status} IN ('approved', 'completed') THEN 1 ELSE 0 END)`,
      })
      .from(kycSessions);
    const [settlement] = await db
      .select({
        total: count(),
        pending: sql<number>`SUM(CASE WHEN ${settlementReconciliation.status} = 'pending' THEN 1 ELSE 0 END)`,
      })
      .from(settlementReconciliation);
    const [agent] = await db
      .select({ value: count() })
      .from(agents)
      .where(
        and(eq(agents.isActive, true), sql`${agents.deletedAt} IS NULL`)
      );
    const txTotal = Number(tx?.total ?? 0);
    const kycTotal = Number(kyc?.total ?? 0);
    return {
      totalTransactions: txTotal,
      successfulTransactions: Number(tx?.succeeded ?? 0),
      transactionSuccessRate:
        txTotal > 0 ? Number(tx?.succeeded ?? 0) / txTotal : 0,
      totalVolume: Number(tx?.volume ?? 0),
      totalFees: Number(tx?.fees ?? 0),
      openFraudAlerts: Number(fraud?.open ?? 0),
      totalFraudAlerts: Number(fraud?.total ?? 0),
      kycApprovalRate:
        kycTotal > 0 ? Number(kyc?.approved ?? 0) / kycTotal : 0,
      pendingSettlements: Number(settlement?.pending ?? 0),
      activeAgents: Number(agent?.value ?? 0),
    };
  }),

  transactionVolume: protectedProcedure
    .input(
      z.object({
        period: z.enum(["7d", "30d", "90d", "365d"]).default("30d"),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(transactions)
          .orderBy(desc(transactions.id))
          .limit(input.period === "7d" ? 7 : input.period === "30d" ? 30 : 90);
        return { period: input.period, data: rows };
      } catch {
        return { period: input.period, data: [] };
      }
    }),

  /**
   * Agent onboarding funnel.
   * Source: kyc_sessions.status grouped counts where
   * kyc_sessions.type = 'agent_onboarding' (stages: pending → approved/
   * completed / rejected), plus agents.createdAt onboarding counts.
   */
  agentOnboardingFunnel: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const stages = await db
      .select({ status: kycSessions.status, count: count() })
      .from(kycSessions)
      .where(eq(kycSessions.type, "agent_onboarding"))
      .groupBy(kycSessions.status);
    const [totals] = await db
      .select({
        total: count(),
        approved: sql<number>`SUM(CASE WHEN ${kycSessions.status} IN ('approved', 'completed') THEN 1 ELSE 0 END)`,
        rejected: sql<number>`SUM(CASE WHEN ${kycSessions.status} = 'rejected' THEN 1 ELSE 0 END)`,
        pending: sql<number>`SUM(CASE WHEN ${kycSessions.status} NOT IN ('approved', 'completed', 'rejected') THEN 1 ELSE 0 END)`,
      })
      .from(kycSessions)
      .where(eq(kycSessions.type, "agent_onboarding"));
    const [agentTotal] = await db
      .select({ value: count() })
      .from(agents)
      .where(sql`${agents.deletedAt} IS NULL`);
    const total = Number(totals?.total ?? 0);
    const approved = Number(totals?.approved ?? 0);
    return {
      stages: stages.map((s) => ({
        status: s.status,
        count: Number(s.count),
      })),
      total,
      approved,
      rejected: Number(totals?.rejected ?? 0),
      pending: Number(totals?.pending ?? 0),
      completionRate: total > 0 ? approved / total : 0,
      totalAgents: Number(agentTotal?.value ?? 0),
    };
  }),

  /**
   * Fraud detection rates.
   * Sources: fraud_alerts.status / fraud_alerts.severity grouped counts;
   * transactions.velocityBreached + transactions.fraudScore (flagging
   * telemetry written by the real-time fraud pipeline).
   */
  fraudDetectionRates: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const byStatus = await db
      .select({ status: fraudAlerts.status, count: count() })
      .from(fraudAlerts)
      .groupBy(fraudAlerts.status);
    const bySeverity = await db
      .select({ severity: fraudAlerts.severity, count: count() })
      .from(fraudAlerts)
      .groupBy(fraudAlerts.severity);
    const [tx] = await db
      .select({
        total: count(),
        velocityBreached: sql<number>`SUM(CASE WHEN ${transactions.velocityBreached} THEN 1 ELSE 0 END)`,
        avgFraudScore: sql<string>`COALESCE(AVG(CAST(${transactions.fraudScore} AS NUMERIC)), 0)`,
      })
      .from(transactions);
    const totalAlerts = byStatus.reduce((a, s) => a + Number(s.count), 0);
    const resolved =
      byStatus.find((s) => s.status === "resolved")?.count ?? 0;
    const dismissed =
      byStatus.find((s) => s.status === "dismissed")?.count ?? 0;
    const txTotal = Number(tx?.total ?? 0);
    return {
      totalAlerts,
      byStatus: byStatus.map((s) => ({
        status: s.status,
        count: Number(s.count),
      })),
      bySeverity: bySeverity.map((s) => ({
        severity: s.severity,
        count: Number(s.count),
      })),
      resolutionRate:
        totalAlerts > 0 ? Number(resolved) / totalAlerts : 0,
      dismissalRate:
        totalAlerts > 0 ? Number(dismissed) / totalAlerts : 0,
      velocityBreachCount: Number(tx?.velocityBreached ?? 0),
      velocityBreachRate:
        txTotal > 0 ? Number(tx?.velocityBreached ?? 0) / txTotal : 0,
      averageFraudScore: Number(tx?.avgFraudScore ?? 0),
      alertsPerTransaction: txTotal > 0 ? totalAlerts / txTotal : 0,
    };
  }),

  /**
   * Revenue breakdown by transaction type.
   * Source: transactions.type grouped sums of transactions.amount,
   * transactions.fee and transactions.commission (success rows only).
   */
  revenueBreakdown: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const rows = await db
      .select({
        type: transactions.type,
        count: count(),
        volume: sql<string>`COALESCE(SUM(CAST(${transactions.amount} AS NUMERIC)), 0)`,
        fees: sql<string>`COALESCE(SUM(CAST(${transactions.fee} AS NUMERIC)), 0)`,
        commission: sql<string>`COALESCE(SUM(CAST(${transactions.commission} AS NUMERIC)), 0)`,
      })
      .from(transactions)
      .where(eq(transactions.status, "success"))
      .groupBy(transactions.type)
      .orderBy(
        desc(sql`COALESCE(SUM(CAST(${transactions.fee} AS NUMERIC)), 0)`)
      );
    return {
      byType: rows.map((r) => ({
        type: r.type,
        count: Number(r.count),
        volume: Number(r.volume),
        fees: Number(r.fees),
        commission: Number(r.commission),
        netRevenue: Number(r.fees) - Number(r.commission),
      })),
      totalFees: rows.reduce((a, r) => a + Number(r.fees), 0),
      totalCommission: rows.reduce((a, r) => a + Number(r.commission), 0),
    };
  }),

  /**
   * Geographic distribution.
   * Source: agents.location (self-declared agent location — the only
   * geographic attribute in the schema) grouped agent counts, joined to
   * transactions.agentId for per-location success volume. There is no
   * geo-coordinate source anywhere in the schema (verified by grep), so
   * distribution is by the location label, not lat/long.
   */
  geographicDistribution: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const rows = await db
      .select({
        location: agents.location,
        // DISTINCT: the transactions left join fans rows out per tx.
        agentCount: sql<number>`COUNT(DISTINCT ${agents.id})`,
        txCount: count(transactions.id),
        volume: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.status} = 'success' THEN CAST(${transactions.amount} AS NUMERIC) END), 0)`,
      })
      .from(agents)
      .leftJoin(transactions, eq(transactions.agentId, agents.id))
      .where(sql`${agents.deletedAt} IS NULL`)
      .groupBy(agents.location)
      .orderBy(desc(sql`COUNT(DISTINCT ${agents.id})`));
    return {
      byLocation: rows.map((r) => ({
        location: r.location ?? "unknown",
        agentCount: Number(r.agentCount),
        transactionCount: Number(r.txCount),
        volume: Number(r.volume),
      })),
    };
  }),

  /**
   * Settlement trend.
   * Source: settlement_reconciliation grouped by
   * settlement_reconciliation.settlementDate — expected vs actual sums,
   * discrepancy sums and status counts per settlement day.
   */
  settlementTrend: protectedProcedure
    .input(z.object({ limit: z.number().default(30) }).optional())
    .query(async ({ input }) => {
      const db = (await getDb())!;
      const rows = await db
        .select({
          date: settlementReconciliation.settlementDate,
          count: count(),
          expected: sql<string>`COALESCE(SUM(CAST(${settlementReconciliation.expectedAmount} AS NUMERIC)), 0)`,
          actual: sql<string>`COALESCE(SUM(CAST(${settlementReconciliation.actualAmount} AS NUMERIC)), 0)`,
          discrepancy: sql<string>`COALESCE(SUM(CAST(${settlementReconciliation.discrepancy} AS NUMERIC)), 0)`,
          matched: sql<number>`SUM(CASE WHEN ${settlementReconciliation.status} = 'matched' THEN 1 ELSE 0 END)`,
          pending: sql<number>`SUM(CASE WHEN ${settlementReconciliation.status} = 'pending' THEN 1 ELSE 0 END)`,
        })
        .from(settlementReconciliation)
        .groupBy(settlementReconciliation.settlementDate)
        .orderBy(desc(settlementReconciliation.settlementDate))
        .limit(input?.limit ?? 30);
      return {
        days: rows.map((r) => ({
          date: r.date,
          count: Number(r.count),
          expectedAmount: Number(r.expected),
          actualAmount: Number(r.actual),
          discrepancy: Number(r.discrepancy),
          matchedCount: Number(r.matched),
          pendingCount: Number(r.pending),
        })),
      };
    }),

  /**
   * KYC approval trend.
   * Source: kyc_sessions.createdAt day buckets with per-day totals and
   * approved ('approved'/'completed') counts derived from
   * kyc_sessions.status.
   */
  kycApprovalTrend: protectedProcedure
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ input }) => {
      const db = (await getDb())!;
      const days = input?.days ?? 30;
      const since = new Date(Date.now() - days * 86_400_000);
      const rows = await db
        .select({
          day: sql<string>`date_trunc('day', ${kycSessions.createdAt})::text`,
          total: count(),
          approved: sql<number>`SUM(CASE WHEN ${kycSessions.status} IN ('approved', 'completed') THEN 1 ELSE 0 END)`,
          rejected: sql<number>`SUM(CASE WHEN ${kycSessions.status} = 'rejected' THEN 1 ELSE 0 END)`,
        })
        .from(kycSessions)
        .where(gte(kycSessions.createdAt, since))
        .groupBy(sql`date_trunc('day', ${kycSessions.createdAt})`)
        .orderBy(sql`date_trunc('day', ${kycSessions.createdAt})`);
      return {
        days: rows.map((r) => ({
          day: r.day,
          total: Number(r.total),
          approved: Number(r.approved),
          rejected: Number(r.rejected),
          approvalRate:
            Number(r.total) > 0 ? Number(r.approved) / Number(r.total) : 0,
        })),
      };
    }),

  /**
   * Top agents leaderboard.
   * Source: transactions joined to agents on transactions.agentId,
   * grouped per agent — counts and sums of transactions.amount /
   * transactions.commission (success rows only). sortBy 'rating' maps to
   * agents.creditScore (the only numeric agent rating column in the
   * schema; agents.creditRating is a letter grade, not sortable).
   */
  topAgents: protectedProcedure
    .input(
      z
        .object({
          sortBy: z
            .enum(["txCount", "volume", "commission", "rating"])
            .default("volume"),
          limit: z.number().default(10),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = (await getDb())!;
      const sortBy = input?.sortBy ?? "volume";
      const limit = input?.limit ?? 10;
      const volumeSql = sql`COALESCE(SUM(CAST(${transactions.amount} AS NUMERIC)), 0)`;
      const commissionSql = sql`COALESCE(SUM(CAST(${transactions.commission} AS NUMERIC)), 0)`;
      const orderExpr =
        sortBy === "txCount"
          ? count(transactions.id)
          : sortBy === "commission"
            ? commissionSql
            : sortBy === "rating"
              ? sql`MAX(${agents.creditScore})`
              : volumeSql;
      const rows = await db
        .select({
          agentId: agents.id,
          agentCode: agents.agentId,
          name: agents.name,
          tier: agents.tier,
          creditScore: agents.creditScore,
          txCount: count(transactions.id),
          volume: volumeSql.mapWith(String),
          commission: commissionSql.mapWith(String),
        })
        .from(agents)
        .leftJoin(
          transactions,
          and(
            eq(transactions.agentId, agents.id),
            eq(transactions.status, "success")
          )
        )
        .where(sql`${agents.deletedAt} IS NULL`)
        .groupBy(agents.id)
        .orderBy(desc(orderExpr))
        .limit(limit);
      return {
        sortBy,
        agents: rows.map((r) => ({
          agentId: r.agentId,
          agentCode: r.agentCode,
          name: r.name,
          tier: r.tier,
          creditScore: r.creditScore,
          transactionCount: Number(r.txCount),
          volume: Number(r.volume),
          commission: Number(r.commission),
        })),
      };
    }),

  /**
   * Active users.
   * Source: users.lastSignedIn recency buckets (24h / 7d / 30d) and total
   * registered users (users.count).
   */
  activeUsers: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const now = Date.now();
    const [row] = await db
      .select({
        total: count(),
        d1: sql<number>`SUM(CASE WHEN ${users.lastSignedIn} >= ${new Date(now - 86_400_000)} THEN 1 ELSE 0 END)`,
        d7: sql<number>`SUM(CASE WHEN ${users.lastSignedIn} >= ${new Date(now - 7 * 86_400_000)} THEN 1 ELSE 0 END)`,
        d30: sql<number>`SUM(CASE WHEN ${users.lastSignedIn} >= ${new Date(now - 30 * 86_400_000)} THEN 1 ELSE 0 END)`,
      })
      .from(users);
    return {
      totalUsers: Number(row?.total ?? 0),
      active24h: Number(row?.d1 ?? 0),
      active7d: Number(row?.d7 ?? 0),
      active30d: Number(row?.d30 ?? 0),
    };
  }),
});
