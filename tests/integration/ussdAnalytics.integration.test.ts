/**
 * ussdAnalytics.integration.test.ts — B12 integration coverage for the real
 * USSD telemetry aggregates against the REAL PG (PGlite) schema.
 *
 * No other suite file inserts into ussd_session_events (new table,
 * grep-verified at build time), so all counts below are exact known answers.
 *
 * Seeded truth (all created_at NOW, inside the default 7-day window):
 *   session UAT-S1: events inputs "1", "2" (paths "1", "1>2"), 2nd end_session=true
 *   session UAT-S2: event input "1" (path "1"), end_session=false
 *   session UAT-S3: event input "3" (path "3"), end_session=false
 * → allTimeSessions 3, allTimeEvents 4, sessionsInWindow 3, eventsInWindow 4,
 *   completedSessionsInWindow 1, completionRate 33.3,
 *   sessionsToday 3, eventsToday 4,
 *   menuPaths: "1"×2, "1>2"×1, "3"×1; inputs: "1"×2, "2"×1, "3"×1
 * The NO_SESSIONS_YET fail-loud contracts are tested FIRST, before seeding.
 */
import { describe, it, beforeAll, afterAll } from "vitest";

import { ussdSessionEvents } from "../../drizzle/schema.additions";
import { getDb } from "../../server/db";
import {
  callerFor,
  adminUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

async function seed() {
  const db = (await getDb())!;
  await db.insert(ussdSessionEvents).values([
    {
      sessionId: "UAT-S1",
      phoneNumber: "08011111111",
      agentId: "UAT-AG-1",
      userInput: "1",
      menuPath: "1",
      gatewayResponse: "Cash In menu",
      endSession: false,
    },
    {
      sessionId: "UAT-S1",
      phoneNumber: "08011111111",
      agentId: "UAT-AG-1",
      userInput: "2",
      menuPath: "1>2",
      gatewayResponse: "Confirm cash in",
      endSession: true,
    },
    {
      sessionId: "UAT-S2",
      phoneNumber: "08022222222",
      agentId: "UAT-AG-2",
      userInput: "1",
      menuPath: "1",
      gatewayResponse: "Cash In menu",
      endSession: false,
    },
    {
      sessionId: "UAT-S3",
      phoneNumber: "08033333333",
      agentId: "UAT-AG-3",
      userInput: "3",
      menuPath: "3",
      gatewayResponse: "Balance",
      endSession: false,
    },
  ]);
}

describe("ussdAnalytics (B12) — integration", () => {
  beforeAll(() => {
    resetAssertionCount();
  });

  afterAll(() => {
    console.log(`[ussdAnalytics] assertions: ${getAssertionCount()}`);
  });

  it("getDashboard fails loud NO_SESSIONS_YET before any telemetry exists", async () => {
    const err = await expectTrpcError(
      callerFor(adminUser).ussdAnalytics.getDashboard({ days: 7 }),
      "PRECONDITION_FAILED"
    );
    expect(err.message).toContain("NO_SESSIONS_YET");
  });

  it("getMenuHeatmap fails loud NO_SESSIONS_YET before any telemetry exists", async () => {
    const err = await expectTrpcError(
      callerFor(adminUser).ussdAnalytics.getMenuHeatmap(),
      "PRECONDITION_FAILED"
    );
    expect(err.message).toContain("NO_SESSIONS_YET");
  });

  it("seed telemetry rows", async () => {
    await seed();
    const db = (await getDb())!;
    const rows = await db.select().from(ussdSessionEvents);
    expect(rows.length).toBe(4);
  });

  it("getDashboard computes exact known aggregates from real rows", async () => {
    const res = await callerFor(adminUser).ussdAnalytics.getDashboard({
      days: 7,
    });
    expect(res.allTimeSessions).toBe(3);
    expect(res.allTimeEvents).toBe(4);
    expect(res.sessionsInWindow).toBe(3);
    expect(res.eventsInWindow).toBe(4);
    expect(res.completedSessionsInWindow).toBe(1);
    expect(res.completionRate).toBeCloseTo(33.3, 1);
    expect(res.sessionsToday).toBe(3);
    expect(res.eventsToday).toBe(4);
    // UAT-S1 has 2 events → a real duration exists; exact value is
    // timing-dependent, asserted as non-null + non-negative instead.
    expect(res.avgSessionDurationSeconds).not.toBeNull();
    expect(res.avgSessionDurationSeconds!).toBeGreaterThanOrEqual(0);
    expect(res.dailyTrend.length).toBeGreaterThanOrEqual(1);
    const totalFromTrend = res.dailyTrend.reduce((a, d) => a + d.sessions, 0);
    expect(totalFromTrend).toBe(3);
  });

  it("getMenuHeatmap returns real menu-path and input frequencies", async () => {
    const res = await callerFor(adminUser).ussdAnalytics.getMenuHeatmap();
    expect(res.totalEvents).toBe(4);
    const paths = Object.fromEntries(
      res.menuPaths.map(p => [p.menuPath, p.hits])
    );
    expect(paths["1"]).toBe(2);
    expect(paths["1>2"]).toBe(1);
    expect(paths["3"]).toBe(1);
    const inputs = Object.fromEntries(res.inputs.map(i => [i.input, i.hits]));
    expect(inputs["1"]).toBe(2);
    expect(inputs["2"]).toBe(1);
    expect(inputs["3"]).toBe(1);
  });
});
