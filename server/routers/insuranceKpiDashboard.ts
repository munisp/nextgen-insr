// @ts-check
/**
 * insuranceKpiDashboard.ts — Role-scoped KPI Dashboard Router
 *
 * Provides real database-backed KPI metrics for every insurance domain role:
 *   - super-admin / admin / supervisor
 *   - underwriter, actuary, claims-adjuster, broker
 *   - reinsurer, policyholder, compliance-officer
 *   - regulator, billing-admin, billing-analyst
 *
 * Each procedure is gated to the correct role(s) and returns only the
 * metrics relevant to that stakeholder's responsibilities.
 *
 * Architecture:
 *   tRPC procedure → PostgreSQL (Drizzle ORM) → Python analytics service
 *                 → TigerBeetle sidecar (ledger balances)
 *                 → Redis (cached real-time counters)
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  policies,
  claims,
  actuarialReserves,
  reinsuranceTreaties,
  reinsuranceCessions,
  glEntries,
  platformBillingLedger,
  complianceChecks,
  agents,
  transactions,
  fraudAlerts,
  customers,
  auditLog,
  users,
  tenants,
  policyRenewals,
} from "../../drizzle/schema";
import {
  premiums,
  underwritingApplications,
  slaBreaches,
  claimsPayments,
  commissions,
} from "../../drizzle/schema.additions";
import {
  sql,
  eq,
  and,
  gte,
  lte,
  desc,
  count,
  sum,
  avg,
  ne,
  isNull,
  isNotNull,
  between,
  inArray,
} from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import logger from "../_core/logger";

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

function requireRole(
  userRole: string | undefined,
  allowed: string[],
  procedureName: string
) {
  if (!userRole || !allowed.includes(userRole)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `${procedureName} requires one of: ${allowed.join(", ")}`,
    });
  }
}

async function fetchPythonAnalytics(
  path: string,
  body?: Record<string, unknown>
) {
  const url =
    (process.env.PYTHON_ANALYTICS_URL ?? "http://localhost:8157") + path;
  try {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.PYTHON_ANALYTICS_TOKEN ?? "dev-token"}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchTigerBeetleLedger(accountIds: string[]) {
  const url =
    (process.env.TB_SIDECAR_URL ?? "http://localhost:8090") +
    "/accounts/balances";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_ids: accountIds }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Router ────────────────────────────────────────────────────────────────────
export const insuranceKpiDashboardRouter = router({
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. PLATFORM-WIDE KPI (super-admin / admin)
  // ═══════════════════════════════════════════════════════════════════════════
  platformKpi: adminProcedure
    .input(z.object({ periodDays: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      requireRole(ctx.user?.role, ["admin", "super-admin"], "platformKpi");
      const db = await getDb();
      if (!db) return null;
      const since = daysAgo(input.periodDays);

      const [policyStats] = await db
        .select({
          total: count(),
          active: sql<number>`COUNT(*) FILTER (WHERE status = 'active')`,
          lapsed: sql<number>`COUNT(*) FILTER (WHERE status = 'lapsed')`,
          newPolicies: sql<number>`COUNT(*) FILTER (WHERE created_at >= ${since.toISOString()})`,
          totalPremium: sql<string>`COALESCE(SUM(CAST(premium_amount AS NUMERIC)), 0)`,
        })
        .from(policies);

      const [claimStats] = await db
        .select({
          total: count(),
          open: sql<number>`COUNT(*) FILTER (WHERE status IN ('reported','investigating','pending_payment'))`,
          settled: sql<number>`COUNT(*) FILTER (WHERE status = 'settled')`,
          totalPaid: sql<string>`COALESCE(SUM(CAST(settlement_amount AS NUMERIC) FILTER (WHERE settlement_amount IS NOT NULL)), 0)`,
          avgCycleHours: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/3600) FILTER (WHERE status = 'settled'), 0)`,
        })
        .from(claims);

      const [agentStats] = await db
        .select({
          total: count(),
          active: sql<number>`COUNT(*) FILTER (WHERE status = 'active')`,
          suspended: sql<number>`COUNT(*) FILTER (WHERE status = 'suspended')`,
        })
        .from(agents);

      const [fraudStats] = await db
        .select({
          total: count(),
          highRisk: sql<number>`COUNT(*) FILTER (WHERE risk_score >= 80)`,
        })
        .from(fraudAlerts)
        .where(gte(fraudAlerts.createdAt, since));

      const [tenantStats] = await db
        .select({ total: count() })
        .from(tenants);

      // Fetch IFRS17 reserves from Python analytics
      const reserves = await fetchPythonAnalytics("/ifrs17/summary");

      return {
        period: { days: input.periodDays, since: since.toISOString() },
        policies: {
          total: Number(policyStats?.total ?? 0),
          active: Number(policyStats?.active ?? 0),
          lapsed: Number(policyStats?.lapsed ?? 0),
          newThisPeriod: Number(policyStats?.newPolicies ?? 0),
          totalPremiumInForce: Number(policyStats?.totalPremium ?? 0),
        },
        claims: {
          total: Number(claimStats?.total ?? 0),
          open: Number(claimStats?.open ?? 0),
          settled: Number(claimStats?.settled ?? 0),
          totalPaid: Number(claimStats?.totalPaid ?? 0),
          avgCycleHours: Number(claimStats?.avgCycleHours ?? 0),
        },
        agents: {
          total: Number(agentStats?.total ?? 0),
          active: Number(agentStats?.active ?? 0),
          suspended: Number(agentStats?.suspended ?? 0),
        },
        fraud: {
          alertsThisPeriod: Number(fraudStats?.total ?? 0),
          highRisk: Number(fraudStats?.highRisk ?? 0),
        },
        tenants: Number(tenantStats?.total ?? 0),
        ifrs17: reserves ?? { gmm: 0, paa: 0, vfa: 0, totalReserve: 0 },
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. UNDERWRITER KPI
  // ═══════════════════════════════════════════════════════════════════════════
  underwriterKpi: protectedProcedure
    .input(z.object({ periodDays: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      requireRole(ctx.user?.role, ["underwriter", "admin", "super-admin"], "underwriterKpi");
      const db = await getDb();
      if (!db) return null;
      const since = daysAgo(input.periodDays);

      const [appStats] = await db
        .select({
          total: count(),
          pending: sql<number>`COUNT(*) FILTER (WHERE status = 'pending')`,
          approved: sql<number>`COUNT(*) FILTER (WHERE status = 'approved')`,
          declined: sql<number>`COUNT(*) FILTER (WHERE status = 'declined')`,
          referred: sql<number>`COUNT(*) FILTER (WHERE status = 'referred')`,
          avgRiskScore: sql<number>`COALESCE(AVG(CAST(risk_score AS NUMERIC)), 0)`,
          totalSumInsured: sql<string>`COALESCE(SUM(CAST(sum_insured AS NUMERIC)), 0)`,
          avgTAT: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/3600) FILTER (WHERE status IN ('approved','declined')), 0)`,
        })
        .from(underwritingApplications)
        .where(gte(underwritingApplications.createdAt, since));

      const [policyStats] = await db
        .select({
          newPolicies: count(),
          totalPremium: sql<string>`COALESCE(SUM(CAST(premium_amount AS NUMERIC)), 0)`,
        })
        .from(policies)
        .where(gte(policies.createdAt, since));

      const approvalRate =
        Number(appStats?.total ?? 0) > 0
          ? (Number(appStats?.approved ?? 0) / Number(appStats?.total ?? 0)) * 100
          : 0;

      const declineRate =
        Number(appStats?.total ?? 0) > 0
          ? (Number(appStats?.declined ?? 0) / Number(appStats?.total ?? 0)) * 100
          : 0;

      return {
        period: { days: input.periodDays, since: since.toISOString() },
        applications: {
          total: Number(appStats?.total ?? 0),
          pending: Number(appStats?.pending ?? 0),
          approved: Number(appStats?.approved ?? 0),
          declined: Number(appStats?.declined ?? 0),
          referred: Number(appStats?.referred ?? 0),
          approvalRate: Math.round(approvalRate * 100) / 100,
          declineRate: Math.round(declineRate * 100) / 100,
          avgRiskScore: Number(appStats?.avgRiskScore ?? 0),
          totalSumInsured: Number(appStats?.totalSumInsured ?? 0),
          avgTurnaroundHours: Number(appStats?.avgTAT ?? 0),
        },
        policies: {
          newThisPeriod: Number(policyStats?.newPolicies ?? 0),
          premiumGenerated: Number(policyStats?.totalPremium ?? 0),
        },
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. ACTUARY KPI
  // ═══════════════════════════════════════════════════════════════════════════
  actuaryKpi: protectedProcedure
    .input(z.object({ periodDays: z.number().int().min(1).max(365).default(90) }))
    .query(async ({ ctx, input }) => {
      requireRole(ctx.user?.role, ["actuary", "admin", "super-admin"], "actuaryKpi");
      const db = await getDb();
      if (!db) return null;
      const since = daysAgo(input.periodDays);

      const [reserveStats] = await db
        .select({
          total: count(),
          totalGross: sql<string>`COALESCE(SUM(CAST(gross_reserve AS NUMERIC)), 0)`,
          totalNet: sql<string>`COALESCE(SUM(CAST(net_reserve AS NUMERIC)), 0)`,
          totalRa: sql<string>`COALESCE(SUM(CAST(risk_adjustment AS NUMERIC)), 0)`,
          avgLossRatio: sql<number>`COALESCE(AVG(CAST(loss_ratio AS NUMERIC)), 0)`,
        })
        .from(actuarialReserves)
        .where(gte(actuarialReserves.valuationDate, since));

      // Fetch IFRS17 full breakdown from Python analytics
      const ifrs17 = await fetchPythonAnalytics("/ifrs17/full-breakdown", {
        period_days: input.periodDays,
      });

      // Fetch loss development triangle from Python analytics
      const lossTriangle = await fetchPythonAnalytics("/actuarial/loss-triangle", {
        period_days: input.periodDays,
      });

      const [claimStats] = await db
        .select({
          totalIncurred: sql<string>`COALESCE(SUM(CAST(incurred_amount AS NUMERIC)), 0)`,
          totalPaid: sql<string>`COALESCE(SUM(CAST(settlement_amount AS NUMERIC) FILTER (WHERE settlement_amount IS NOT NULL)), 0)`,
          lossRatio: sql<number>`COALESCE(
            SUM(CAST(incurred_amount AS NUMERIC)) /
            NULLIF((SELECT SUM(CAST(premium_amount AS NUMERIC)) FROM policies), 0) * 100, 0)`,
        })
        .from(claims)
        .where(gte(claims.createdAt, since));

      return {
        period: { days: input.periodDays, since: since.toISOString() },
        reserves: {
          count: Number(reserveStats?.total ?? 0),
          grossReserve: Number(reserveStats?.totalGross ?? 0),
          netReserve: Number(reserveStats?.totalNet ?? 0),
          riskAdjustment: Number(reserveStats?.totalRa ?? 0),
          avgLossRatio: Number(reserveStats?.avgLossRatio ?? 0),
        },
        claims: {
          totalIncurred: Number(claimStats?.totalIncurred ?? 0),
          totalPaid: Number(claimStats?.totalPaid ?? 0),
          lossRatio: Number(claimStats?.lossRatio ?? 0),
        },
        ifrs17: ifrs17 ?? { gmm: 0, paa: 0, vfa: 0, csm: 0, ra: 0 },
        lossTriangle: lossTriangle ?? [],
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. CLAIMS ADJUSTER KPI
  // ═══════════════════════════════════════════════════════════════════════════
  claimsAdjusterKpi: protectedProcedure
    .input(z.object({ periodDays: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      requireRole(ctx.user?.role, ["claims-adjuster", "admin", "super-admin"], "claimsAdjusterKpi");
      const db = await getDb();
      if (!db) return null;
      const since = daysAgo(input.periodDays);

      const [claimStats] = await db
        .select({
          total: count(),
          reported: sql<number>`COUNT(*) FILTER (WHERE status = 'reported')`,
          investigating: sql<number>`COUNT(*) FILTER (WHERE status = 'investigating')`,
          pendingPayment: sql<number>`COUNT(*) FILTER (WHERE status = 'pending_payment')`,
          settled: sql<number>`COUNT(*) FILTER (WHERE status = 'settled')`,
          rejected: sql<number>`COUNT(*) FILTER (WHERE status = 'rejected')`,
          totalIncurred: sql<string>`COALESCE(SUM(CAST(incurred_amount AS NUMERIC)), 0)`,
          totalSettled: sql<string>`COALESCE(SUM(CAST(settlement_amount AS NUMERIC) FILTER (WHERE settlement_amount IS NOT NULL)), 0)`,
          avgCycleHours: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/3600) FILTER (WHERE status = 'settled'), 0)`,
          fraudSuspected: sql<number>`COUNT(*) FILTER (WHERE fraud_flag = true)`,
        })
        .from(claims)
        .where(gte(claims.createdAt, since));

      const [paymentStats] = await db
        .select({
          totalPayments: count(),
          totalAmount: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
          avgAmount: sql<number>`COALESCE(AVG(CAST(amount AS NUMERIC)), 0)`,
        })
        .from(claimsPayments)
        .where(gte(claimsPayments.createdAt, since));

      // SLA breach count for claims
      const [slaStats] = await db
        .select({ breaches: count() })
        .from(slaBreaches)
        .where(
          and(
            gte(slaBreaches.createdAt, since),
            sql`entity_type = 'claim'`
          )
        );

      const settlementRate =
        Number(claimStats?.total ?? 0) > 0
          ? (Number(claimStats?.settled ?? 0) / Number(claimStats?.total ?? 0)) * 100
          : 0;

      return {
        period: { days: input.periodDays, since: since.toISOString() },
        claims: {
          total: Number(claimStats?.total ?? 0),
          byStatus: {
            reported: Number(claimStats?.reported ?? 0),
            investigating: Number(claimStats?.investigating ?? 0),
            pendingPayment: Number(claimStats?.pendingPayment ?? 0),
            settled: Number(claimStats?.settled ?? 0),
            rejected: Number(claimStats?.rejected ?? 0),
          },
          totalIncurred: Number(claimStats?.totalIncurred ?? 0),
          totalSettled: Number(claimStats?.totalSettled ?? 0),
          settlementRate: Math.round(settlementRate * 100) / 100,
          avgCycleHours: Number(claimStats?.avgCycleHours ?? 0),
          fraudSuspected: Number(claimStats?.fraudSuspected ?? 0),
        },
        payments: {
          count: Number(paymentStats?.totalPayments ?? 0),
          totalAmount: Number(paymentStats?.totalAmount ?? 0),
          avgAmount: Number(paymentStats?.avgAmount ?? 0),
        },
        slaBreaches: Number(slaStats?.breaches ?? 0),
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. BROKER KPI
  // ═══════════════════════════════════════════════════════════════════════════
  brokerKpi: protectedProcedure
    .input(
      z.object({
        periodDays: z.number().int().min(1).max(365).default(30),
        brokerId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      requireRole(ctx.user?.role, ["broker", "admin", "super-admin"], "brokerKpi");
      const db = await getDb();
      if (!db) return null;
      const since = daysAgo(input.periodDays);

      const brokerId = input.brokerId ?? ctx.user?.id;

      const [policyStats] = await db
        .select({
          total: count(),
          active: sql<number>`COUNT(*) FILTER (WHERE status = 'active')`,
          lapsed: sql<number>`COUNT(*) FILTER (WHERE status = 'lapsed')`,
          totalPremium: sql<string>`COALESCE(SUM(CAST(premium_amount AS NUMERIC)), 0)`,
          newThisPeriod: sql<number>`COUNT(*) FILTER (WHERE created_at >= ${since.toISOString()})`,
        })
        .from(policies)
        .where(brokerId ? eq(policies.agentId, brokerId) : sql`1=1`);

      const [commissionStats] = await db
        .select({
          total: count(),
          totalEarned: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
          totalPaid: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC) FILTER (WHERE status = 'paid')), 0)`,
          pending: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC) FILTER (WHERE status = 'pending')), 0)`,
        })
        .from(commissions)
        .where(
          and(
            brokerId ? eq(commissions.agentId, brokerId) : sql`1=1`,
            gte(commissions.createdAt, since)
          )
        );

      const [claimStats] = await db
        .select({
          total: count(),
          open: sql<number>`COUNT(*) FILTER (WHERE status NOT IN ('settled','rejected'))`,
        })
        .from(claims)
        .where(gte(claims.createdAt, since));

      return {
        period: { days: input.periodDays, since: since.toISOString() },
        portfolio: {
          totalPolicies: Number(policyStats?.total ?? 0),
          activePolicies: Number(policyStats?.active ?? 0),
          lapsedPolicies: Number(policyStats?.lapsed ?? 0),
          newThisPeriod: Number(policyStats?.newThisPeriod ?? 0),
          totalPremiumInForce: Number(policyStats?.totalPremium ?? 0),
        },
        commissions: {
          count: Number(commissionStats?.total ?? 0),
          totalEarned: Number(commissionStats?.totalEarned ?? 0),
          totalPaid: Number(commissionStats?.totalPaid ?? 0),
          pendingPayout: Number(commissionStats?.pending ?? 0),
        },
        claims: {
          total: Number(claimStats?.total ?? 0),
          open: Number(claimStats?.open ?? 0),
        },
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. REINSURER KPI
  // ═══════════════════════════════════════════════════════════════════════════
  reinsurerKpi: protectedProcedure
    .input(z.object({ periodDays: z.number().int().min(1).max(365).default(90) }))
    .query(async ({ ctx, input }) => {
      requireRole(ctx.user?.role, ["reinsurer", "admin", "super-admin"], "reinsurerKpi");
      const db = await getDb();
      if (!db) return null;
      const since = daysAgo(input.periodDays);

      const [treatyStats] = await db
        .select({
          total: count(),
          active: sql<number>`COUNT(*) FILTER (WHERE status = 'active')`,
          expired: sql<number>`COUNT(*) FILTER (WHERE status = 'expired')`,
          totalCapacity: sql<string>`COALESCE(SUM(CAST(capacity AS NUMERIC)), 0)`,
          totalPremiumCeded: sql<string>`COALESCE(SUM(CAST(premium_ceded AS NUMERIC)), 0)`,
        })
        .from(reinsuranceTreaties);

      const [cessionStats] = await db
        .select({
          total: count(),
          totalCeded: sql<string>`COALESCE(SUM(CAST(ceded_premium AS NUMERIC)), 0)`,
          totalRecovered: sql<string>`COALESCE(SUM(CAST(recovered_amount AS NUMERIC) FILTER (WHERE recovered_amount IS NOT NULL)), 0)`,
          pendingRecovery: sql<string>`COALESCE(SUM(CAST(ceded_premium AS NUMERIC) FILTER (WHERE status = 'pending')), 0)`,
        })
        .from(reinsuranceCessions)
        .where(gte(reinsuranceCessions.createdAt, since));

      const cessionRatio =
        Number(treatyStats?.totalCapacity ?? 0) > 0
          ? (Number(cessionStats?.totalCeded ?? 0) /
              Number(treatyStats?.totalCapacity ?? 0)) *
            100
          : 0;

      return {
        period: { days: input.periodDays, since: since.toISOString() },
        treaties: {
          total: Number(treatyStats?.total ?? 0),
          active: Number(treatyStats?.active ?? 0),
          expired: Number(treatyStats?.expired ?? 0),
          totalCapacity: Number(treatyStats?.totalCapacity ?? 0),
          totalPremiumCeded: Number(treatyStats?.totalPremiumCeded ?? 0),
        },
        cessions: {
          count: Number(cessionStats?.total ?? 0),
          totalCeded: Number(cessionStats?.totalCeded ?? 0),
          totalRecovered: Number(cessionStats?.totalRecovered ?? 0),
          pendingRecovery: Number(cessionStats?.pendingRecovery ?? 0),
          cessionRatio: Math.round(cessionRatio * 100) / 100,
        },
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. POLICYHOLDER KPI (self-service — own policies only)
  // ═══════════════════════════════════════════════════════════════════════════
  policyholderKpi: protectedProcedure
    .query(async ({ ctx }) => {
      requireRole(ctx.user?.role, ["policyholder", "user", "admin", "super-admin"], "policyholderKpi");
      const db = await getDb();
      if (!db) return null;
      const userId = ctx.user!.id;

      const [policyStats] = await db
        .select({
          total: count(),
          active: sql<number>`COUNT(*) FILTER (WHERE status = 'active')`,
          lapsed: sql<number>`COUNT(*) FILTER (WHERE status = 'lapsed')`,
          totalPremium: sql<string>`COALESCE(SUM(CAST(premium_amount AS NUMERIC)), 0)`,
          nextRenewal: sql<string>`MIN(end_date) FILTER (WHERE status = 'active' AND end_date > NOW())`,
        })
        .from(policies)
        .where(eq(policies.customerId, userId));

      const [claimStats] = await db
        .select({
          total: count(),
          open: sql<number>`COUNT(*) FILTER (WHERE status NOT IN ('settled','rejected'))`,
          settled: sql<number>`COUNT(*) FILTER (WHERE status = 'settled')`,
          totalSettled: sql<string>`COALESCE(SUM(CAST(settlement_amount AS NUMERIC) FILTER (WHERE settlement_amount IS NOT NULL)), 0)`,
        })
        .from(claims)
        .where(eq(claims.customerId, userId));

      const [premiumStats] = await db
        .select({
          totalPaid: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC) FILTER (WHERE status = 'paid')), 0)`,
          outstanding: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC) FILTER (WHERE status = 'pending')), 0)`,
          nextDue: sql<string>`MIN(due_date) FILTER (WHERE status = 'pending' AND due_date > NOW())`,
        })
        .from(premiums)
        .where(eq(premiums.customerId, userId));

      return {
        policies: {
          total: Number(policyStats?.total ?? 0),
          active: Number(policyStats?.active ?? 0),
          lapsed: Number(policyStats?.lapsed ?? 0),
          totalPremiumInForce: Number(policyStats?.totalPremium ?? 0),
          nextRenewalDate: policyStats?.nextRenewal ?? null,
        },
        claims: {
          total: Number(claimStats?.total ?? 0),
          open: Number(claimStats?.open ?? 0),
          settled: Number(claimStats?.settled ?? 0),
          totalSettled: Number(claimStats?.totalSettled ?? 0),
        },
        premiums: {
          totalPaid: Number(premiumStats?.totalPaid ?? 0),
          outstanding: Number(premiumStats?.outstanding ?? 0),
          nextDueDate: premiumStats?.nextDue ?? null,
        },
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. COMPLIANCE OFFICER KPI
  // ═══════════════════════════════════════════════════════════════════════════
  complianceKpi: protectedProcedure
    .input(z.object({ periodDays: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      requireRole(ctx.user?.role, ["compliance-officer", "admin", "super-admin"], "complianceKpi");
      const db = await getDb();
      if (!db) return null;
      const since = daysAgo(input.periodDays);

      const [checkStats] = await db
        .select({
          total: count(),
          passed: sql<number>`COUNT(*) FILTER (WHERE status = 'passed')`,
          failed: sql<number>`COUNT(*) FILTER (WHERE status = 'failed')`,
          pending: sql<number>`COUNT(*) FILTER (WHERE status = 'pending')`,
          amlFlags: sql<number>`COUNT(*) FILTER (WHERE check_type = 'aml' AND status = 'failed')`,
          kycFlags: sql<number>`COUNT(*) FILTER (WHERE check_type = 'kyc' AND status = 'failed')`,
        })
        .from(complianceChecks)
        .where(gte(complianceChecks.createdAt, since));

      const [fraudStats] = await db
        .select({
          total: count(),
          highRisk: sql<number>`COUNT(*) FILTER (WHERE risk_score >= 80)`,
          resolved: sql<number>`COUNT(*) FILTER (WHERE status = 'resolved')`,
        })
        .from(fraudAlerts)
        .where(gte(fraudAlerts.createdAt, since));

      const [auditStats] = await db
        .select({ total: count() })
        .from(auditLog)
        .where(gte(auditLog.createdAt, since));

      const complianceRate =
        Number(checkStats?.total ?? 0) > 0
          ? (Number(checkStats?.passed ?? 0) / Number(checkStats?.total ?? 0)) * 100
          : 100;

      return {
        period: { days: input.periodDays, since: since.toISOString() },
        checks: {
          total: Number(checkStats?.total ?? 0),
          passed: Number(checkStats?.passed ?? 0),
          failed: Number(checkStats?.failed ?? 0),
          pending: Number(checkStats?.pending ?? 0),
          complianceRate: Math.round(complianceRate * 100) / 100,
          amlFlags: Number(checkStats?.amlFlags ?? 0),
          kycFlags: Number(checkStats?.kycFlags ?? 0),
        },
        fraud: {
          alerts: Number(fraudStats?.total ?? 0),
          highRisk: Number(fraudStats?.highRisk ?? 0),
          resolved: Number(fraudStats?.resolved ?? 0),
        },
        auditEvents: Number(auditStats?.total ?? 0),
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. REGULATOR KPI (read-only — NAICOM/CBN view)
  // ═══════════════════════════════════════════════════════════════════════════
  regulatorKpi: protectedProcedure
    .input(z.object({ periodDays: z.number().int().min(1).max(365).default(90) }))
    .query(async ({ ctx, input }) => {
      requireRole(ctx.user?.role, ["regulator", "admin", "super-admin"], "regulatorKpi");
      const db = await getDb();
      if (!db) return null;
      const since = daysAgo(input.periodDays);

      const [policyStats] = await db
        .select({
          total: count(),
          active: sql<number>`COUNT(*) FILTER (WHERE status = 'active')`,
          totalPremium: sql<string>`COALESCE(SUM(CAST(premium_amount AS NUMERIC)), 0)`,
        })
        .from(policies);

      const [claimStats] = await db
        .select({
          total: count(),
          settled: sql<number>`COUNT(*) FILTER (WHERE status = 'settled')`,
          rejected: sql<number>`COUNT(*) FILTER (WHERE status = 'rejected')`,
          totalPaid: sql<string>`COALESCE(SUM(CAST(settlement_amount AS NUMERIC) FILTER (WHERE settlement_amount IS NOT NULL)), 0)`,
          avgCycleHours: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/3600) FILTER (WHERE status = 'settled'), 0)`,
        })
        .from(claims);

      const [reserveStats] = await db
        .select({
          totalGross: sql<string>`COALESCE(SUM(CAST(gross_reserve AS NUMERIC)), 0)`,
          totalNet: sql<string>`COALESCE(SUM(CAST(net_reserve AS NUMERIC)), 0)`,
        })
        .from(actuarialReserves);

      const [complianceStats] = await db
        .select({
          total: count(),
          failed: sql<number>`COUNT(*) FILTER (WHERE status = 'failed')`,
        })
        .from(complianceChecks)
        .where(gte(complianceChecks.createdAt, since));

      const [slaStats] = await db
        .select({ total: count() })
        .from(slaBreaches)
        .where(gte(slaBreaches.createdAt, since));

      const solvencyRatio =
        Number(reserveStats?.totalGross ?? 0) > 0
          ? (Number(reserveStats?.totalNet ?? 0) /
              Number(reserveStats?.totalGross ?? 0)) *
            100
          : 0;

      return {
        period: { days: input.periodDays, since: since.toISOString() },
        marketOverview: {
          totalPolicies: Number(policyStats?.total ?? 0),
          activePolicies: Number(policyStats?.active ?? 0),
          totalPremiumInForce: Number(policyStats?.totalPremium ?? 0),
        },
        claims: {
          total: Number(claimStats?.total ?? 0),
          settled: Number(claimStats?.settled ?? 0),
          rejected: Number(claimStats?.rejected ?? 0),
          totalPaid: Number(claimStats?.totalPaid ?? 0),
          avgCycleHours: Number(claimStats?.avgCycleHours ?? 0),
        },
        solvency: {
          grossReserve: Number(reserveStats?.totalGross ?? 0),
          netReserve: Number(reserveStats?.totalNet ?? 0),
          solvencyRatio: Math.round(solvencyRatio * 100) / 100,
        },
        compliance: {
          checksTotal: Number(complianceStats?.total ?? 0),
          checksFailed: Number(complianceStats?.failed ?? 0),
          slaBreaches: Number(slaStats?.total ?? 0),
        },
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. BILLING ADMIN KPI
  // ═══════════════════════════════════════════════════════════════════════════
  billingAdminKpi: protectedProcedure
    .input(z.object({ periodDays: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      requireRole(ctx.user?.role, ["billing-admin", "billing-analyst", "admin", "super-admin"], "billingAdminKpi");
      const db = await getDb();
      if (!db) return null;
      const since = daysAgo(input.periodDays);

      const [ledgerStats] = await db
        .select({
          total: count(),
          totalRevenue: sql<string>`COALESCE(SUM(CAST(platform_share AS NUMERIC)), 0)`,
          totalTenantShare: sql<string>`COALESCE(SUM(CAST(tenant_share AS NUMERIC) FILTER (WHERE tenant_share IS NOT NULL)), 0)`,
          totalClientShare: sql<string>`COALESCE(SUM(CAST(client_share AS NUMERIC) FILTER (WHERE client_share IS NOT NULL)), 0)`,
        })
        .from(platformBillingLedger)
        .where(gte(platformBillingLedger.createdAt, since));

      const [glStats] = await db
        .select({
          total: count(),
          totalDebit: sql<string>`COALESCE(SUM(CAST(debit_amount AS NUMERIC) FILTER (WHERE debit_amount IS NOT NULL)), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(CAST(credit_amount AS NUMERIC) FILTER (WHERE credit_amount IS NOT NULL)), 0)`,
          unposted: sql<number>`COUNT(*) FILTER (WHERE posted = false)`,
        })
        .from(glEntries)
        .where(gte(glEntries.createdAt, since));

      // TigerBeetle ledger balances
      const tbBalances = await fetchTigerBeetleLedger([
        "platform-revenue",
        "tenant-payable",
        "client-payable",
      ]);

      return {
        period: { days: input.periodDays, since: since.toISOString() },
        billing: {
          entries: Number(ledgerStats?.total ?? 0),
          platformRevenue: Number(ledgerStats?.totalRevenue ?? 0),
          tenantShare: Number(ledgerStats?.totalTenantShare ?? 0),
          clientShare: Number(ledgerStats?.totalClientShare ?? 0),
        },
        gl: {
          entries: Number(glStats?.total ?? 0),
          totalDebit: Number(glStats?.totalDebit ?? 0),
          totalCredit: Number(glStats?.totalCredit ?? 0),
          unposted: Number(glStats?.unposted ?? 0),
          balance:
            Number(glStats?.totalCredit ?? 0) -
            Number(glStats?.totalDebit ?? 0),
        },
        tigerBeetle: tbBalances ?? null,
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. SUPERVISOR KPI
  // ═══════════════════════════════════════════════════════════════════════════
  supervisorKpi: protectedProcedure
    .input(z.object({ periodDays: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      requireRole(ctx.user?.role, ["supervisor", "admin", "super-admin"], "supervisorKpi");
      const db = await getDb();
      if (!db) return null;
      const since = daysAgo(input.periodDays);

      const [agentStats] = await db
        .select({
          total: count(),
          active: sql<number>`COUNT(*) FILTER (WHERE status = 'active')`,
          suspended: sql<number>`COUNT(*) FILTER (WHERE status = 'suspended')`,
          avgScore: sql<number>`COALESCE(AVG(CAST(performance_score AS NUMERIC)), 0)`,
        })
        .from(agents);

      const [txStats] = await db
        .select({
          total: count(),
          totalVolume: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
          failed: sql<number>`COUNT(*) FILTER (WHERE status = 'failed')`,
          successRate: sql<number>`COALESCE(COUNT(*) FILTER (WHERE status = 'success') * 100.0 / NULLIF(COUNT(*), 0), 0)`,
        })
        .from(transactions)
        .where(gte(transactions.createdAt, since));

      const [slaStats] = await db
        .select({
          total: count(),
          critical: sql<number>`COUNT(*) FILTER (WHERE severity = 'critical')`,
        })
        .from(slaBreaches)
        .where(gte(slaBreaches.createdAt, since));

      const [commissionStats] = await db
        .select({
          pending: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC) FILTER (WHERE status = 'pending')), 0)`,
          paid: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC) FILTER (WHERE status = 'paid')), 0)`,
        })
        .from(commissions)
        .where(gte(commissions.createdAt, since));

      return {
        period: { days: input.periodDays, since: since.toISOString() },
        agents: {
          total: Number(agentStats?.total ?? 0),
          active: Number(agentStats?.active ?? 0),
          suspended: Number(agentStats?.suspended ?? 0),
          avgPerformanceScore: Number(agentStats?.avgScore ?? 0),
        },
        transactions: {
          total: Number(txStats?.total ?? 0),
          totalVolume: Number(txStats?.totalVolume ?? 0),
          failed: Number(txStats?.failed ?? 0),
          successRate: Number(txStats?.successRate ?? 0),
        },
        sla: {
          breaches: Number(slaStats?.total ?? 0),
          critical: Number(slaStats?.critical ?? 0),
        },
        commissions: {
          pending: Number(commissionStats?.pending ?? 0),
          paid: Number(commissionStats?.paid ?? 0),
        },
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 12. POLICY LIFECYCLE KPI (cross-role — policy pipeline view)
  // ═══════════════════════════════════════════════════════════════════════════
  policyLifecycleKpi: protectedProcedure
    .input(z.object({ periodDays: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      requireRole(
        ctx.user?.role,
        ["underwriter", "broker", "admin", "super-admin", "actuary", "compliance-officer"],
        "policyLifecycleKpi"
      );
      const db = await getDb();
      if (!db) return null;
      const since = daysAgo(input.periodDays);

      const [stats] = await db
        .select({
          total: count(),
          quoted: sql<number>`COUNT(*) FILTER (WHERE status = 'quoted')`,
          underwriting: sql<number>`COUNT(*) FILTER (WHERE status = 'underwriting')`,
          active: sql<number>`COUNT(*) FILTER (WHERE status = 'active')`,
          lapsed: sql<number>`COUNT(*) FILTER (WHERE status = 'lapsed')`,
          cancelled: sql<number>`COUNT(*) FILTER (WHERE status = 'cancelled')`,
          renewed: sql<number>`COUNT(*) FILTER (WHERE status = 'renewed')`,
          totalPremium: sql<string>`COALESCE(SUM(CAST(premium_amount AS NUMERIC)), 0)`,
        })
        .from(policies);

      const [renewalStats] = await db
        .select({
          upcoming: sql<number>`COUNT(*) FILTER (WHERE renewal_date BETWEEN NOW() AND NOW() + INTERVAL '30 days')`,
          overdue: sql<number>`COUNT(*) FILTER (WHERE renewal_date < NOW() AND status = 'active')`,
        })
        .from(policyRenewals);

      const [appStats] = await db
        .select({
          total: count(),
          pending: sql<number>`COUNT(*) FILTER (WHERE status = 'pending')`,
          avgRiskScore: sql<number>`COALESCE(AVG(CAST(risk_score AS NUMERIC)), 0)`,
        })
        .from(underwritingApplications)
        .where(gte(underwritingApplications.createdAt, since));

      return {
        period: { days: input.periodDays, since: since.toISOString() },
        pipeline: {
          total: Number(stats?.total ?? 0),
          byStage: {
            quoted: Number(stats?.quoted ?? 0),
            underwriting: Number(stats?.underwriting ?? 0),
            active: Number(stats?.active ?? 0),
            lapsed: Number(stats?.lapsed ?? 0),
            cancelled: Number(stats?.cancelled ?? 0),
            renewed: Number(stats?.renewed ?? 0),
          },
          totalPremiumInForce: Number(stats?.totalPremium ?? 0),
        },
        renewals: {
          upcoming30Days: Number(renewalStats?.upcoming ?? 0),
          overdue: Number(renewalStats?.overdue ?? 0),
        },
        applications: {
          total: Number(appStats?.total ?? 0),
          pending: Number(appStats?.pending ?? 0),
          avgRiskScore: Number(appStats?.avgRiskScore ?? 0),
        },
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 13. PREMIUM COLLECTION KPI
  // ═══════════════════════════════════════════════════════════════════════════
  premiumCollectionKpi: protectedProcedure
    .input(z.object({ periodDays: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      requireRole(
        ctx.user?.role,
        ["billing-admin", "billing-analyst", "admin", "super-admin", "supervisor", "broker"],
        "premiumCollectionKpi"
      );
      const db = await getDb();
      if (!db) return null;
      const since = daysAgo(input.periodDays);

      const [premiumStats] = await db
        .select({
          total: count(),
          paid: sql<number>`COUNT(*) FILTER (WHERE status = 'paid')`,
          pending: sql<number>`COUNT(*) FILTER (WHERE status = 'pending')`,
          overdue: sql<number>`COUNT(*) FILTER (WHERE status = 'overdue')`,
          totalCollected: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC) FILTER (WHERE status = 'paid')), 0)`,
          totalOutstanding: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC) FILTER (WHERE status IN ('pending','overdue'))), 0)`,
          collectionRate: sql<number>`COALESCE(COUNT(*) FILTER (WHERE status = 'paid') * 100.0 / NULLIF(COUNT(*), 0), 0)`,
        })
        .from(premiums)
        .where(gte(premiums.createdAt, since));

      return {
        period: { days: input.periodDays, since: since.toISOString() },
        premiums: {
          total: Number(premiumStats?.total ?? 0),
          paid: Number(premiumStats?.paid ?? 0),
          pending: Number(premiumStats?.pending ?? 0),
          overdue: Number(premiumStats?.overdue ?? 0),
          totalCollected: Number(premiumStats?.totalCollected ?? 0),
          totalOutstanding: Number(premiumStats?.totalOutstanding ?? 0),
          collectionRate: Number(premiumStats?.collectionRate ?? 0),
        },
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 14. IFRS17 DASHBOARD KPI (actuary / admin)
  // ═══════════════════════════════════════════════════════════════════════════
  ifrs17Kpi: protectedProcedure
    .input(z.object({ periodDays: z.number().int().min(1).max(365).default(90) }))
    .query(async ({ ctx, input }) => {
      requireRole(ctx.user?.role, ["actuary", "admin", "super-admin", "regulator"], "ifrs17Kpi");
      const db = await getDb();
      if (!db) return null;
      const since = daysAgo(input.periodDays);

      const [reserveStats] = await db
        .select({
          gmmCount: sql<number>`COUNT(*) FILTER (WHERE measurement_model = 'gmm')`,
          paaCount: sql<number>`COUNT(*) FILTER (WHERE measurement_model = 'paa')`,
          vfaCount: sql<number>`COUNT(*) FILTER (WHERE measurement_model = 'vfa')`,
          totalGross: sql<string>`COALESCE(SUM(CAST(gross_reserve AS NUMERIC)), 0)`,
          totalNet: sql<string>`COALESCE(SUM(CAST(net_reserve AS NUMERIC)), 0)`,
          totalCsm: sql<string>`COALESCE(SUM(CAST(csm_balance AS NUMERIC) FILTER (WHERE csm_balance IS NOT NULL)), 0)`,
          totalRa: sql<string>`COALESCE(SUM(CAST(risk_adjustment AS NUMERIC)), 0)`,
          avgLossRatio: sql<number>`COALESCE(AVG(CAST(loss_ratio AS NUMERIC)), 0)`,
        })
        .from(actuarialReserves)
        .where(gte(actuarialReserves.valuationDate, since));

      // Full IFRS17 computation from Python analytics engine
      const ifrs17Full = await fetchPythonAnalytics("/ifrs17/full-breakdown", {
        period_days: input.periodDays,
      });

      return {
        period: { days: input.periodDays, since: since.toISOString() },
        byModel: {
          gmm: { count: Number(reserveStats?.gmmCount ?? 0) },
          paa: { count: Number(reserveStats?.paaCount ?? 0) },
          vfa: { count: Number(reserveStats?.vfaCount ?? 0) },
        },
        totals: {
          grossReserve: Number(reserveStats?.totalGross ?? 0),
          netReserve: Number(reserveStats?.totalNet ?? 0),
          csm: Number(reserveStats?.totalCsm ?? 0),
          riskAdjustment: Number(reserveStats?.totalRa ?? 0),
          avgLossRatio: Number(reserveStats?.avgLossRatio ?? 0),
        },
        pythonEngine: ifrs17Full ?? null,
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 15. REINSURANCE DASHBOARD KPI
  // ═══════════════════════════════════════════════════════════════════════════
  reinsuranceDashboardKpi: protectedProcedure
    .input(z.object({ periodDays: z.number().int().min(1).max(365).default(90) }))
    .query(async ({ ctx, input }) => {
      requireRole(
        ctx.user?.role,
        ["reinsurer", "actuary", "admin", "super-admin"],
        "reinsuranceDashboardKpi"
      );
      const db = await getDb();
      if (!db) return null;
      const since = daysAgo(input.periodDays);

      const [treatyStats] = await db
        .select({
          total: count(),
          active: sql<number>`COUNT(*) FILTER (WHERE status = 'active')`,
          byType: sql<string>`json_agg(json_build_object('type', treaty_type, 'count', 1))`,
          totalCapacity: sql<string>`COALESCE(SUM(CAST(capacity AS NUMERIC)), 0)`,
          totalPremiumCeded: sql<string>`COALESCE(SUM(CAST(premium_ceded AS NUMERIC)), 0)`,
        })
        .from(reinsuranceTreaties);

      const [cessionStats] = await db
        .select({
          total: count(),
          totalCeded: sql<string>`COALESCE(SUM(CAST(ceded_premium AS NUMERIC)), 0)`,
          totalRecovered: sql<string>`COALESCE(SUM(CAST(recovered_amount AS NUMERIC) FILTER (WHERE recovered_amount IS NOT NULL)), 0)`,
          pendingRecovery: sql<number>`COUNT(*) FILTER (WHERE status = 'pending')`,
        })
        .from(reinsuranceCessions)
        .where(gte(reinsuranceCessions.createdAt, since));

      const netRetention =
        Number(treatyStats?.totalCapacity ?? 0) > 0
          ? 100 -
            (Number(cessionStats?.totalCeded ?? 0) /
              Number(treatyStats?.totalCapacity ?? 0)) *
              100
          : 100;

      return {
        period: { days: input.periodDays, since: since.toISOString() },
        treaties: {
          total: Number(treatyStats?.total ?? 0),
          active: Number(treatyStats?.active ?? 0),
          totalCapacity: Number(treatyStats?.totalCapacity ?? 0),
          totalPremiumCeded: Number(treatyStats?.totalPremiumCeded ?? 0),
        },
        cessions: {
          count: Number(cessionStats?.total ?? 0),
          totalCeded: Number(cessionStats?.totalCeded ?? 0),
          totalRecovered: Number(cessionStats?.totalRecovered ?? 0),
          pendingRecovery: Number(cessionStats?.pendingRecovery ?? 0),
        },
        netRetentionRate: Math.round(netRetention * 100) / 100,
      };
    }),
});
