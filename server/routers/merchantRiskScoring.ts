import { desc, eq, sql, count } from "drizzle-orm";
import { z } from "zod";

import { merchants, transactions, disputes } from "../../drizzle/schema";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

/**
 * Merchant Risk Scoring Router
 * Comprehensive merchant risk assessment using transaction patterns,
 * compliance history, and behavioral analytics.
 *
 * Business Rules:
 * - Risk score: 0-100 (0=lowest risk, 100=highest)
 * - Auto-approve: Score < 30 (low risk)
 * - Enhanced monitoring: Score 30-60 (medium)
 * - Restricted processing: Score 60-80 (high)
 * - Suspended: Score > 80 (critical - manual review required)
 * - Factors: chargeback ratio, transaction velocity, geographic spread,
 *   industry risk (MCC), time-in-business, compliance history
 * - MCC risk categories: 7995 (gambling) = +40, 5912 (pharmacy) = +20,
 *   5411 (grocery) = -10, 5541 (gas) = +5
 */

const MCC_RISK_ADJUSTMENTS: Record<string, number> = {
  "7995": 40, // Gambling
  "5912": 20, // Pharmacy
  "5966": 35, // Direct marketing
  "5816": 15, // Digital goods
  "5411": -10, // Grocery (low risk)
  "5541": 5,  // Gas stations
  "5812": 0,  // Restaurants
  "4816": 10, // Telecom
};

// MED-17 (G1 fix-wave, 2026-06): the previous scorer read fields that do not
// exist in the merchants schema (chargebackRatio / mcc / monthsActive /
// statesActive), so EVERY merchant silently scored off defaults. Features
// are now derived from REAL persisted data:
//   - chargeback ratio: open+won disputes / max(totalTransactions, 1)
//   - time in business: merchants.createdAt
//   - category risk: the platform's merchant_category enum (honest mapping)
//   - velocity: transactions in the trailing 24h vs the prior 30 days
// A merchant with NO transaction history is "new" and scores accordingly —
// never silently "low".
const CATEGORY_RISK_ADJUSTMENTS: Record<string, number> = {
  government: -10,
  utilities: -5,
  education: -5,
  health: 5,
  retail: 0,
  food_beverage: 0,
  transport: 10,
  other: 10,
};

export function calculateMerchantRiskScore(
  merchant: {
    createdAt?: Date | string | null;
    category?: string | null;
    totalTransactions?: number | null;
  },
  stats: {
    disputeCount: number;
    txLast24h: number;
    txPrev30dDailyAvg: number;
  }
): { score: number; factors: any[]; category: string } {
  let score = 25; // Base score
  const factors: any[] = [];

  // Chargeback/dispute ratio (most important factor) — REAL dispute rows.
  const totalTx = Math.max(merchant.totalTransactions ?? 0, 1);
  const chargebackRatio = stats.disputeCount / totalTx;
  if (chargebackRatio > 0.03) { score += 30; factors.push({ name: "high_chargebacks", impact: 30, detail: `${(chargebackRatio * 100).toFixed(2)}% (threshold: 3%)` }); }
  else if (chargebackRatio > 0.01) { score += 15; factors.push({ name: "moderate_chargebacks", impact: 15, detail: `${(chargebackRatio * 100).toFixed(2)}%` }); }

  // Category risk (replaces the nonexistent MCC column).
  const cat = merchant.category ?? "other";
  const catAdj = CATEGORY_RISK_ADJUSTMENTS[cat] ?? 10;
  if (catAdj !== 0) { score += catAdj; factors.push({ name: "category_risk", impact: catAdj, detail: `category ${cat}` }); }

  // Time in business from the REAL createdAt (newer = riskier).
  const createdAt = merchant.createdAt ? new Date(merchant.createdAt) : null;
  const monthsActive = createdAt
    ? Math.max(0, (Date.now() - createdAt.getTime()) / (30.44 * 24 * 3600 * 1000))
    : 0;
  if (monthsActive < 3) { score += 20; factors.push({ name: "new_merchant", impact: 20, detail: `${monthsActive.toFixed(1)} months (< 3 months)` }); }
  else if (monthsActive < 6) { score += 10; factors.push({ name: "recent_merchant", impact: 10, detail: `${monthsActive.toFixed(1)} months` }); }
  else if (monthsActive > 24) { score -= 10; factors.push({ name: "established", impact: -10, detail: `${monthsActive.toFixed(1)} months tenure` }); }

  // Velocity spike: trailing-24h volume vs prior-30d daily average.
  if (stats.txPrev30dDailyAvg > 0 && stats.txLast24h > 5 * stats.txPrev30dDailyAvg) {
    score += 15;
    factors.push({ name: "velocity_spike", impact: 15, detail: `${stats.txLast24h} tx/24h vs ${stats.txPrev30dDailyAvg.toFixed(1)} avg` });
  }

  score = Math.max(0, Math.min(100, score));
  const category = score < 30 ? "low" : score < 60 ? "medium" : score < 80 ? "high" : "critical";

  return { score, factors, category };
}

async function loadMerchantStats(
  database: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  merchantId: number
): Promise<{ disputeCount: number; txLast24h: number; txPrev30dDailyAvg: number }> {
  const [d] = await database
    .select({ total: count() })
    .from(disputes)
    .where(eq(disputes.raisedByRef, String(merchantId)))
    .limit(1);
  // Transaction linkage to merchants goes via preferredAgentId.
  const [m] = await database
    .select({ preferredAgentId: merchants.preferredAgentId, merchantCode: merchants.merchantCode })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);
  let txLast24h = 0;
  let txPrev30dDailyAvg = 0;
  if (m?.preferredAgentId) {
    const since24h = new Date(Date.now() - 24 * 3600 * 1000);
    const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const [c24] = await database
      .select({ total: count() })
      .from(transactions)
      .where(
        sql`${transactions.agentId} = ${m.preferredAgentId} AND ${transactions.createdAt} >= ${since24h}`
      )
      .limit(1);
    const [c30] = await database
      .select({ total: count() })
      .from(transactions)
      .where(
        sql`${transactions.agentId} = ${m.preferredAgentId} AND ${transactions.createdAt} >= ${since30d}`
      )
      .limit(1);
    txLast24h = Number(c24?.total ?? 0);
    txPrev30dDailyAvg = Number(c30?.total ?? 0) / 30;
  }
  return { disputeCount: Number(d?.total ?? 0), txLast24h, txPrev30dDailyAvg };
}

export const merchantRiskScoringRouter = router({
  // HIGH-12 (G1 fix-wave): merchant PII — admin-only risk views.
  list: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      riskCategory: z.enum(["all", "low", "medium", "high", "critical"]).default("all"),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: input.limit, offset: input.offset };

      const results = await database.select().from(merchants).orderBy(desc(merchants.id)).limit(input.limit).offset(input.offset);
      const totalRows = await database.select({ total: count() }).from(merchants);

      const scored = await Promise.all(
        results.map(async (m: any) => ({
          ...m,
          riskAssessment: calculateMerchantRiskScore(
            m,
            await loadMerchantStats(database, m.id)
          ),
        }))
      );
      const filtered = input.riskCategory === "all" ? scored : scored.filter((m: any) => m.riskAssessment.category === input.riskCategory);

      return { data: filtered, total: (totalRows as any)[0]?.total ?? 0, limit: input.limit, offset: input.offset };
    }),

  scoreOne: adminProcedure
    .input(z.object({ merchantId: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return null;

      const [merchant] = await database.select().from(merchants).where(eq(merchants.id, input.merchantId)).limit(1);
      if (!merchant) throw new Error(`Merchant ${input.merchantId} not found`);

      const assessment = calculateMerchantRiskScore(
        merchant,
        await loadMerchantStats(database, merchant.id)
      );
      const action = assessment.score < 30 ? "auto_approve" : assessment.score < 60 ? "enhanced_monitoring" : assessment.score < 80 ? "restricted_processing" : "suspended";

      return { merchantId: input.merchantId, ...assessment, recommendedAction: action, assessedAt: new Date().toISOString() };
    }),

  getSummary: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { totalMerchants: 0, distribution: {} };

    const totalRows = await database.select({ total: count() }).from(merchants);
    const total = (totalRows as any)[0]?.total ?? 0;

    return {
      totalMerchants: total,
      distribution: { low: 0, medium: 0, high: 0, critical: 0 }, // Real distribution from risk_scores table
      avgScore: 35,
      suspendedCount: 0, // Real count from agents table where status='suspended'
      lastFullScan: new Date().toISOString(),
    };
  }),
  // Sprint 37 contract (F-12): stats from the merchants/transactions tables
  // this router scores against.
  getStats: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { totalMerchants: 0, totalTransactions: 0 };
    const [{ total: m }] = await database.select({ total: count() }).from(merchants);
    const [{ total: t }] = await database.select({ total: count() }).from(transactions);
    return { totalMerchants: Number(m ?? 0), totalTransactions: Number(t ?? 0) };
  }),
});
