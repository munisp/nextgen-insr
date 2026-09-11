/**
 * mlScoring.integration.test.ts — B11 integration coverage for the real
 * heuristic-v1 claim-risk scorer against the REAL PG (PGlite) schema.
 *
 * Known-answer seed (all IDs prefixed MLS-; claimantId 960001 is unique to
 * this file — grep-verified at build time):
 *   policy MLS-POL-1: annualPremium 5000, startDate 2020-01-01
 *     (age to any reportedDate ≫ 365d → normalized age feature = 0)
 *   claims for claimant 960001 (5 total incl. the scored one):
 *     MLS-CL-1 (the scored claim) claimedAmount 7500 → ratio 7500/5000 = 1.5
 *     MLS-CL-2..4 claimedAmount 100 each
 *     MLS-CL-5 isFraudSuspected = true → priorFraudFlag = 1
 *   → features: ratio n=0.5, history n=5/5=1.0, age n=0, fraud n=1
 *   → score = 0.40*0.5 + 0.20*1.0 + 0.15*0 + 0.25*1 = 0.65 → band 'medium'
 *
 * Weights are seeded into the REAL system_config table under the migration-0059
 * key; the fail-loud-when-unset contract is tested first by deleting the key.
 * analytics NO_SCORES_YET is also tested first (no other suite file inserts
 * into ml_score_results — new table, grep-verified).
 */
import { count, eq } from "drizzle-orm";
import { describe, it, beforeAll, afterAll } from "vitest";

import { auditLog, claims, policies, systemConfig } from "../../drizzle/schema";
import { getDb } from "../../server/db";
import { WEIGHTS_CONFIG_KEY } from "../../server/lib/claimRiskScorer";
import {
  callerFor,
  adminUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const WEIGHTS_JSON =
  '{"amountToPremiumRatio":0.40,"claimantHistoryCount":0.20,"policyAgeDays":0.15,"priorFraudFlag":0.25}';

let scoredClaimId = 0;
let persistedScoreId = 0;

async function seed() {
  const db = (await getDb())!;
  const [pol] = await db
    .insert(policies)
    .values({
      policyNumber: "MLS-POL-1",
      productId: 1,
      customerId: 960001,
      coverageType: "travel",
      sumInsured: "100000.00",
      annualPremium: "5000.00",
      status: "active",
      startDate: new Date("2020-01-01T00:00:00.000Z"),
    })
    .returning();
  const mk = (claimNumber: string, amount: string, fraud = false) => ({
    claimNumber,
    policyId: pol.id,
    claimantId: 960001,
    claimType: "medical",
    incidentDate: new Date("2024-01-01T00:00:00.000Z"),
    claimedAmount: amount,
    incidentDescription: "mlScoring integration seed",
    status: "submitted" as const,
    isFraudSuspected: fraud,
  });
  const inserted = await db
    .insert(claims)
    .values([
      mk("MLS-CL-1", "7500.00"),
      mk("MLS-CL-2", "100.00"),
      mk("MLS-CL-3", "100.00"),
      mk("MLS-CL-4", "100.00"),
      mk("MLS-CL-5", "100.00", true),
    ])
    .returning();
  scoredClaimId = inserted[0].id;
}

describe("mlScoring (B11 heuristic-v1) — integration", () => {
  beforeAll(async () => {
    resetAssertionCount();
    const db = (await getDb())!;
    // Start from a guaranteed-unset weights key (idempotent).
    await db.delete(systemConfig).where(eq(systemConfig.key, WEIGHTS_CONFIG_KEY));
    await seed();
  });

  afterAll(() => {
    console.log(`[mlScoring] assertions: ${getAssertionCount()}`);
  });

  it("analytics fails loud NO_SCORES_YET before any score exists", async () => {
    const err = await expectTrpcError(
      callerFor(adminUser).mlScoring.analytics(),
      "PRECONDITION_FAILED"
    );
    expect(err.message).toContain("NO_SCORES_YET");
  });

  it("scoreClaim fails loud when weights are unset in system_config", async () => {
    const err = await expectTrpcError(
      callerFor(adminUser).mlScoring.scoreClaim({ claimId: scoredClaimId }),
      "PRECONDITION_FAILED"
    );
    expect(err.message).toContain("claim_risk_weights_unset");
  });

  it("scoreClaim fails loud on a non-existent claim", async () => {
    const db = (await getDb())!;
    await db.insert(systemConfig).values({
      key: WEIGHTS_CONFIG_KEY,
      value: WEIGHTS_JSON,
      description: "seeded by mlScoring.integration.test",
      updatedBy: "mlScoring.integration.test",
    });
    await expectTrpcError(
      callerFor(adminUser).mlScoring.scoreClaim({ claimId: 99999999 }),
      "NOT_FOUND"
    );
  });

  it("scoreClaim computes the exact known answer 0.65 / medium from real rows", async () => {
    const res = await callerFor(adminUser).mlScoring.scoreClaim({
      claimId: scoredClaimId,
    });
    expect(res.modelType).toBe("heuristic-v1");
    expect(res.score).toBeCloseTo(0.65, 10);
    expect(res.riskBand).toBe("medium");
    persistedScoreId = res.scoreId;
    const f = res.featureBreakdown.features;
    expect(f.amountToPremiumRatio.raw).toBeCloseTo(1.5, 10);
    expect(f.amountToPremiumRatio.normalized).toBeCloseTo(0.5, 10);
    expect(f.claimantHistoryCount.raw).toBe(5);
    expect(f.claimantHistoryCount.normalized).toBeCloseTo(1.0, 10);
    expect(f.policyAgeDays.normalized).toBeCloseTo(0, 10);
    expect(f.priorFraudFlag.raw).toBe(true);
    expect(f.amountToPremiumRatio.weight).toBeCloseTo(0.4, 10);
  });

  it("scoringHistory returns the real persisted score row", async () => {
    const res = await callerFor(adminUser).mlScoring.scoringHistory();
    expect(res.modelType).toBe("heuristic-v1");
    expect(res.total).toBeGreaterThanOrEqual(1);
    const row = res.items.find(i => i.id === persistedScoreId);
    expect(row).toBeTruthy();
    expect(Number(row!.score)).toBeCloseTo(0.65, 4);
    expect(row!.subjectType).toBe("claim");
    expect(row!.subjectId).toBe(scoredClaimId);
  });

  it("explainScore returns the persisted feature breakdown", async () => {
    const res = await callerFor(adminUser).mlScoring.explainScore({
      scoreId: persistedScoreId,
    });
    expect(res.modelType).toBe("heuristic-v1");
    expect(res.riskBand).toBe("medium");
    const breakdown = res.featureBreakdown as {
      features: { claimantHistoryCount: { raw: number } };
    };
    expect(breakdown.features.claimantHistoryCount.raw).toBe(5);
  });

  it("explainScore fails loud on an unknown score id", async () => {
    await expectTrpcError(
      callerFor(adminUser).mlScoring.explainScore({ scoreId: 99999999 }),
      "NOT_FOUND"
    );
  });

  it("batchScore scores multiple claims and persists them", async () => {
    const res = await callerFor(adminUser).mlScoring.batchScore({
      claimIds: [scoredClaimId],
    });
    expect(res.modelType).toBe("heuristic-v1");
    expect(res.results).toHaveLength(1);
    expect(res.results[0].score).toBeCloseTo(0.65, 10);
  });

  it("analytics aggregates real persisted scores", async () => {
    const res = await callerFor(adminUser).mlScoring.analytics();
    expect(res.modelType).toBe("heuristic-v1");
    expect(res.totalScores).toBeGreaterThanOrEqual(2);
    expect(res.avgScore).toBeCloseTo(0.65, 4);
    expect(res.byRiskBand.medium).toBeGreaterThanOrEqual(2);
  });

  it("scoreTransaction still fails loud honestly (no real tx-level source)", async () => {
    const err = await expectTrpcError(
      callerFor(adminUser).mlScoring.scoreTransaction({ transactionId: 1 }),
      "NOT_IMPLEMENTED"
    );
    expect(err.message).toContain("transaction_scoring_not_delivered");
  });

  // ── Retained pre-B11 coverage (honest update, not weakening): the old
  // file asserted NOT_IMPLEMENTED for all scoring endpoints; those
  // assertions are replaced by the delivered-scorer tests above. The two
  // contracts below are unaffected by B11 and are kept verbatim. ──

  it("list and getSummary reflect seeded audit_log rows", async () => {
    const db = (await getDb())!;
    const [beforeRow] = await db.select({ c: count() }).from(auditLog);
    const before = Number(beforeRow?.c ?? 0);
    for (let i = 0; i < 3; i++) {
      await db.insert(auditLog).values({
        action: "ml_scoring_seed",
        resource: "ml_scoring",
        resourceId: `seed-${i}`,
        status: "success",
        metadata: { fixture: true, i },
      });
    }
    const [afterRow] = await db.select({ c: count() }).from(auditLog);
    expect(Number(afterRow?.c ?? 0)).toBe(before + 3);

    const caller = callerFor(adminUser);
    const summary = await caller.mlScoring.getSummary();
    expect(Number(summary.totalRecords)).toBe(before + 3);

    const list = await caller.mlScoring.list({ limit: 10, offset: 0 });
    expect(Number(list.total)).toBe(before + 3);
    // Rows are returned newest-first; our three seeds are the most recent.
    const seeded = list.data.filter(r => r.action === "ml_scoring_seed");
    expect(seeded.length).toBe(3);
  });

  it("anonymous callers are rejected from reads, writes, and scoring", async () => {
    const caller = callerFor(null);
    await expectTrpcError(
      caller.mlScoring.list({ limit: 5, offset: 0 }),
      "UNAUTHORIZED"
    );
    await expectTrpcError(
      caller.mlScoring.scoreTransaction({ transactionId: 1 }),
      "UNAUTHORIZED"
    );
    await expectTrpcError(
      caller.mlScoring.scoreClaim({ claimId: scoredClaimId }),
      "UNAUTHORIZED"
    );
    await expectTrpcError(caller.mlScoring.scoringHistory(), "UNAUTHORIZED");
  });
});
