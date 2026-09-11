/**
 * weeklyReports.integration.test.ts — B7 integration coverage for the weekly
 * report document engine against the REAL PG (PGlite) schema.
 *
 * Rows are seeded directly into the real tables (transactions / premiums /
 * claims / policies / agents) — no mocks. All period-bound seeds use a
 * 1986-03-03..1986-03-10 window (a complete ISO week) that no other suite
 * file touches (verified by grep at build time: 1986 appears nowhere else in
 * tests/integration), so the windowed expected values below are exact known
 * answers. Book-level counts (active policies / active agents) are asserted
 * as baseline+N because other suite files legitimately seed those tables.
 *
 * Seeded truth (window 1986-03-03T00:00:00Z .. 1986-03-10T00:00:00Z):
 *   transactions: success 100.00 (fee 1.50, commission 0.50),
 *                 success 200.00 (fee 0, commission 0),
 *                 failed 300.00, pending 50.00,
 *                 success 999.00 OUTSIDE the window,
 *                 success 777.00 soft-deleted inside the window
 *             → totalCount 4, successCount 2, failedCount 1, pendingCount 1,
 *               successVolume 300, successFees 1.5, successCommission 0.5,
 *               byType: "Cash In"×2, "Cash Out"×1, "Transfer"×1
 *   premiums: paid 1000 + paid 2000 (same policy, paidDate in window),
 *             one 'due' premium in the window (never counted),
 *             one paid premium with paidDate OUTSIDE the window
 *             → paidCount 2, paidAmount 3000, distinctPolicies 1
 *   claims: 2 submitted (createdAt in window),
 *           2 settled-paid in window (paidAmount 500 + 700),
 *           1 settled-paid OUTSIDE the window
 *             → submittedCount 2, settledCount 2, settledPaidAmount 1200
 *   policies: 2 created in window → newCount 2; activeCount = baseline + 2
 *   agents: 1 created in window → newCount 1; activeCount = baseline + 1
 *           (one soft-deleted agent seeded in window is NOT active)
 */
import { sql } from "drizzle-orm";
import { describe, it, beforeAll, afterAll } from "vitest";

import {
  agents,
  claims,
  policies,
  transactions,
} from "../../drizzle/schema";
import { premiums } from "../../drizzle/schema.additions";
import { getDb } from "../../server/db";
import type { WeeklyReportSections } from "../../server/lib/weeklyReport";
import {
  callerFor,
  adminUser,
  regularUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "weeklyReports";

// 1986 ISO week (Mon..Mon): no other integration file seeds period-bound
// rows in 1986 (grep-verified), so windowed counts are exact known answers.
const WEEK_START = "1986-03-03T00:00:00.000Z";
const WEEK_END = "1986-03-10T00:00:00.000Z";
const IN_WEEK = "1986-03-05T12:00:00.000Z";
const OUTSIDE_WEEK = "1986-04-01T00:00:00.000Z";

let baselineActivePolicies = 0;
let baselineActiveAgents = 0;
let generatedReportId = 0;

async function seed() {
  const db = (await getDb())!;

  const [basePol] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(policies)
    .where(sql`${policies.status} = 'active'`);
  baselineActivePolicies = Number(basePol.count);
  const [baseAg] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(agents)
    .where(sql`${agents.isActive} AND ${agents.deletedAt} IS NULL`);
  baselineActiveAgents = Number(baseAg.count);

  // Agents (policy.agentId / transaction.agentId / premium.agentId targets).
  const [agent1] = await db
    .insert(agents)
    .values({
      agentId: "WRK-AG-1",
      name: "Weekly Report Agent 1",
      phone: "08000000001",
      pinHash: "wrk-test-pin-hash-1",
      isActive: true,
      createdAt: new Date(IN_WEEK),
    })
    .returning();
  await db.insert(agents).values({
    agentId: "WRK-AG-2",
    name: "Weekly Report Agent 2",
    phone: "08000000002",
    pinHash: "wrk-test-pin-hash-2",
    isActive: false,
    deletedAt: new Date(IN_WEEK),
    createdAt: new Date(IN_WEEK),
  });

  // Policies: 2 active, both created in window.
  const [pol1] = await db
    .insert(policies)
    .values({
      policyNumber: "WRK-POL-1",
      productId: 1,
      customerId: 980001,
      agentId: agent1.id,
      coverageType: "travel",
      sumInsured: "100000.00",
      annualPremium: "5000.00",
      status: "active",
      createdAt: new Date(IN_WEEK),
    })
    .returning();
  await db.insert(policies).values({
    policyNumber: "WRK-POL-2",
    productId: 1,
    customerId: 980002,
    coverageType: "travel",
    sumInsured: "200000.00",
    annualPremium: "9000.00",
    status: "active",
    createdAt: new Date(IN_WEEK),
  });

  // Transactions.
  await db.insert(transactions).values([
    {
      ref: "WRK-TX-1",
      agentId: agent1.id,
      type: "Cash In",
      amount: "100.00",
      fee: "1.50",
      commission: "0.50",
      status: "success",
      createdAt: new Date(IN_WEEK),
    },
    {
      ref: "WRK-TX-2",
      agentId: agent1.id,
      type: "Cash In",
      amount: "200.00",
      status: "success",
      createdAt: new Date(IN_WEEK),
    },
    {
      ref: "WRK-TX-3",
      agentId: agent1.id,
      type: "Cash Out",
      amount: "300.00",
      status: "failed",
      createdAt: new Date(IN_WEEK),
    },
    {
      ref: "WRK-TX-4",
      agentId: agent1.id,
      type: "Transfer",
      amount: "50.00",
      status: "pending",
      createdAt: new Date(IN_WEEK),
    },
    {
      ref: "WRK-TX-5",
      agentId: agent1.id,
      type: "Cash In",
      amount: "999.00",
      status: "success",
      createdAt: new Date(OUTSIDE_WEEK),
    },
    {
      ref: "WRK-TX-6",
      agentId: agent1.id,
      type: "Cash In",
      amount: "777.00",
      status: "success",
      deletedAt: new Date(IN_WEEK),
      createdAt: new Date(IN_WEEK),
    },
  ]);

  // Premiums.
  await db.insert(premiums).values([
    {
      policyId: pol1.id,
      premiumRef: "WRK-PR-1",
      amount: "1000.00",
      dueDate: new Date(IN_WEEK),
      paidDate: new Date(IN_WEEK),
      status: "paid",
    },
    {
      policyId: pol1.id,
      premiumRef: "WRK-PR-2",
      amount: "2000.00",
      dueDate: new Date(IN_WEEK),
      paidDate: new Date(IN_WEEK),
      status: "paid",
    },
    {
      policyId: pol1.id,
      premiumRef: "WRK-PR-3",
      amount: "4000.00",
      dueDate: new Date(IN_WEEK),
      status: "due",
    },
    {
      policyId: pol1.id,
      premiumRef: "WRK-PR-4",
      amount: "8000.00",
      dueDate: new Date(OUTSIDE_WEEK),
      paidDate: new Date(OUTSIDE_WEEK),
      status: "paid",
    },
  ]);

  // Claims.
  await db.insert(claims).values([
    {
      claimNumber: "WRK-CL-1",
      policyId: pol1.id,
      claimantId: 980001,
      claimType: "medical",
      incidentDate: new Date(IN_WEEK),
      claimedAmount: "1000.00",
      incidentDescription: "weekly report test claim 1",
      status: "submitted",
      createdAt: new Date(IN_WEEK),
    },
    {
      claimNumber: "WRK-CL-2",
      policyId: pol1.id,
      claimantId: 980001,
      claimType: "medical",
      incidentDate: new Date(IN_WEEK),
      claimedAmount: "2000.00",
      incidentDescription: "weekly report test claim 2",
      status: "submitted",
      createdAt: new Date(IN_WEEK),
    },
    {
      claimNumber: "WRK-CL-3",
      policyId: pol1.id,
      claimantId: 980001,
      claimType: "medical",
      incidentDate: new Date(IN_WEEK),
      claimedAmount: "500.00",
      paidAmount: "500.00",
      incidentDescription: "weekly report settled claim 1",
      status: "paid",
      settlementDate: new Date(IN_WEEK),
      createdAt: new Date(OUTSIDE_WEEK),
    },
    {
      claimNumber: "WRK-CL-4",
      policyId: pol1.id,
      claimantId: 980001,
      claimType: "medical",
      incidentDate: new Date(IN_WEEK),
      claimedAmount: "700.00",
      paidAmount: "700.00",
      incidentDescription: "weekly report settled claim 2",
      status: "paid",
      settlementDate: new Date(IN_WEEK),
      createdAt: new Date(OUTSIDE_WEEK),
    },
    {
      claimNumber: "WRK-CL-5",
      policyId: pol1.id,
      claimantId: 980001,
      claimType: "medical",
      incidentDate: new Date(IN_WEEK),
      claimedAmount: "9000.00",
      paidAmount: "9000.00",
      incidentDescription: "weekly report settled claim outside window",
      status: "paid",
      settlementDate: new Date(OUTSIDE_WEEK),
      createdAt: new Date(OUTSIDE_WEEK),
    },
  ]);
}

describe(`${FILE}: weekly report document engine (B7)`, () => {
  beforeAll(async () => {
    resetAssertionCount();
    await seed();
  });

  afterAll(() => {
    console.log(`[${FILE}] assertions: ${getAssertionCount()}`);
  });

  it("generateWeeklyReport computes every section from real seeded rows (known answers)", async () => {
    const admin = callerFor(adminUser);
    const report = await admin.weeklyReports.generateWeeklyReport({
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    });
    generatedReportId = report.id;
    expect(report.status).toBe("completed");
    expect(report.generatedBy).toBe(adminUser.id);
    expect(new Date(report.weekStart).toISOString()).toBe(WEEK_START);
    expect(new Date(report.weekEnd).toISOString()).toBe(WEEK_END);

    const sections = report.sectionsJson as WeeklyReportSections;

    const tx = sections.transactions;
    expect(tx?.totalCount).toBe(4);
    expect(tx?.successCount).toBe(2);
    expect(tx?.failedCount).toBe(1);
    expect(tx?.pendingCount).toBe(1);
    expect(tx?.successVolume).toBe(300);
    expect(tx?.successFees).toBe(1.5);
    expect(tx?.successCommission).toBe(0.5);
    expect(tx?.byType).toEqual([
      { type: "Cash In", count: 2 },
      { type: "Cash Out", count: 1 },
      { type: "Transfer", count: 1 },
    ]);

    const pr = sections.premiums;
    expect(pr?.paidCount).toBe(2);
    expect(pr?.paidAmount).toBe(3000);
    expect(pr?.distinctPolicies).toBe(1);

    const cl = sections.claims;
    expect(cl?.submittedCount).toBe(2);
    expect(cl?.settledCount).toBe(2);
    expect(cl?.settledPaidAmount).toBe(1200);

    const po = sections.policies;
    expect(po?.newCount).toBe(2);
    expect(po?.activeCount).toBe(baselineActivePolicies + 2);

    const ag = sections.agents;
    expect(ag?.newCount).toBe(2);
    expect(ag?.activeCount).toBe(baselineActiveAgents + 1);

    expect(sections.unavailableSections).toEqual([]);
  });

  it("requested sections with no data source are marked 'no_data_source', never fabricated", async () => {
    const admin = callerFor(adminUser);
    const report = await admin.weeklyReports.generateWeeklyReport({
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
      sections: ["transactions", "fraud_trends"],
    });
    const sections = report.sectionsJson as WeeklyReportSections;
    expect(sections.transactions?.totalCount).toBe(4);
    expect(sections.premiums).toBeUndefined();
    expect(sections.unavailableSections).toEqual([
      {
        section: "fraud_trends",
        status: "no_data_source",
        reason:
          "section 'fraud_trends' has no delivered data source in the runtime schema — omitted rather than fabricated",
      },
    ]);
  });

  it("getWeeklyReport returns the persisted document; unknown id fails NOT_FOUND", async () => {
    const admin = callerFor(adminUser);
    const fetched = await admin.weeklyReports.getWeeklyReport({
      id: generatedReportId,
    });
    expect(fetched.id).toBe(generatedReportId);
    expect(
      (fetched.sectionsJson as WeeklyReportSections).premiums?.paidAmount
    ).toBe(3000);
    await expectTrpcError(
      admin.weeklyReports.getWeeklyReport({ id: -1 }),
      "NOT_FOUND"
    );
  });

  it("latest returns the most recent generated report", async () => {
    const admin = callerFor(adminUser);
    const latest = await admin.weeklyReports.latest();
    expect(new Date(latest.weekStart).toISOString()).toBe(WEEK_START);
  });

  it("listWeeklyReports paginates the catalog", async () => {
    const admin = callerFor(adminUser);
    const page = await admin.weeklyReports.listWeeklyReports({
      limit: 1,
      offset: 0,
    });
    expect(page.data.length).toBe(1);
    expect(page.total).toBeGreaterThanOrEqual(2);
    const page2 = await admin.weeklyReports.listWeeklyReports({
      limit: 1,
      offset: 1,
    });
    expect(page2.data.length).toBe(1);
    expect(page2.data[0].id).not.toBe(page.data[0].id);
  });

  it("rejects a half-specified window (weekStart without weekEnd)", async () => {
    const admin = callerFor(adminUser);
    await expectTrpcError(
      admin.weeklyReports.generateWeeklyReport({ weekStart: WEEK_START }),
      "BAD_REQUEST"
    );
  });

  it("rejects an inverted window", async () => {
    const admin = callerFor(adminUser);
    await expectTrpcError(
      admin.weeklyReports.generateWeeklyReport({
        weekStart: WEEK_END,
        weekEnd: WEEK_START,
      }),
      "BAD_REQUEST"
    );
  });

  it("generateWeeklyReport is admin-gated: regular user FORBIDDEN, anonymous UNAUTHORIZED", async () => {
    const regular = callerFor(regularUser);
    await expectTrpcError(
      regular.weeklyReports.generateWeeklyReport({
        weekStart: WEEK_START,
        weekEnd: WEEK_END,
      }),
      "FORBIDDEN"
    );
    const anon = callerFor(null);
    await expectTrpcError(
      anon.weeklyReports.generateWeeklyReport({
        weekStart: WEEK_START,
        weekEnd: WEEK_END,
      }),
      "UNAUTHORIZED"
    );
  });

  it("undelivered delivery surfaces still fail loud NOT_IMPLEMENTED", async () => {
    const admin = callerFor(adminUser);
    await expectTrpcError(
      admin.weeklyReports.getSchedule(),
      "NOT_IMPLEMENTED"
    );
    await expectTrpcError(
      admin.weeklyReports.sendEmail(),
      "NOT_IMPLEMENTED"
    );
  });
});
