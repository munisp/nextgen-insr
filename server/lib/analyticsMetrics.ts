// @ts-check
// TypeScript enabled — Sprint 96 security audit
/**
 * analyticsMetrics.ts
 * Rolling 1-minute bucket analytics for MQTT throughput and ERP sync rates.
 * Each call to recordMetric() upserts a bucket for the current minute.
 */
import { getDb } from "../db";
import { analyticsMetrics } from "../../drizzle/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { logger } from './_core/logger';

// ── In-memory SSE listener registry ──────────────────────────────────────────
type SseListener = (data: string) => void;
const sseListeners = new Set<SseListener>();

export function addAnalyticsSseListener(fn: SseListener) {
  sseListeners.add(fn);
}
export function removeAnalyticsSseListener(fn: SseListener) {
  sseListeners.delete(fn);
}
function broadcastMetric(
  metricName: string,
  value: number,
  tags: Record<string, string> = {}
) {
  const payload = JSON.stringify({ metricName, value, tags, ts: Date.now() });
  sseListeners.forEach(fn => {
    try {
      fn(payload);
    } catch {
      /* ignore dead client */
    }
  });
}

// ── Bucket helper ─────────────────────────────────────────────────────────────
function truncateToMinute(d: Date): Date {
  const t = new Date(d);
  t.setSeconds(0, 0);
  return t;
}

// ── recordMetric ──────────────────────────────────────────────────────────────
/**
 * Upsert a rolling 1-minute bucket for metricName.
 * For counters (increment=true) the value is added to the existing bucket.
 * For gauges (increment=false) the value replaces the bucket.
 */
export async function recordMetric(
  metricName: string,
  value: number,
  tags: Record<string, string> = {},
  increment = true
): Promise<void> {
  const db = (await getDb())!;
  if (!db) return;

  const bucket = truncateToMinute(new Date());

  try {
    if (increment) {
      // Try to find existing bucket and add to it
      const existing = await db
        .select({ id: analyticsMetrics.id, value: analyticsMetrics.value })
        .from(analyticsMetrics)
        .where(
          and(
            eq(analyticsMetrics.metricName, metricName),
            eq(analyticsMetrics.bucketMinute, bucket)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        const newVal = parseFloat(existing[0].value as string) + value;
        await db
          .update(analyticsMetrics)
          .set({ value: String(newVal) })
          .where(eq(analyticsMetrics.id, existing[0].id));
        broadcastMetric(metricName, newVal, tags);
      } else {
        await db.insert(analyticsMetrics).values({
          metricName,
          value: String(value),
          bucketMinute: bucket,
          tags,
        });
        broadcastMetric(metricName, value, tags);
      }
    } else {
      // Gauge — upsert
      const existing = await db
        .select({ id: analyticsMetrics.id })
        .from(analyticsMetrics)
        .where(
          and(
            eq(analyticsMetrics.metricName, metricName),
            eq(analyticsMetrics.bucketMinute, bucket)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(analyticsMetrics)
          .set({ value: String(value), tags })
          .where(eq(analyticsMetrics.id, existing[0].id));
      } else {
        await db.insert(analyticsMetrics).values({
          metricName,
          value: String(value),
          bucketMinute: bucket,
          tags,
        });
      }
      broadcastMetric(metricName, value, tags);
    }
  } catch (err) {
    // Non-fatal — analytics should never break the main flow
    logger.warn("[analytics] recordMetric error:", err);
  }
}

// ── getTimeSeries ─────────────────────────────────────────────────────────────
export async function getTimeSeries(
  metricName: string,
  fromMs: number,
  toMs: number
): Promise<Array<{ bucket: Date; value: number }>> {
  const db = (await getDb())!;
  if (!db) return [];

  const rows = await db
    .select({
      bucket: analyticsMetrics.bucketMinute,
      value: analyticsMetrics.value,
    })
    .from(analyticsMetrics)
    .where(
      and(
        eq(analyticsMetrics.metricName, metricName),
        gte(analyticsMetrics.bucketMinute, new Date(fromMs)),
        lte(analyticsMetrics.bucketMinute, new Date(toMs))
      )
    )
    .orderBy(analyticsMetrics.bucketMinute);

  return rows.map(r => ({
    bucket: r.bucket,
    value: parseFloat(r.value as string),
  }));
}

// ── getLiveStats ──────────────────────────────────────────────────────────────
export async function getLiveStats(): Promise<Record<string, number>> {
  const db = (await getDb())!;
  if (!db) return {};

  // Sum of each metric in the last 5 minutes
  const since = new Date(Date.now() - 5 * 60 * 1000);
  const rows = await db
    .select({
      metricName: analyticsMetrics.metricName,
      total: sql<string>`SUM(${analyticsMetrics.value}::numeric)`,
    })
    .from(analyticsMetrics)
    .where(gte(analyticsMetrics.bucketMinute, since))
    .groupBy(analyticsMetrics.metricName);

  const result: Record<string, number> = {};
  for (const r of rows) {
    result[r.metricName] = parseFloat(r.total ?? "0");
  }
  return result;
}
