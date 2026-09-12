/**
 * carrierTelemetry.integration.test.ts — B14 integration coverage for the
 * networkStatusDashboard carrier views over the REAL carrier-attributed
 * telemetry source (sim_probe_log, written in production by
 * simOrchestrator.ingestProbe). No mocks: rows are inserted through the real
 * drizzle schema and every aggregate assertion is a known-answer computed by
 * hand from the seeded rows.
 *
 * This is the only suite file that writes sim_probe_log /
 * network_alert_resolutions (grep-verified), so the fail-loud empty case
 * runs FIRST, before any row exists.
 *
 * Seeded truth (all within the last 24h so days:1 windows include them):
 *   MTN / T1 : latencies 100ms & 300ms, lossX10 10 & 10, scores 80 & 60
 *              -> avgLatency 200, p95 290, avgLossPct 1.0, avgScore 70
 *   GLO / T2 : latency 200ms, lossX10 20, score 70, geo-tagged
 *   AIR / T3 : 3 probes lossX10 100 (10% > 5% threshold), score 90
 *              -> one derived packet_loss alert
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";

import { simProbeLog } from "../../drizzle/schema";
import { networkAlertResolutions } from "../../drizzle/schema.additions";
import { getDb } from "../../server/db";
import {
  callerFor,
  adminUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "carrierTelemetry";
const NOW = Date.now();
const H = 3_600_000;

// SEED-SCOPING (day-boundary): getCarrierHeatmap groups by (carrier,
// date_trunc('day', probedAt)), so the three summary probes MUST share one
// UTC day or the known-answer cell count changes with the wall-clock hour
// the suite happens to run at (seeds at NOW-2H fall on the previous UTC day
// whenever NOW ∈ [00:00–02:00) UTC — observed as a 3-vs-2 cells failure in
// shared-suite CI when total runtime shifted the wall clock; same genre as
// the 'QR Payment' re-scope 9773f3e3). Anchoring to noon UTC today keeps all
// seeds inside the days:1 window (±12h of now) AND on one calendar day.
const NOON_UTC = new Date();
NOON_UTC.setUTCHours(12, 0, 0, 0);
const NOON = NOON_UTC.getTime();

function probe(over: Partial<typeof simProbeLog.$inferInsert> & { carrier: string; terminalId: string }) {
  return {
    agentId: "AGT-CARRIER-TEST",
    slot: "Phys1",
    mccMnc: 62130,
    rssi: -75,
    regStatus: 1,
    latencyMs: 100,
    packetLossX10: 10,
    score: 80,
    selected: true,
    probedAt: new Date(NOW - H),
    ...over,
  };
}

describe(`${FILE}: carrier telemetry views (B14)`, () => {
  beforeAll(() => {
    resetAssertionCount();
  });

  afterAll(async () => {
    // Leave the shared database as we found it (other suites assert
    // order-independent empty/precondition states).
    const db = (await getDb())!;
    await db.delete(networkAlertResolutions);
    await db.delete(simProbeLog).where(sql`${simProbeLog.agentId} = 'AGT-CARRIER-TEST'`);
    console.log(`[${FILE}] assertions: ${getAssertionCount()}`);
  });

  it("every carrier view fails loud NO_CARRIER_DATA while sim_probe_log is empty", async () => {
    const admin = callerFor(adminUser);
    for (const makeCall of [
      () => admin.networkStatusDashboard.getCarrierSummary({ days: 1 }),
      () => admin.networkStatusDashboard.getCarrierHeatmap({ days: 1 }),
      () => admin.networkStatusDashboard.getOverview({ days: 1 }),
      () => admin.networkStatusDashboard.getRegions({ days: 1 }),
      () => admin.networkStatusDashboard.getTimeSeries({ days: 1 }),
      () => admin.networkStatusDashboard.getAlerts(),
    ]) {
      const err = await expectTrpcError(makeCall(), "PRECONDITION_FAILED");
      expect(err.message).toContain("NO_CARRIER_DATA");
    }
  });

  it("getCarrierSummary returns hand-computed per-carrier aggregates", async () => {
    const db = (await getDb())!;
    await db.insert(simProbeLog).values([
      probe({ carrier: "MTN", terminalId: "T1", latencyMs: 100, score: 80, probedAt: new Date(NOON - 2 * H) }),
      probe({ carrier: "MTN", terminalId: "T1", latencyMs: 300, score: 60, probedAt: new Date(NOON - H) }),
      probe({ carrier: "GLO", terminalId: "T2", latencyMs: 200, packetLossX10: 20, score: 70, probedAt: new Date(NOON) }),
    ]);
    const admin = callerFor(adminUser);
    const res = await admin.networkStatusDashboard.getCarrierSummary({ days: 1 });
    expect(res.carriers.length).toBe(2);
    const mtn = res.carriers.find(c => c.carrier === "MTN")!;
    expect(mtn.probes).toBe(2);
    expect(mtn.terminals).toBe(1);
    expect(mtn.avgLatencyMs).toBe(200);
    // percentile_cont(0.95) over [100, 300] = 100 + 0.95 * 200
    expect(mtn.p95LatencyMs).toBe(290);
    expect(mtn.avgPacketLossPct).toBe(1);
    expect(mtn.avgScore).toBe(70);
    const glo = res.carriers.find(c => c.carrier === "GLO")!;
    expect(glo.avgPacketLossPct).toBe(2);
  });

  it("getRegions fails loud NO_GEO_DATA when no probes carry coordinates", async () => {
    const admin = callerFor(adminUser);
    const err = await expectTrpcError(
      admin.networkStatusDashboard.getRegions({ days: 1 }),
      "PRECONDITION_FAILED"
    );
    expect(err.message).toContain("NO_GEO_DATA");
  });

  it("getOverview/getHeatmap/getTimeSeries aggregate the same seeded rows", async () => {
    const admin = callerFor(adminUser);
    const overview = await admin.networkStatusDashboard.getOverview({ days: 1 });
    expect(overview.probes).toBe(3);
    expect(overview.carriers).toBe(2);
    expect(overview.terminals).toBe(2);
    // (100 + 300 + 200) / 3
    expect(overview.avgLatencyMs).toBe(200);
    const heatmap = await admin.networkStatusDashboard.getCarrierHeatmap({ days: 1 });
    expect(heatmap.cells.length).toBe(2);
    const series = await admin.networkStatusDashboard.getTimeSeries({ days: 1, carrier: "MTN" });
    const mtnPoints = series.points.reduce((a, p) => a + p.probes, 0);
    expect(mtnPoints).toBe(2);
  });

  it("getRegions aggregates real geo-tagged probes once coordinates exist", async () => {
    const db = (await getDb())!;
    await db
      .update(simProbeLog)
      .set({ latE6: 6524000, lonE6: 3379000 })
      .where(sql`${simProbeLog.terminalId} = 'T2'`);
    const admin = callerFor(adminUser);
    const res = await admin.networkStatusDashboard.getRegions({ days: 1 });
    expect(res.regions.length).toBe(1);
    expect(res.regions[0]!.lat).toBeCloseTo(6.52, 2);
    expect(res.regions[0]!.probes).toBe(1);
  });

  it("getAlerts derives real threshold breaches; resolveAlert persists the resolution", async () => {
    const db = (await getDb())!;
    // 3 probes at 10% loss on AIRTEL/T3 -> packet_loss alert (threshold 5%).
    await db.insert(simProbeLog).values([
      probe({ carrier: "AIR", terminalId: "T3", packetLossX10: 100, score: 90, probedAt: new Date(NOW - 3 * H) }),
      probe({ carrier: "AIR", terminalId: "T3", packetLossX10: 100, score: 90, probedAt: new Date(NOW - 2 * H) }),
      probe({ carrier: "AIR", terminalId: "T3", packetLossX10: 100, score: 90, probedAt: new Date(NOW - H) }),
    ]);
    const admin = callerFor(adminUser);
    const first = await admin.networkStatusDashboard.getAlerts();
    const loss = first.alerts.filter(a => a.type === "packet_loss");
    expect(loss.length).toBe(1);
    expect(loss[0]!.alertKey).toBe("packet_loss|AIR|T3");
    expect(loss[0]!.measuredValue).toBe(10);
    expect(loss[0]!.threshold).toBe(5);
    expect(loss[0]!.resolved).toBe(false);

    const resolved = await admin.networkStatusDashboard.resolveAlert({
      alertId: "packet_loss|AIR|T3",
      resolution: "field terminal antenna reseated",
    });
    expect(resolved.success).toBe(true);

    const second = await admin.networkStatusDashboard.getAlerts();
    const after = second.alerts.find(a => a.alertKey === "packet_loss|AIR|T3")!;
    expect(after.resolved).toBe(true);
    expect(after.resolution).toBe("field terminal antenna reseated");
    expect(after.resolvedAt).not.toBeNull();
  });
});
