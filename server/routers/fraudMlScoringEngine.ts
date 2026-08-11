import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { eq, desc, sql, count, avg } from "drizzle-orm";
import {
  fraudMlScores,
  fraudAlerts,
  transactions,
  auditLog,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

// MOCKWARE FIX: No ML model is attached to this engine. The scorer is a
// simple amount-threshold RULES heuristic and is now honestly labelled
// "rules_amount_v1" (previously mislabeled as ML model "ensemble_v2").
// Alerts it raises say "rules engine", not "ML model".
const SCORER_ID = "rules_amount_v1";

export const fraudMlScoringEngineRouter = router({
  listScores: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().default(50),
          minScore: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(fraudMlScores)
          .orderBy(desc(fraudMlScores.createdAt))
          .limit(input?.limit ?? 50);
        return { scores: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getScore: protectedProcedure
    .input(z.object({ transactionId: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [score] = await db
          .select()
          .from(fraudMlScores)
          .where(eq(fraudMlScores.transactionId, input.transactionId))
          .limit(1);
        return score ?? null;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  scoreTransaction: protectedProcedure
    .input(
      z.object({
        transactionId: z.number(),
        features: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [tx] = await db
          .select()
          .from(transactions)
          .where(eq(transactions.id, input.transactionId))
          .limit(1);
        // Rules-based amount heuristic (NOT an ML model).
        const riskScore = tx
          ? Math.min(
              100,
              Math.max(
                0,
                Number(tx.amount) > 500000
                  ? 75
                  : Number(tx.amount) > 100000
                    ? 50
                    : 15
              )
            )
          : 0;
        const [score] = await db
          .insert(fraudMlScores)
          .values({
            transactionId: input.transactionId,
            score: riskScore,
            model: SCORER_ID,
            features: input.features ?? {},
          } as any)
          .returning();
        if (riskScore > 70) {
          await db.insert(fraudAlerts).values({
            transactionId: input.transactionId,
            severity: riskScore > 90 ? "critical" : "high",
            status: "open",
            description: "Rules engine (amount threshold) flagged high risk",
            riskScore,
          } as any);
        }
        await db.insert(auditLog).values({
          action: "fraud_rules_scored",
          resource: "fraud_ml_scores",
          resourceId: String(score.id),
          status: "success",
          metadata: { transactionId: input.transactionId, riskScore, scorer: SCORER_ID },
        } as any);
        return score;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getStats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [total] = await db
      .select({ value: count() })
      .from(fraudMlScores)
      .limit(100);
    const [avgScore] = await db
      .select({ value: avg(fraudMlScores.riskScore) })
      .from(fraudMlScores)
      .limit(100);
    const [alerts] = await db
      .select({ value: count() })
      .from(fraudAlerts)
      .limit(100);
    return {
      totalScored: Number(total.value),
      averageScore: Number(avgScore.value ?? 0),
      totalAlerts: Number(alerts.value),
    };
  }),
});
