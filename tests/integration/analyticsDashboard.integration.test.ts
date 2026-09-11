/**
 * analyticsDashboard.integration.test.ts — F-12 (wave-5, B16) known-answer
 * tests for the 8 previously fail-loud AdminAnalytics surfaces (+ activeUsers)
 * against REAL seeded PG (PGlite) rows. Expected values are exact aggregates
 * of the rows seeded below (before/after deltas where the suite-shared
 * database makes absolutes unstable).
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { getDb } from "../../server/db";
import {
  agents,
  fraudAlerts,
  kycSessions,
  settlementReconciliation,
  transactions,
} from "../../drizzle/schema";
import {
  callerFor,
  adminUser,
  expectCounted as expect,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "analyticsDashboard";
const LOC = "W5-Analytics-Lokoja";
const AGENT_CODE = "AGT-W5-AN1";

let agentPk = 0;

async function seedTx(
  ref: string,
  opts: {
    type: "Cash In" | "Cash Out" | "Airtime";
    amount: number;
    fee: number;
    commission: number;
    status: "success" | "failed";
  }
) {
  const db = (await getDb())!;
  await db.insert(transactions).values({
    ref,
    agentId: agentPk,
    type: opts.type,
    amount: String(opts.amount),
    fee: String(opts.fee),
    commission: String(opts.commission),
    status: opts.status,
  });
}

describe("analyticsDashboard (F-12 wave-5, B16, real PG)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    const db = (await getDb())!;
    const [a] = await db
      .insert(agents)
      .values({
        agentId: AGENT_CODE,
        name: "W5 Analytics Agent",
        phone: `081${String(Math.floor(10000000 + Math.random() * 89999999))}`,
        pinHash: "f".repeat(64),
        isActive: true,
        premiumReserve: "0",
        location: LOC,
        creditScore: 42,
      })
      .returning();
    agentPk = a!.id;
  });
  afterAll(() => {
    // eslint-disable-next-line no-console
    console.log(`[${FILE}] assertions: ${getAssertionCount()}`);
  });

  it("kpiSummary reflects seeded transactions exactly (deltas)", async () => {
    const caller = callerFor(adminUser);
    const before = await caller.analyticsDashboard.kpiSummary();
    await seedTx("W5-KPI-1", {
      type: "Cash In",
      amount: 1000,
      fee: 10,
      commission: 3,
      status: "success",
    });
    await seedTx("W5-KPI-2", {
      type: "Cash Out",
      amount: 2000,
      fee: 20,
      commission: 6,
      status: "failed",
    });
    const after = await caller.analyticsDashboard.kpiSummary();
    expect(after.totalTransactions - before.totalTransactions).toBe(2);
    // Only the success row counts toward volume/fees/success rate.
    expect(after.successfulTransactions - before.successfulTransactions).toBe(1);
    expect(after.totalVolume - before.totalVolume).toBe(1000);
    expect(after.totalFees - before.totalFees).toBe(10);
    expect(after.activeAgents).toBeGreaterThanOrEqual(1);
  });

  it("agentOnboardingFunnel counts kyc_sessions by status", async () => {
    const caller = callerFor(adminUser);
    const db = (await getDb())!;
    const before = await caller.analyticsDashboard.agentOnboardingFunnel();
    await db.insert(kycSessions).values({
      agentId: agentPk,
      sessionRef: "W5-KYC-SESS-1",
      type: "agent_onboarding",
      status: "approved",
    });
    await db.insert(kycSessions).values({
      agentId: agentPk,
      sessionRef: "W5-KYC-SESS-2",
      type: "agent_onboarding",
      status: "rejected",
    });
    await db.insert(kycSessions).values({
      agentId: agentPk,
      sessionRef: "W5-KYC-SESS-3",
      type: "agent_onboarding",
      status: "pending",
    });
    const after = await caller.analyticsDashboard.agentOnboardingFunnel();
    expect(after.total - before.total).toBe(3);
    expect(after.approved - before.approved).toBe(1);
    expect(after.rejected - before.rejected).toBe(1);
    expect(after.pending - before.pending).toBe(1);
    expect(after.stages.length).toBeGreaterThanOrEqual(1);
  });

  it("fraudDetectionRates aggregates fraud_alerts by status/severity", async () => {
    const caller = callerFor(adminUser);
    const db = (await getDb())!;
    const before = await caller.analyticsDashboard.fraudDetectionRates();
    await db.insert(fraudAlerts).values({
      agentId: agentPk,
      severity: "high",
      type: "velocity",
      reason: "w5 test alert",
      status: "open",
    });
    await db.insert(fraudAlerts).values({
      agentId: agentPk,
      severity: "low",
      type: "geo",
      reason: "w5 test alert 2",
      status: "resolved",
    });
    const after = await caller.analyticsDashboard.fraudDetectionRates();
    expect(after.totalAlerts - before.totalAlerts).toBe(2);
    const openDelta =
      (after.byStatus.find((s) => s.status === "open")?.count ?? 0) -
      (before.byStatus.find((s) => s.status === "open")?.count ?? 0);
    expect(openDelta).toBe(1);
    const highDelta =
      (after.bySeverity.find((s) => s.severity === "high")?.count ?? 0) -
      (before.bySeverity.find((s) => s.severity === "high")?.count ?? 0);
    expect(highDelta).toBe(1);
  });

  it("revenueBreakdown sums fee/commission by type for success rows", async () => {
    const caller = callerFor(adminUser);
    const before = await caller.analyticsDashboard.revenueBreakdown();
    await seedTx("W5-REV-1", {
      type: "Airtime",
      amount: 500,
      fee: 5,
      commission: 2,
      status: "success",
    });
    await seedTx("W5-REV-2", {
      type: "Airtime",
      amount: 300,
      fee: 3,
      commission: 1,
      status: "success",
    });
    await seedTx("W5-REV-3", {
      type: "Airtime",
      amount: 999,
      fee: 9,
      commission: 9,
      status: "failed",
    });
    const after = await caller.analyticsDashboard.revenueBreakdown();
    const bAir = before.byType.find((t) => t.type === "Airtime");
    const aAir = after.byType.find((t) => t.type === "Airtime");
    expect((aAir?.count ?? 0) - (bAir?.count ?? 0)).toBe(2);
    expect((aAir?.fees ?? 0) - (bAir?.fees ?? 0)).toBe(8);
    expect((aAir?.commission ?? 0) - (bAir?.commission ?? 0)).toBe(3);
    expect(after.totalFees - before.totalFees).toBe(8);
  });

  it("geographicDistribution groups agents by location with joined volume", async () => {
    const caller = callerFor(adminUser);
    await seedTx("W5-GEO-1", {
      type: "Cash In",
      amount: 700,
      fee: 7,
      commission: 2,
      status: "success",
    });
    const result = await caller.analyticsDashboard.geographicDistribution();
    const loc = result.byLocation.find((l) => l.location === LOC);
    expect(loc).toBeDefined();
    expect(loc!.agentCount).toBe(1);
    // Success volume for this agent so far:
    // KPI-1 (1000) + REV-1 (500) + REV-2 (300) + GEO-1 (700) = 2500.
    expect(loc!.volume).toBe(2500);
  });

  it("settlementTrend groups settlement_reconciliation by date", async () => {
    const caller = callerFor(adminUser);
    const db = (await getDb())!;
    const date = "2099-01-15";
    await db.insert(settlementReconciliation).values({
      settlementDate: date,
      expectedAmount: "1000",
      actualAmount: "950",
      discrepancy: "50",
      status: "discrepancy",
    });
    await db.insert(settlementReconciliation).values({
      settlementDate: date,
      expectedAmount: "500",
      actualAmount: "500",
      discrepancy: "0",
      status: "matched",
    });
    const result = await caller.analyticsDashboard.settlementTrend({
      limit: 400,
    });
    const day = result.days.find((d) => d.date === date);
    expect(day).toBeDefined();
    expect(day!.count).toBe(2);
    expect(day!.expectedAmount).toBe(1500);
    expect(day!.actualAmount).toBe(1450);
    expect(day!.discrepancy).toBe(50);
    expect(day!.matchedCount).toBe(1);
  });

  it("kycApprovalTrend buckets seeded sessions by day", async () => {
    const caller = callerFor(adminUser);
    const result = await caller.analyticsDashboard.kycApprovalTrend({
      days: 30,
    });
    // The 3 onboarding sessions seeded above were created today.
    const today = new Date().toISOString().slice(0, 10);
    const day = result.days.find((d) => d.day.slice(0, 10) === today);
    expect(day).toBeDefined();
    expect(day!.total).toBeGreaterThanOrEqual(3);
    expect(day!.approved).toBeGreaterThanOrEqual(1);
    expect(day!.rejected).toBeGreaterThanOrEqual(1);
  });

  it("topAgents ranks the seeded agent by real volume/commission", async () => {
    const caller = callerFor(adminUser);
    const byVolume = await caller.analyticsDashboard.topAgents({
      sortBy: "volume",
      limit: 1000,
    });
    const mine = byVolume.agents.find((a) => a.agentCode === AGENT_CODE);
    expect(mine).toBeDefined();
    // success volume: 1000 + 500 + 300 + 700 = 2500; failed rows excluded.
    expect(mine!.volume).toBe(2500);
    expect(mine!.transactionCount).toBe(4);
    // commission: 3 + 2 + 1 + 2 = 8
    expect(mine!.commission).toBe(8);
    const byRating = await caller.analyticsDashboard.topAgents({
      sortBy: "rating",
      limit: 1000,
    });
    const rated = byRating.agents.find((a) => a.agentCode === AGENT_CODE);
    expect(rated!.creditScore).toBe(42);
  });

  it("activeUsers reports real lastSignedIn buckets", async () => {
    const caller = callerFor(adminUser);
    const result = await caller.analyticsDashboard.activeUsers();
    expect(result.totalUsers).toBeGreaterThanOrEqual(0);
    expect(result.active30d).toBeLessThanOrEqual(result.totalUsers);
    expect(result.active24h).toBeLessThanOrEqual(result.active7d);
    expect(result.active7d).toBeLessThanOrEqual(result.active30d);
  });
});
