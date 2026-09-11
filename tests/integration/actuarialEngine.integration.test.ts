/**
 * actuarialEngine.integration.test.ts — F-11 integration coverage for the
 * actuarial pricing engine router against the REAL PG (PGlite) schema.
 *
 * Rows are seeded directly into the real tables (policies / premiums / claims
 * / system_config) — no mocks. All period-bound seeds use a 1990 window that
 * no other suite file touches, and the 'aviation' product line is unused by
 * every other integration file (verified by grep at build time), so the
 * expected values below are exact known answers, not approximations.
 *
 * Seeded truth (product line 'aviation'):
 *   policies: ACT-POL-A1 (active, annualPremium 100000),
 *             ACT-POL-A2 (active, annualPremium 300000)
 *             → currentPurePremium = AVG = 200000
 *   premiums (paid, paidDate in 1990): 40000 (A1) + 80000 (A2)
 *             → earnedPremium = 120000, exposures = 2
 *   claims (status 'paid', settlementDate in 1990): 30000 (A1) + 60000 (A2)
 *             → settledClaimsPaid = 90000, claimCount = 2
 *             → lossRatio = 90000 / 120000 = 0.75
 *   one 'submitted' claim (never counted as settled)
 *   product line 'marine': one policy + one paid premium (50000, 1990),
 *             zero claims → honest zero loss ratio; rate indication must
 *             fail loud (claimCount = 0); adequacy must fail loud (no config)
 */
import { eq } from "drizzle-orm";
import { describe, it, beforeAll, afterAll } from "vitest";

import {
  claims,
  policies,
  systemConfig,
} from "../../drizzle/schema";
import { premiums } from "../../drizzle/schema.additions";
import { getDb } from "../../server/db";
import {
  credibilityZ,
  indicatedPurePremium,
} from "../../server/lib/actuarial";
import {
  callerFor,
  adminUser,
  regularUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "actuarialEngine";

// 1990 window: no other integration file seeds period-bound rows here.
const PERIOD_START = "1990-01-01T00:00:00.000Z";
const PERIOD_END = "1990-12-31T23:59:59.000Z";

let policyA1Id: number;
let policyA2Id: number;
let policyMarineId: number;

async function seed() {
  const db = (await getDb())!;

  const [a1] = await db
    .insert(policies)
    .values({
      policyNumber: "ACT-POL-A1",
      productId: 1,
      customerId: 970001,
      coverageType: "aviation",
      sumInsured: "5000000.00",
      annualPremium: "100000.00",
      status: "active",
      startDate: new Date("1990-01-01T00:00:00Z"),
      endDate: new Date("1990-12-31T00:00:00Z"),
    })
    .returning();
  const [a2] = await db
    .insert(policies)
    .values({
      policyNumber: "ACT-POL-A2",
      productId: 1,
      customerId: 970002,
      coverageType: "aviation",
      sumInsured: "9000000.00",
      annualPremium: "300000.00",
      status: "active",
      startDate: new Date("1990-01-01T00:00:00Z"),
      endDate: new Date("1990-12-31T00:00:00Z"),
    })
    .returning();
  const [m1] = await db
    .insert(policies)
    .values({
      policyNumber: "ACT-POL-M1",
      productId: 1,
      customerId: 970003,
      coverageType: "marine",
      sumInsured: "1000000.00",
      annualPremium: "50000.00",
      status: "active",
      startDate: new Date("1990-01-01T00:00:00Z"),
      endDate: new Date("1990-12-31T00:00:00Z"),
    })
    .returning();
  policyA1Id = a1.id;
  policyA2Id = a2.id;
  policyMarineId = m1.id;

  await db.insert(premiums).values([
    {
      policyId: policyA1Id,
      premiumRef: "ACT-PREM-A1",
      amount: "40000.00",
      dueDate: new Date("1990-01-15T00:00:00Z"),
      paidDate: new Date("1990-06-01T00:00:00Z"),
      status: "paid",
    },
    {
      policyId: policyA2Id,
      premiumRef: "ACT-PREM-A2",
      amount: "80000.00",
      dueDate: new Date("1990-01-15T00:00:00Z"),
      paidDate: new Date("1990-06-01T00:00:00Z"),
      status: "paid",
    },
    {
      policyId: policyMarineId,
      premiumRef: "ACT-PREM-M1",
      amount: "50000.00",
      dueDate: new Date("1990-01-15T00:00:00Z"),
      paidDate: new Date("1990-06-01T00:00:00Z"),
      status: "paid",
    },
  ]);

  await db.insert(claims).values([
    {
      claimNumber: "ACT-CLM-A1",
      policyId: policyA1Id,
      claimantId: 970001,
      claimType: "hull_damage",
      incidentDate: new Date("1990-03-01T00:00:00Z"),
      claimedAmount: "30000.00",
      incidentDescription: "F-11 seed: settled aviation claim A1",
      status: "paid",
      paidAmount: "30000.00",
      settlementDate: new Date("1990-06-15T00:00:00Z"),
    },
    {
      claimNumber: "ACT-CLM-A2",
      policyId: policyA2Id,
      claimantId: 970002,
      claimType: "liability",
      incidentDate: new Date("1990-04-01T00:00:00Z"),
      claimedAmount: "60000.00",
      incidentDescription: "F-11 seed: settled aviation claim A2",
      status: "paid",
      paidAmount: "60000.00",
      settlementDate: new Date("1990-07-15T00:00:00Z"),
    },
    {
      claimNumber: "ACT-CLM-A3-OPEN",
      policyId: policyA1Id,
      claimantId: 970001,
      claimType: "hull_damage",
      incidentDate: new Date("1990-08-01T00:00:00Z"),
      claimedAmount: "99999.00",
      incidentDescription: "F-11 seed: open claim — must never be counted",
      status: "submitted",
    },
  ]);
}

describe("actuarialEngine router (F-11)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    await seed();
    const db = (await getDb())!;
    await db
      .insert(systemConfig)
      .values({
        key: "actuarial_target_loss_ratio_aviation",
        value: JSON.stringify({ targetLossRatio: 0.7, tolerance: 0.05 }),
        description: "F-11 integration seed: aviation target loss ratio",
      })
      .onConflictDoNothing();
  });

  afterAll(() => {
    console.log(`[${FILE}] assertions: ${getAssertionCount()}`);
  });

  // ── Admin gating ──────────────────────────────────────────────────────────
  it("rejects anonymous callers (UNAUTHORIZED)", async () => {
    const caller = callerFor(null);
    await expectTrpcError(
      caller.actuarialEngine.getLossRatios({
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      }),
      "UNAUTHORIZED"
    );
  });

  it("rejects non-admin users (FORBIDDEN) on every procedure", async () => {
    const caller = callerFor(regularUser);
    await expectTrpcError(
      caller.actuarialEngine.getLossRatios({
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      }),
      "FORBIDDEN"
    );
    await expectTrpcError(
      caller.actuarialEngine.getRateIndication({
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        productLine: "aviation",
      }),
      "FORBIDDEN"
    );
    await expectTrpcError(
      caller.actuarialEngine.getRateAdequacy({
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      }),
      "FORBIDDEN"
    );
    await expectTrpcError(caller.actuarialEngine.getExpenseLoading(), "FORBIDDEN");
  });

  // ── getLossRatios: known-answer math from real rows ───────────────────────
  it("computes the aviation loss ratio from seeded rows: 90000/120000 = 0.75", async () => {
    const caller = callerFor(adminUser);
    const res = await caller.actuarialEngine.getLossRatios({
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      productLine: "aviation",
    });
    expect(res.lines).toHaveLength(1);
    const line = res.lines[0];
    expect(line.productLine).toBe("aviation");
    expect(line.settledClaimsPaid).toBe(90000);
    expect(line.earnedPremium).toBe(120000);
    expect(line.lossRatio).toBe(0.75);
    // Only the two 'paid' claims count — the open claim is excluded.
    expect(line.claimCount).toBe(2);
    expect(typeof line.asOf).toBe("string");
    expect(typeof res.asOf).toBe("string");
  });

  it("returns an honest zero loss ratio for marine (premiums, no claims)", async () => {
    const caller = callerFor(adminUser);
    const res = await caller.actuarialEngine.getLossRatios({
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      productLine: "marine",
    });
    expect(res.lines).toHaveLength(1);
    expect(res.lines[0].lossRatio).toBe(0);
    expect(res.lines[0].claimCount).toBe(0);
    expect(res.lines[0].earnedPremium).toBe(50000);
  });

  it("fails loud PRECONDITION_FAILED when the period has zero premium rows", async () => {
    const caller = callerFor(adminUser);
    await expectTrpcError(
      caller.actuarialEngine.getLossRatios({
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        productLine: "travel",
      }),
      "PRECONDITION_FAILED"
    );
    // A window with no premium payments at all also fails loud.
    await expectTrpcError(
      caller.actuarialEngine.getLossRatios({
        periodStart: "1985-01-01T00:00:00.000Z",
        periodEnd: "1985-12-31T00:00:00.000Z",
      }),
      "PRECONDITION_FAILED"
    );
  });

  // ── getRateIndication: credibility blend with known answers ───────────────
  it("computes the credibility-weighted indication for aviation", async () => {
    const caller = callerFor(adminUser);
    const res = await caller.actuarialEngine.getRateIndication({
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      productLine: "aviation",
    });
    const expectedZ = credibilityZ(2); // sqrt(2/1082)
    const expectedObserved = 90000 / 2; // settled paid / exposures
    const expectedIndicated = indicatedPurePremium(
      expectedObserved,
      200000,
      expectedZ
    );
    expect(res.claimCount).toBe(2);
    expect(res.exposureCount).toBe(2);
    expect(res.credibilityZ).toBeCloseTo(expectedZ, 10);
    expect(res.observedPurePremium).toBeCloseTo(expectedObserved, 6);
    expect(res.currentPurePremium).toBeCloseTo(200000, 6);
    expect(res.indicatedPurePremium).toBeCloseTo(expectedIndicated, 6);
    expect(res.indicatedChangePct).toBeCloseTo(
      (expectedIndicated / 200000 - 1) * 100,
      6
    );
    expect(typeof res.asOf).toBe("string");
  });

  it("fails loud PRECONDITION_FAILED when claimCount is 0 (marine)", async () => {
    const caller = callerFor(adminUser);
    await expectTrpcError(
      caller.actuarialEngine.getRateIndication({
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        productLine: "marine",
      }),
      "PRECONDITION_FAILED"
    );
  });

  it("fails loud PRECONDITION_FAILED with no exposure base (travel)", async () => {
    const caller = callerFor(adminUser);
    await expectTrpcError(
      caller.actuarialEngine.getRateIndication({
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        productLine: "travel",
      }),
      "PRECONDITION_FAILED"
    );
  });

  // ── getRateAdequacy: config-driven, fail-loud when unset ──────────────────
  it("rates aviation at the inclusive tolerance boundary as 'adequate' (0.75 vs 0.70±0.05)", async () => {
    const caller = callerFor(adminUser);
    const res = await caller.actuarialEngine.getRateAdequacy({
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      productLine: "aviation",
    });
    expect(res.lines).toHaveLength(1);
    const line = res.lines[0];
    expect(line.lossRatio).toBe(0.75);
    expect(line.targetLossRatio).toBe(0.7);
    expect(line.tolerance).toBe(0.05);
    expect(line.adequacy).toBe("adequate");
    expect(line.claimCount).toBe(2);
  });

  it("fails loud PRECONDITION_FAILED when the target-loss-ratio config is unset (marine)", async () => {
    const caller = callerFor(adminUser);
    await expectTrpcError(
      caller.actuarialEngine.getRateAdequacy({
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        productLine: "marine",
      }),
      "PRECONDITION_FAILED"
    );
  });

  // ── getExpenseLoading: fail-loud until configured, then real values ───────
  it("fails loud PRECONDITION_FAILED while the expense-loading config is unset", async () => {
    const db = (await getDb())!;
    // Defensive: ensure the key is absent for this assertion (fresh PGlite
    // means it is; the delete keeps the test honest on reused databases).
    await db
      .delete(systemConfig)
      .where(eq(systemConfig.key, "actuarial_expense_loading"));
    const caller = callerFor(adminUser);
    await expectTrpcError(
      caller.actuarialEngine.getExpenseLoading(),
      "PRECONDITION_FAILED"
    );
  });

  it("returns the stored expense loading once configured", async () => {
    const db = (await getDb())!;
    await db
      .insert(systemConfig)
      .values({
        key: "actuarial_expense_loading",
        value: JSON.stringify({ expenseRatio: 0.25, profitLoadingPct: 5 }),
        description: "F-11 integration seed: expense loading",
      })
      .onConflictDoNothing();
    const caller = callerFor(adminUser);
    const res = await caller.actuarialEngine.getExpenseLoading();
    expect(res.expenseRatio).toBe(0.25);
    expect(res.profitLoadingPct).toBe(5);
    expect(res.sourceKey).toBe("actuarial_expense_loading");
    expect(typeof res.asOf).toBe("string");
  });
});
