import { TRPCError } from "@trpc/server";
import { desc, eq, and, count, sql } from "drizzle-orm";
import { z } from "zod";

import { auditLog, claims, policies } from "../../drizzle/schema";
import { mlScoreResults } from "../../drizzle/schema.additions";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  computeClaimRiskScore,
  loadClaimRiskWeights,
  MODEL_TYPE,
  type ClaimRiskRawFeatures,
} from "../lib/claimRiskScorer";

// B11 (zero-undelivered-scope wave 2c): this service now runs a REAL in-repo
// statistical scorer — modelType 'heuristic-v1', a transparent weighted
// formula over documented real features (claims + policies rows), weights
// from system_config (fail-loud when unset). It is NOT trained ML and every
// response carries modelType + featureBreakdown so nothing pretends to be.
// Scores are persisted to ml_score_results; history/analytics/explain read
// those real rows. scoreTransaction (transaction-level scoring) has no real
// feature source and fails loud honestly.
//
// The list/getById/getSummary/getRecent queries read real audit_log rows.

const NO_DB = () =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "scoring_database_unavailable: no database connection",
  });

async function extractClaimFeatures(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  claimId: number
): Promise<{ features: ClaimRiskRawFeatures; claim: typeof claims.$inferSelect }> {
  const [claim] = await db
    .select()
    .from(claims)
    .where(eq(claims.id, claimId))
    .limit(1);
  if (!claim) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `claim_not_found: no claims row with id ${claimId}`,
    });
  }
  const [policy] = await db
    .select()
    .from(policies)
    .where(eq(policies.id, claim.policyId))
    .limit(1);
  if (!policy) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `claim_policy_missing: claims row ${claimId} references policies id ${claim.policyId} which does not exist`,
    });
  }

  const claimedAmount = Number(claim.claimedAmount);
  const annualPremium = Number(policy.annualPremium);
  if (!Number.isFinite(annualPremium) || annualPremium <= 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `policy_premium_invalid: policies id ${policy.id} annualPremium is '${policy.annualPremium}' — cannot compute amountToPremiumRatio`,
    });
  }

  const [historyRow] = await db
    .select({ total: count() })
    .from(claims)
    .where(eq(claims.claimantId, claim.claimantId));
  const [fraudRow] = await db
    .select({ total: count() })
    .from(claims)
    .where(
      and(eq(claims.claimantId, claim.claimantId), eq(claims.isFraudSuspected, true))
    );

  const policyAgeDays =
    policy.startDate && claim.reportedDate
      ? Math.floor(
          (claim.reportedDate.getTime() - policy.startDate.getTime()) /
            86_400_000
        )
      : null;

  return {
    claim,
    features: {
      amountToPremiumRatio: claimedAmount / annualPremium,
      claimantHistoryCount: Number(historyRow?.total ?? 0),
      policyAgeDays,
      priorFraudFlag: Number(fraudRow?.total ?? 0) > 0,
    },
  };
}

export const mlScoringServiceRouter = router({
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
          .from(auditLog)
          .orderBy(desc(auditLog.id))
          .limit(input.limit)
          .offset(input.offset);

        const _totalRows = await database
          .select({ total: count() })
          .from(auditLog);
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
    const _totalRows = await database.select({ total: count() }).from(auditLog);
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
      const results = await database
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.id))
        .limit(input.limit);

      return results;
    }),

  // ── B11: real heuristic-v1 claim-risk scoring ─────────────────────────────

  scoreClaim: protectedProcedure
    .input(z.object({ claimId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) throw NO_DB();
      const weights = await loadClaimRiskWeights(database);
      const { features } = await extractClaimFeatures(database, input.claimId);
      const result = computeClaimRiskScore(features, weights);

      const [persisted] = await database
        .insert(mlScoreResults)
        .values({
          subjectType: "claim",
          subjectId: input.claimId,
          modelType: MODEL_TYPE,
          score: result.score.toFixed(5),
          riskBand: result.riskBand,
          featureBreakdownJson: result.featureBreakdown,
          scoredBy: ctx.user?.email ?? ctx.user?.id?.toString() ?? null,
        })
        .returning();

      return {
        scoreId: persisted.id,
        claimId: input.claimId,
        score: result.score,
        riskBand: result.riskBand,
        modelType: MODEL_TYPE,
        featureBreakdown: result.featureBreakdown,
      };
    }),

  batchScore: protectedProcedure
    .input(z.object({ claimIds: z.array(z.number().int().positive()).min(1).max(100) }))
    .mutation(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) throw NO_DB();
      const weights = await loadClaimRiskWeights(database);
      const results = [];
      for (const claimId of input.claimIds) {
        const { features } = await extractClaimFeatures(database, claimId);
        const result = computeClaimRiskScore(features, weights);
        const [persisted] = await database
          .insert(mlScoreResults)
          .values({
            subjectType: "claim",
            subjectId: claimId,
            modelType: MODEL_TYPE,
            score: result.score.toFixed(5),
            riskBand: result.riskBand,
            featureBreakdownJson: result.featureBreakdown,
            scoredBy: ctx.user?.email ?? ctx.user?.id?.toString() ?? null,
          })
          .returning();
        results.push({
          scoreId: persisted.id,
          claimId,
          score: result.score,
          riskBand: result.riskBand,
          modelType: MODEL_TYPE,
        });
      }
      return { modelType: MODEL_TYPE, results };
    }),

  explainScore: protectedProcedure
    .input(z.object({ scoreId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw NO_DB();
      const [row] = await database
        .select()
        .from(mlScoreResults)
        .where(eq(mlScoreResults.id, input.scoreId))
        .limit(1);
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `score_not_found: no ml_score_results row with id ${input.scoreId}`,
        });
      }
      return {
        scoreId: row.id,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        score: Number(row.score),
        riskBand: row.riskBand,
        modelType: row.modelType,
        featureBreakdown: row.featureBreakdownJson,
        createdAt: row.createdAt,
      };
    }),

  // Real aggregates over persisted ml_score_results rows. Fail loud when no
  // score has ever been computed — never an honest-looking zero dashboard.
  analytics: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) throw NO_DB();
    const [agg] = await database
      .select({
        total: count(),
        avg: sql<string>`AVG(${mlScoreResults.score})`,
        min: sql<string>`MIN(${mlScoreResults.score})`,
        max: sql<string>`MAX(${mlScoreResults.score})`,
      })
      .from(mlScoreResults);
    const total = Number(agg?.total ?? 0);
    if (total === 0) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "NO_SCORES_YET: no ml_score_results rows — score a claim first (heuristic-v1)",
      });
    }
    const bandRows = await database
      .select({
        band: mlScoreResults.riskBand,
        total: count(),
      })
      .from(mlScoreResults)
      .groupBy(mlScoreResults.riskBand);
    return {
      modelType: MODEL_TYPE,
      totalScores: total,
      avgScore: Number(agg.avg),
      minScore: Number(agg.min),
      maxScore: Number(agg.max),
      byRiskBand: Object.fromEntries(bandRows.map(r => [r.band, Number(r.total)])),
    };
  }),

  // Transaction-level scoring has no delivered real feature source (claims
  // are the scored subject of heuristic-v1). Fail loud, never a proxy score.
  scoreTransaction: protectedProcedure
    .input(
      z.object({ transactionId: z.number(), amount: z.number().optional() })
    )
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message:
          "transaction_scoring_not_delivered: heuristic-v1 scores claims (scoreClaim); no real transaction-level feature source exists",
      });
    }),

  // Real persisted score history from ml_score_results (empty when no claim
  // has been scored yet — an honest reflection of the store).
  scoringHistory: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(100).default(20),
          offset: z.number().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw NO_DB();
      const limit = input?.limit ?? 20;
      const offset = input?.offset ?? 0;
      const rows = await database
        .select()
        .from(mlScoreResults)
        .orderBy(desc(mlScoreResults.id))
        .limit(limit)
        .offset(offset);
      const [{ total }] = await database
        .select({ total: count() })
        .from(mlScoreResults);
      return {
        modelType: MODEL_TYPE,
        items: rows,
        total: Number(total ?? 0),
        limit,
        offset,
      };
    }),
});
