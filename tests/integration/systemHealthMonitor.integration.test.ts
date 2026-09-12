/**
 * systemHealthMonitor.integration.test.ts — B8/B9/B10 integration coverage
 * for the observability telemetry surfaces against the REAL PG (PGlite)
 * schema.
 *
 * Rows are seeded directly into the real tables (request_metrics /
 * error_events / users) — no mocks. All synthetic paths/fingerprints carry a
 * "w2b." / "w2bfp" prefix that no other suite file uses (grep-verified), so
 * per-path percentiles and per-fingerprint counts are exact known answers.
 * Book-level totals (totalSamples, overall percentiles) are asserted as
 * baseline/lower-bound because the REAL middleware legitimately records rows
 * for every procedure call made by any suite file in this shared PGlite.
 *
 * Seeded truth:
 *   request_metrics path "w2b.test.latency": durations 10..100 step 10 (n=10,
 *     all success) → nearest-rank p50=50, p90=90, p99=100, max=100
 *   request_metrics path "w2b.test.latency2": durations [5, 15], one failure
 *     → p50=5, p90=15, p99=15, errorCount=1
 *   request_metrics path "w2b.test.latency.old": one row 48h old
 *     → excluded from a 24h window (fail loud), included in a 72h window
 *   error_events "w2bfp-slow-query" count 5, "w2bfp-null-ref" count 2
 *     → ordered by count desc
 *   users w2b-user-{1,2,3}: lastSignedIn now / 3d ago / 40d ago
 *     → active24h baseline+1, active7d baseline+2, active30d baseline+2
 */
import { desc, eq, sql } from "drizzle-orm";
import { describe, it, beforeAll, afterAll } from "vitest";

import { users } from "../../drizzle/schema";
import {
  errorEvents,
  requestMetrics,
} from "../../drizzle/schema.additions";
import { getDb } from "../../server/db";
import { flushTelemetryNow } from "../../server/lib/telemetryStore";
import {
  callerFor,
  adminUser,
  regularUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "systemHealthMonitor";

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 86_400_000;

let baseActive24h = 0;
let baseActive7d = 0;
let baseActive30d = 0;
let baseTotalUsers = 0;

async function seed() {
  const db = (await getDb())!;

  const [base] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      a24: sql<number>`SUM(CASE WHEN ${users.lastSignedIn} >= ${new Date(NOW - DAY)} THEN 1 ELSE 0 END)`,
      a7: sql<number>`SUM(CASE WHEN ${users.lastSignedIn} >= ${new Date(NOW - 7 * DAY)} THEN 1 ELSE 0 END)`,
      a30: sql<number>`SUM(CASE WHEN ${users.lastSignedIn} >= ${new Date(NOW - 30 * DAY)} THEN 1 ELSE 0 END)`,
    })
    .from(users);
  baseTotalUsers = Number(base.total);
  baseActive24h = Number(base.a24);
  baseActive7d = Number(base.a7);
  baseActive30d = Number(base.a30);

  // B8 known-answer latency samples.
  await db.insert(requestMetrics).values([
    ...[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(d => ({
      path: "w2b.test.latency",
      procedureType: "query",
      durationMs: d,
      success: true,
      userId: "w2b-seed",
      createdAt: new Date(NOW - 60_000),
    })),
    {
      path: "w2b.test.latency2",
      procedureType: "mutation",
      durationMs: 5,
      success: true,
      userId: "w2b-seed",
      createdAt: new Date(NOW - 60_000),
    },
    {
      path: "w2b.test.latency2",
      procedureType: "mutation",
      durationMs: 15,
      success: false,
      errorCode: "INTERNAL_SERVER_ERROR",
      userId: "w2b-seed",
      createdAt: new Date(NOW - 60_000),
    },
    {
      path: "w2b.test.latency.old",
      procedureType: "query",
      durationMs: 42,
      success: true,
      userId: "w2b-seed",
      createdAt: new Date(NOW - 48 * HOUR),
    },
  ]);

  // B9 known-answer grouped errors.
  await db.insert(errorEvents).values([
    {
      fingerprint: "w2bfp-slow-query",
      message: "w2b seeded slow query failure",
      stackHash: "w2bstackhash1",
      path: "w2b.test.errors",
      count: 5,
      firstSeen: new Date(NOW - 2 * HOUR),
      lastSeen: new Date(NOW - 30 * 60_000),
    },
    {
      fingerprint: "w2bfp-null-ref",
      message: "w2b seeded null reference",
      stackHash: null,
      path: "w2b.test.errors",
      count: 2,
      firstSeen: new Date(NOW - HOUR),
      lastSeen: new Date(NOW - 10 * 60_000),
    },
  ]);

  // B10 known-answer user recency.
  await db.insert(users).values([
    {
      keycloakSub: "w2b-user-1",
      email: "w2b-user-1@integration.local",
      name: "w2b-user-1",
      role: "user",
      lastSignedIn: new Date(NOW - 30 * 60_000), // within 24h
    },
    {
      keycloakSub: "w2b-user-2",
      email: "w2b-user-2@integration.local",
      name: "w2b-user-2",
      role: "user",
      lastSignedIn: new Date(NOW - 3 * DAY), // within 7d, not 24h
    },
    {
      keycloakSub: "w2b-user-3",
      email: "w2b-user-3@integration.local",
      name: "w2b-user-3",
      role: "user",
      lastSignedIn: new Date(NOW - 40 * DAY), // outside 30d
    },
  ]);
}

/** Poll until cond() holds — middleware telemetry writes are fire-and-forget. */
async function eventually(cond: () => Promise<boolean>, tries = 20): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await cond()) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

describe(`${FILE}: observability telemetry surfaces (B8/B9/B10)`, () => {
  beforeAll(async () => {
    resetAssertionCount();
    await seed();
  });

  afterAll(() => {
    console.log(`[${FILE}] assertions: ${getAssertionCount()}`);
  });

  // ── B8: apiLatency ──────────────────────────────────────────────────────
  it("apiLatency computes exact nearest-rank percentiles from real seeded rows", async () => {
    const admin = callerFor(adminUser);
    const res = await admin.healthMonitor.apiLatency({ hours: 24 });
    const r1 = res.routes.find(r => r.path === "w2b.test.latency");
    expect(r1).toBeDefined();
    expect(r1!.sampleCount).toBe(10);
    expect(r1!.errorCount).toBe(0);
    expect(r1!.p50Ms).toBe(50);
    expect(r1!.p90Ms).toBe(90);
    expect(r1!.p99Ms).toBe(100);
    expect(r1!.maxMs).toBe(100);

    const r2 = res.routes.find(r => r.path === "w2b.test.latency2");
    expect(r2).toBeDefined();
    expect(r2!.sampleCount).toBe(2);
    expect(r2!.errorCount).toBe(1);
    expect(r2!.p50Ms).toBe(5);
    expect(r2!.p90Ms).toBe(15);
    expect(r2!.p99Ms).toBe(15);

    // Seeded rows alone guarantee this lower bound; the live middleware may
    // have added more real rows for other paths.
    expect(res.totalSamples).toBeGreaterThanOrEqual(12);
    expect(res.overall.p50Ms).toBeGreaterThan(0);
    // The 48h-old row is outside the 24h window.
    expect(res.routes.find(r => r.path === "w2b.test.latency.old")).toBeUndefined();
  });

  it("apiLatency path filter scopes percentiles; old rows appear in a wider window", async () => {
    const admin = callerFor(adminUser);
    const scoped = await admin.healthMonitor.apiLatency({
      hours: 24,
      path: "w2b.test.latency",
    });
    expect(scoped.routes.length).toBe(1);
    expect(scoped.totalSamples).toBe(10);
    expect(scoped.routes[0].p99Ms).toBe(100);

    const wide = await admin.healthMonitor.apiLatency({
      hours: 72,
      path: "w2b.test.latency.old",
    });
    expect(wide.totalSamples).toBe(1);
    expect(wide.routes[0].p50Ms).toBe(42);
  });

  it("apiLatency fails loud NO_METRICS_YET for an empty scope (honest cold start)", async () => {
    const admin = callerFor(adminUser);
    const err = await expectTrpcError(
      admin.healthMonitor.apiLatency({ hours: 24, path: "w2b.nonexistent" }),
      "PRECONDITION_FAILED"
    );
    expect(err.message).toContain("NO_METRICS_YET");
  });

  // ── B9: errorTracking ───────────────────────────────────────────────────
  it("errorTracking returns real grouped aggregates ordered by count desc", async () => {
    const admin = callerFor(adminUser);
    const res = await admin.healthMonitor.errorTracking({
      limit: 50,
      path: "w2b.test.errors",
    });
    expect(res.distinctFingerprints).toBe(2);
    expect(res.totalOccurrences).toBe(7);
    expect(res.errors.map(e => e.fingerprint)).toEqual([
      "w2bfp-slow-query",
      "w2bfp-null-ref",
    ]);
    expect(res.errors[0].count).toBe(5);
    expect(res.errors[0].stackHash).toBe("w2bstackhash1");
    expect(res.errors[1].count).toBe(2);
    expect(res.errors[1].stackHash).toBeNull();
  });

  it("errorTracking fails loud NO_ERROR_EVENTS_YET for an empty scope", async () => {
    const admin = callerFor(adminUser);
    const err = await expectTrpcError(
      admin.healthMonitor.errorTracking({ limit: 10, path: "w2b.nonexistent" }),
      "PRECONDITION_FAILED"
    );
    expect(err.message).toContain("NO_ERROR_EVENTS_YET");
  });

  // ── Middleware capture: real procedure calls land real telemetry rows ───
  it("middleware records request_metrics + error_events for a real failing procedure call", async () => {
    const admin = callerFor(adminUser);
    // healthMonitor.getById(-1) throws a real Error inside the procedure.
    await expect(admin.healthMonitor.getById({ id: -1 })).rejects.toThrow(
      "not found"
    );
    await expect(admin.healthMonitor.getById({ id: -1 })).rejects.toThrow(
      "not found"
    );
    await flushTelemetryNow();

    const db = (await getDb())!;
    const metricLanded = await eventually(async () => {
      const rows = await db
        .select()
        .from(requestMetrics)
        .where(eq(requestMetrics.path, "healthMonitor.getById"));
      return rows.length >= 2 && rows.every(r => r.success === false);
    });
    expect(metricLanded).toBe(true);

    const errorLanded = await eventually(async () => {
      const rows = await db
        .select()
        .from(errorEvents)
        .where(eq(errorEvents.path, "healthMonitor.getById"));
      // Same fingerprint both times → ONE row upserted to count 2.
      return rows.length === 1 && rows[0].count === 2;
    });
    expect(errorLanded).toBe(true);
    const [evt] = await db
      .select()
      .from(errorEvents)
      .where(eq(errorEvents.path, "healthMonitor.getById"));
    expect(evt.message).toContain("Record with id -1 not found");
    expect(evt.stackHash).toBeTruthy();
    expect(evt.lastSeen >= evt.firstSeen).toBe(true);
  });

  it("middleware records successful request metrics too", async () => {
    const admin = callerFor(adminUser);
    await admin.healthMonitor.getSummary();
    await flushTelemetryNow();
    const db = (await getDb())!;
    const landed = await eventually(async () => {
      const rows = await db
        .select()
        .from(requestMetrics)
        .where(eq(requestMetrics.path, "healthMonitor.getSummary"));
      return rows.some(r => r.success === true && r.durationMs >= 0);
    });
    expect(landed).toBe(true);
  });

  // ── B10: userActivity ───────────────────────────────────────────────────
  it("userActivity aggregates real users.lastSignedIn recency buckets (baseline+N)", async () => {
    const admin = callerFor(adminUser);
    const res = await admin.healthMonitor.userActivity();
    expect(res.source).toContain("users.lastSignedIn");
    expect(res.totalUsers).toBe(baseTotalUsers + 3);
    expect(res.active24h).toBe(baseActive24h + 1);
    expect(res.active7d).toBe(baseActive7d + 2);
    expect(res.active30d).toBe(baseActive30d + 2);
    expect(Array.isArray(res.dailyLastSignIns)).toBe(true);
    expect(res.dailyLastSignIns.length).toBeGreaterThanOrEqual(1);
    // Exact invariant: the per-day buckets partition every user whose last
    // sign-in is within 7 days, so their sum equals active7d exactly.
    const daySum = res.dailyLastSignIns.reduce((a, d) => a + d.users, 0);
    expect(daySum).toBe(res.active7d);
  });

  // ── Authz gates (through the real middleware chain) ─────────────────────
  it("telemetry surfaces are protected: regular user can read, anonymous UNAUTHORIZED", async () => {
    const regular = callerFor(regularUser);
    const res = await regular.healthMonitor.apiLatency({
      hours: 24,
      path: "w2b.test.latency",
    });
    expect(res.totalSamples).toBe(10);

    const anon = callerFor(null);
    await expectTrpcError(
      anon.healthMonitor.apiLatency({ hours: 24 }),
      "UNAUTHORIZED"
    );
    await expectTrpcError(anon.healthMonitor.errorTracking({}), "UNAUTHORIZED");
    await expectTrpcError(anon.healthMonitor.userActivity(), "UNAUTHORIZED");
  });

  it("errorTracking and apiLatency results stay consistent with direct table reads", async () => {
    const admin = callerFor(adminUser);
    const db = (await getDb())!;
    const [direct] = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(requestMetrics)
      .where(eq(requestMetrics.path, "w2b.test.latency"));
    const viaApi = await admin.healthMonitor.apiLatency({
      hours: 24,
      path: "w2b.test.latency",
    });
    expect(viaApi.totalSamples).toBe(Number(direct.n));

    const directErr = await db
      .select()
      .from(errorEvents)
      .where(eq(errorEvents.path, "w2b.test.errors"))
      .orderBy(desc(errorEvents.count));
    const viaApiErr = await admin.healthMonitor.errorTracking({
      limit: 10,
      path: "w2b.test.errors",
    });
    expect(viaApiErr.errors.length).toBe(directErr.length);
  });
});
