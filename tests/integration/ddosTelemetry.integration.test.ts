/**
 * ddosTelemetry.integration.test.ts — B6 integration coverage for the DDoS
 * self-telemetry pipeline (RateWindowCounter -> ddos_rate_windows /
 * ddos_threshold_events -> securityAudit.getDDoSStatus) against the REAL PG
 * (PGlite) schema.
 *
 * Rate-window math cases run against a counter whose persist hook is
 * captured (pure, deterministic). The DB-facing cases run a counter against
 * the REAL default persistence and poll until the fire-and-forget insert
 * lands — nothing is stubbed on that path.
 *
 * This is the only suite file that writes ddos_rate_windows /
 * ddos_threshold_events (grep-verified), so the fail-loud empty case runs
 * FIRST, before any window exists.
 */
import { describe, it, beforeAll, afterAll } from "vitest";

import { ddosRateWindows, ddosThresholdEvents } from "../../drizzle/schema.additions";
import { getDb } from "../../server/db";
import {
  clientKeyFor,
  getDdosStatus,
  RateWindowCounter,
  windowStartFor,
} from "../../server/lib/ddosTelemetry";
import {
  callerFor,
  adminUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "ddosTelemetry";

type Row = { windowStart: Date; windowSeconds: number; clientKey: string; requestCount: number };
type Event = Row & { threshold: number };

async function waitFor(cond: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error("waitFor: condition not met within timeout");
}

describe(`${FILE}: DDoS self-telemetry (B6)`, () => {
  beforeAll(() => {
    resetAssertionCount();
  });

  afterAll(async () => {
    const db = (await getDb())!;
    await db.delete(ddosThresholdEvents);
    await db.delete(ddosRateWindows);
    console.log(`[${FILE}] assertions: ${getAssertionCount()}`);
  });

  it("getDDoSStatus fails loud PRECONDITION_FAILED while no window has been recorded", async () => {
    const admin = callerFor(adminUser);
    const err = await expectTrpcError(
      admin.securityAudit.getDDoSStatus({}),
      "PRECONDITION_FAILED"
    );
    expect(err.message).toContain("no request-rate windows");
  });

  it("window math: windowStartFor buckets timestamps exactly", () => {
    const t = new Date("2026-01-01T00:07:35.500Z");
    expect(windowStartFor(t, 60).toISOString()).toBe("2026-01-01T00:07:00.000Z");
    expect(windowStartFor(t, 300).toISOString()).toBe("2026-01-01T00:05:00.000Z");
    expect(windowStartFor(new Date(0), 60).getTime()).toBe(0);
  });

  it("counter flushes closed windows and emits exactly one breach event per window", () => {
    const rows: Row[] = [];
    const events: Event[] = [];
    const counter = new RateWindowCounter(
      { windowSeconds: 60, threshold: 3 },
      (r, e) => {
        rows.push(...r);
        events.push(...e);
      }
    );
    const w0 = new Date("2026-01-01T00:00:10.000Z");
    // 4 requests from A in window 00:00 -> threshold 3 crossed once.
    for (let i = 0; i < 4; i++) counter.record("A", new Date(w0.getTime() + i * 1000));
    expect(events.length).toBe(1);
    expect(events[0]!.clientKey).toBe("A");
    expect(events[0]!.requestCount).toBe(4);
    expect(events[0]!.threshold).toBe(3);
    expect(rows.length).toBe(0); // window still open
    // A request in the next window closes the previous one.
    counter.record("A", new Date("2026-01-01T00:01:01.000Z"));
    expect(rows.length).toBe(1);
    expect(rows[0]!.windowStart.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(rows[0]!.requestCount).toBe(4);
    expect(rows[0]!.windowSeconds).toBe(60);
    // Multiple clients close independently.
    counter.record("B", new Date("2026-01-01T00:01:02.000Z"));
    counter.record("A", new Date("2026-01-01T00:02:01.000Z"));
    expect(rows.length).toBe(3); // A@00:01 and B@00:01 flushed
    const flushed = rows.slice(1).map(r => `${r.clientKey}@${r.windowStart.toISOString()}`).sort();
    expect(flushed).toEqual(["A@2026-01-01T00:01:00.000Z", "B@2026-01-01T00:01:00.000Z"]);
    // flush() drains open buckets.
    counter.flush();
    expect(rows.length).toBe(4);
    expect(counter.openBuckets).toBe(0);
  });

  it("clientKeyFor is a stable 32-char sha256 truncation, never the raw IP", () => {
    const k1 = clientKeyFor("203.0.113.7");
    expect(k1).toBe(clientKeyFor("203.0.113.7"));
    expect(k1).toMatch(/^[0-9a-f]{32}$/);
    expect(k1).not.toContain("203.0.113.7");
    expect(clientKeyFor("203.0.113.8")).not.toBe(k1);
  });

  it("end-to-end: real persistence -> getDDoSStatus reports real windows and a real breach", async () => {
    // Counter against the REAL default persistence (fire-and-forget insert
    // into ddos_rate_windows / ddos_threshold_events on PGlite).
    const counter = new RateWindowCounter({ windowSeconds: 60, threshold: 5 });
    const base = Date.now() - 120_000; // two minutes ago: windows fully closed
    const key = clientKeyFor("198.51.100.23");
    for (let i = 0; i < 7; i++) counter.record(key, new Date(base + i * 1000)); // breach in window W0
    counter.record(clientKeyFor("192.0.2.9"), new Date(base + 61_000)); // closes W0
    counter.flush(); // closes W1
    const db = (await getDb())!;
    await waitFor(async () => {
      const rows = await db.select().from(ddosRateWindows);
      return rows.length >= 2;
    });

    const admin = callerFor(adminUser);
    const status = await admin.securityAudit.getDDoSStatus({});
    expect(status.status).toBe("threshold_breaches_observed");
    expect(status.windowsObserved).toBeGreaterThanOrEqual(2);
    expect(status.currentRequestsPerSecond).not.toBeNull();
    const talker = status.topTalkers.find(t => t.clientKey === key);
    expect(talker).toBeDefined();
    expect(talker!.requestCount).toBeGreaterThanOrEqual(7);
    expect(status.events.length).toBe(1);
    expect(status.events[0]!.clientKey).toBe(key);
    // Breach is recorded at the moment it is first observed: the 6th
    // request (first one beyond the threshold of 5).
    expect(status.events[0]!.requestCount).toBe(6);
    expect(status.events[0]!.threshold).toBe(5);
  });

  it("quiet instrumentation reports honest no_anomalies with the observed window count", async () => {
    const db = (await getDb())!;
    await db.delete(ddosThresholdEvents);
    const status = await getDdosStatus(db);
    expect(status.status).toBe("no_anomalies");
    expect(status.windowsObserved).toBeGreaterThanOrEqual(2);
    expect(status.events.length).toBe(0);
  });
});
