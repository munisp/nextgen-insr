/**
 * ddosTelemetry.ts — B6: DDoS self-telemetry (REAL in-repo instrumentation).
 *
 * The platform has no edge/WAF telemetry feed, so this module instruments the
 * Node server itself: an express middleware counts requests per client key
 * per fixed window in-process. When a window closes, the finished buckets are
 * persisted to `ddos_rate_windows` (migration 0060). If a client crosses the
 * configured per-window threshold, a `ddos_threshold_events` row is appended
 * at the moment the breach is observed.
 *
 * Guarantees:
 *  - Capture NEVER blocks or fails a request: the middleware is synchronous
 *    in-memory accounting; all persistence is fire-and-forget with swallowed
 *    (logged) errors.
 *  - Nothing is fabricated: getDDoSStatus reports only rows that were really
 *    recorded. No recorded windows at all -> PRECONDITION_FAILED (capture not
 *    running). Windows recorded but no breaches -> {status:'no_anomalies'}.
 *  - Privacy: clientKey = sha256(clientIp)[:32]; raw IPs never hit the DB.
 *
 * Runtime constraint: counters are per-process. A multi-replica deployment
 * sees per-replica rates in the store; that is honest self-telemetry, not a
 * cluster-wide edge view.
 */
import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { desc, gte, sql } from "drizzle-orm";

import {
  ddosRateWindows,
  ddosThresholdEvents,
} from "../../drizzle/schema.additions";
import { getDb } from "../db";
import { logger } from "../_core/logger";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export interface DdosTelemetryConfig {
  /** Window length in seconds. Default 60. */
  windowSeconds: number;
  /** Requests per window per client that constitutes a breach. Default 600. */
  threshold: number;
}

const DEFAULT_CONFIG: DdosTelemetryConfig = { windowSeconds: 60, threshold: 600 };

/** Pure window math (unit-tested): start of the window containing `ts`. */
export function windowStartFor(ts: Date, windowSeconds: number): Date {
  const w = windowSeconds * 1000;
  return new Date(Math.floor(ts.getTime() / w) * w);
}

/** Stable, non-reversible client key. */
export function clientKeyFor(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

interface Bucket {
  windowStart: Date;
  count: number;
  breachRecorded: boolean;
}

/**
 * In-process per-client window counter. Exported for tests; production uses
 * the singleton middleware below.
 */
export class RateWindowCounter {
  private buckets = new Map<string, Bucket>();
  constructor(
    private readonly config: DdosTelemetryConfig = DEFAULT_CONFIG,
    private readonly persist: (
      rows: { windowStart: Date; windowSeconds: number; clientKey: string; requestCount: number }[],
      events: { windowStart: Date; windowSeconds: number; clientKey: string; requestCount: number; threshold: number }[]
    ) => void = defaultPersist
  ) {}

  /**
   * Record one request. Finished-window rows and breach events caused by
   * this request are handed to `persist` (fire-and-forget).
   */
  record(clientKey: string, now: Date = new Date()): void {
    const ws = windowStartFor(now, this.config.windowSeconds);
    // Flush any buckets whose windows have closed.
    const finishedRows: { windowStart: Date; windowSeconds: number; clientKey: string; requestCount: number }[] = [];
    for (const [key, bucket] of this.buckets) {
      if (bucket.windowStart.getTime() < ws.getTime()) {
        finishedRows.push({
          windowStart: bucket.windowStart,
          windowSeconds: this.config.windowSeconds,
          clientKey: key,
          requestCount: bucket.count,
        });
        this.buckets.delete(key);
      }
    }
    let bucket = this.buckets.get(clientKey);
    if (!bucket) {
      bucket = { windowStart: ws, count: 0, breachRecorded: false };
      this.buckets.set(clientKey, bucket);
    }
    bucket.count += 1;
    const events: { windowStart: Date; windowSeconds: number; clientKey: string; requestCount: number; threshold: number }[] = [];
    if (!bucket.breachRecorded && bucket.count > this.config.threshold) {
      bucket.breachRecorded = true;
      events.push({
        windowStart: bucket.windowStart,
        windowSeconds: this.config.windowSeconds,
        clientKey,
        requestCount: bucket.count,
        threshold: this.config.threshold,
      });
    }
    if (finishedRows.length > 0 || events.length > 0) {
      this.persist(finishedRows, events);
    }
  }

  /** Force-flush all open windows (graceful shutdown / tests). */
  flush(): void {
    const rows: { windowStart: Date; windowSeconds: number; clientKey: string; requestCount: number }[] = [];
    for (const [key, bucket] of this.buckets) {
      rows.push({
        windowStart: bucket.windowStart,
        windowSeconds: this.config.windowSeconds,
        clientKey: key,
        requestCount: bucket.count,
      });
    }
    this.buckets.clear();
    if (rows.length > 0) this.persist(rows, []);
  }

  get openBuckets(): number {
    return this.buckets.size;
  }
}

/** Fire-and-forget persistence; errors are logged, never thrown. */
function defaultPersist(
  rows: { windowStart: Date; windowSeconds: number; clientKey: string; requestCount: number }[],
  events: { windowStart: Date; windowSeconds: number; clientKey: string; requestCount: number; threshold: number }[]
): void {
  void (async () => {
    try {
      const db = await getDb();
      if (!db) return;
      if (rows.length > 0) await db.insert(ddosRateWindows).values(rows);
      if (events.length > 0) await db.insert(ddosThresholdEvents).values(events);
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "ddosTelemetry: persist failed (dropped window)"
      );
    }
  })();
}

const globalCounter = new RateWindowCounter();

/** Flush open windows on shutdown so the last partial window is not lost. */
export function flushDdosTelemetry(): void {
  globalCounter.flush();
}

/**
 * Express middleware: counts every request. Placed FIRST in the chain so
 * rate-limited (429) requests are counted too — they are exactly the traffic
 * this telemetry exists to see. Never throws.
 */
export function ddosTelemetryMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    globalCounter.record(clientKeyFor(ip));
  } catch {
    // capture must never fail a request
  }
  next();
}

type DdosThresholdEventRow = {
  id: number;
  clientKey: string;
  windowStart: Date;
  windowSeconds: number;
  requestCount: number;
  threshold: number;
  detectedAt: Date | null;
};

export interface DdosStatusResult {
  status: "no_anomalies" | "threshold_breaches_observed";
  windowSeconds: number;
  threshold: number;
  windowsObserved: number;
  /** Requests/second observed in the most recent fully-recorded window. */
  currentRequestsPerSecond: number | null;
  topTalkers: { clientKey: string; requestCount: number }[];
  events: DdosThresholdEventRow[];
}

/**
 * REAL status: aggregates only rows actually recorded by the middleware.
 * Fails loud (PRECONDITION_FAILED) when no window has ever been persisted —
 * i.e. capture is not running on this deployment.
 */
export async function getDdosStatus(
  db: Db,
  opts: { sinceHours?: number; topN?: number } = {}
): Promise<DdosStatusResult> {
  const sinceHours = opts.sinceHours ?? 24;
  const topN = opts.topN ?? 10;
  const since = new Date(Date.now() - sinceHours * 3_600_000);

  const [totals] = await db
    .select({
      windows: sql<number>`COUNT(DISTINCT ${ddosRateWindows.windowStart})`,
      requests: sql<number>`COALESCE(SUM(${ddosRateWindows.requestCount}), 0)`,
      maxWindowStart: sql<Date | null>`MAX(${ddosRateWindows.windowStart})`,
    })
    .from(ddosRateWindows);
  const windowsObserved = Number(totals?.windows ?? 0);
  if (windowsObserved === 0) {
    const err = new Error(
      "getDDoSStatus: no request-rate windows have been recorded — the ddosTelemetryMiddleware is not capturing on this deployment (it is registered first in server/_core/index.ts; windows persist only after a 60s window closes)"
    );
    (err as { code?: string }).code = "PRECONDITION_FAILED";
    throw err;
  }

  const topTalkers = await db
    .select({
      clientKey: ddosRateWindows.clientKey,
      requestCount: sql<number>`SUM(${ddosRateWindows.requestCount})`,
    })
    .from(ddosRateWindows)
    .where(gte(ddosRateWindows.windowStart, since))
    .groupBy(ddosRateWindows.clientKey)
    .orderBy(desc(sql`SUM(${ddosRateWindows.requestCount})`))
    .limit(topN);

  const maxStart = totals?.maxWindowStart ? new Date(totals.maxWindowStart) : null;
  let currentRps: number | null = null;
  let windowSeconds = DEFAULT_CONFIG.windowSeconds;
  if (maxStart) {
    const [lastWindow] = await db
      .select({
        requests: sql<number>`SUM(${ddosRateWindows.requestCount})`,
        secs: sql<number>`MAX(${ddosRateWindows.windowSeconds})`,
      })
      .from(ddosRateWindows)
      .where(sql`${ddosRateWindows.windowStart} = ${maxStart}`);
    const secs = Number(lastWindow?.secs ?? 0);
    if (secs > 0) {
      windowSeconds = secs;
      currentRps = Math.round((Number(lastWindow?.requests ?? 0) / secs) * 1000) / 1000;
    }
  }

  const events = await db
    .select()
    .from(ddosThresholdEvents)
    .where(gte(ddosThresholdEvents.detectedAt, since))
    .orderBy(desc(ddosThresholdEvents.detectedAt))
    .limit(100);

  return {
    status: events.length > 0 ? "threshold_breaches_observed" : "no_anomalies",
    windowSeconds,
    threshold: DEFAULT_CONFIG.threshold,
    windowsObserved,
    currentRequestsPerSecond: currentRps,
    topTalkers: topTalkers.map(t => ({
      clientKey: t.clientKey,
      requestCount: Number(t.requestCount),
    })),
    events,
  };
}
