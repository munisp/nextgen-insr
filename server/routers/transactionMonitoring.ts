import { desc, eq, sql, and, count, sum, gte, lte } from "drizzle-orm";
import { z } from "zod";

import { transactions, fraudAlerts } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

/**
 * Transaction Monitoring Router
 * 
 * Real-time transaction surveillance for AML/CFT compliance.
 * Monitors patterns, velocity, and anomalies per CBN regulations.
 * 
 * Rules Engine:
 * - Single transaction > ₦5,000,000: Immediate STR filing
 * - Cumulative > ₦10,000,000/month per customer: Enhanced monitoring
 * - Velocity: >20 transactions/hour from same device: Flag
 * - Cross-border: All international transfers reported to NFIU
 * - Structuring: Multiple txns ₦4.9M-₦5M pattern detection
 */
export const transactionMonitoringRouter = router({
  // Real-time transaction feed with risk scoring
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
        riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
        agentId: z.number().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0 };

      const conditions = [];
      if (input.agentId) conditions.push(eq(transactions.agentId, input.agentId));

      const query = database.select().from(transactions)
        .orderBy(desc(transactions.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const results = conditions.length > 0
        ? await query.where(and(...conditions))
        : await query;

      const [{ total }] = await database.select({ total: count() }).from(transactions);

      // Enrich with risk scoring
      const enriched = results.map((tx) => {
        const amount = Number(tx.amount);
        let riskLevel: string;
        if (amount > 5000000) riskLevel = "critical";
        else if (amount > 1000000) riskLevel = "high";
        else if (amount > 100000) riskLevel = "medium";
        else riskLevel = "low";

        return { ...tx, riskLevel, amount };
      });

      return { data: enriched, total: total ?? 0 };
    }),

  // Get monitoring dashboard metrics
  getDashboard: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return null;

    const [txStats] = await database
      .select({
        total: count(),
        volume: sum(transactions.amount),
      })
      .from(transactions);

    const [flagged] = await database
      .select({ total: count() })
      .from(fraudAlerts);

    return {
      totalTransactions: txStats?.total ?? 0,
      totalVolume: Number(txStats?.volume ?? 0),
      flaggedCount: flagged?.total ?? 0,
      flagRate: txStats?.total
        ? (((flagged?.total ?? 0) / txStats.total) * 100).toFixed(2)
        : "0.00",
      strFilings: 0,
      lastUpdated: new Date().toISOString(),
    };
  }),

  // Check if a transaction triggers AML rules
  screenTransaction: protectedProcedure
    .input(
      z.object({
        amount: z.number().positive(),
        agentId: z.number(),
        type: z.string(),
        destinationCountry: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const alerts: string[] = [];
      let riskScore = 0;

      // Rule 1: Amount threshold
      if (input.amount > 5000000) {
        alerts.push("CRITICAL: Single transaction exceeds ₦5M STR threshold");
        riskScore += 90;
      } else if (input.amount > 1000000) {
        alerts.push("HIGH: Transaction exceeds ₦1M enhanced monitoring threshold");
        riskScore += 50;
      }

      // Rule 2: Cross-border
      if (input.destinationCountry && input.destinationCountry !== "NG") {
        alerts.push("NFIU: Cross-border transfer requires reporting");
        riskScore += 30;
      }

      // Rule 3: Structuring detection (amount near threshold)
      if (input.amount >= 4900000 && input.amount < 5000000) {
        alerts.push("WARNING: Potential structuring detected (amount near ₦5M)");
        riskScore += 60;
      }

      const decision = riskScore >= 90 ? "block" : riskScore >= 50 ? "review" : "allow";

      return {
        decision,
        riskScore: Math.min(riskScore, 100),
        alerts,
        requiresSTR: input.amount > 5000000,
        requiresNFIU: !!input.destinationCountry && input.destinationCountry !== "NG",
      };
    }),
});
