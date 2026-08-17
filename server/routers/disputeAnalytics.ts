// @ts-check
import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count, sum, avg, gte } from "drizzle-orm";
import { z } from "zod";

import {
  disputes,
  transactions,
  refunds,
  auditLog,
} from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const disputeAnalyticsRouter = router({
  getSummary: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [total] = await db
      .select({ value: count() })
      .from(disputes)
      .limit(100);
    const [open] = await db
      .select({ value: count() })
      .from(disputes)
      .where(eq(disputes.status, "open"))
      .limit(100);
    const [resolved] = await db
      .select({ value: count() })
      .from(disputes)
      .where(eq(disputes.status, "resolved"))
      .limit(100);
    const [totalAmount] = await db
      .select({ value: sum(disputes.amount) })
      .from(disputes)
      .limit(100);
    return {
      totalDisputes: Number(total.value),
      openDisputes: Number(open.value),
      resolvedDisputes: Number(resolved.value),
      totalDisputedAmount: Number(totalAmount.value ?? 0),
      resolutionRate:
        Number(total.value) > 0
          ? Math.round((Number(resolved.value) / Number(total.value)) * 100)
          : 0,
      avgResolutionHours: await (async () => {
        // F-12 (wave-4b): real average resolution time (was fixture 24).
        const [r] = await db
          .select({
            v: sql<number>`AVG(EXTRACT(EPOCH FROM (${disputes.resolvedAt} - ${disputes.createdAt})) / 3600)`,
          })
          .from(disputes)
          .where(sql`${disputes.resolvedAt} IS NOT NULL`);
        return Math.round(Number(r?.v ?? 0));
      })(),
      // F-12 (wave-4b, audit FAIL-2): refundRate/slaCompliance were fixtures
      // (0.15/0.95) — now real aggregates; honest 0 when the denominator is
      // empty (a zero rate, not a cosmetic 100).
      refundRate: await (async () => {
        const [r] = await db.select({ value: count() }).from(refunds);
        return Number(total.value) > 0
          ? Math.round((Number(r.value) / Number(total.value)) * 1000) / 1000
          : 0;
      })(),
      slaCompliance: await (async () => {
        const [w] = await db
          .select({ value: count() })
          .from(disputes)
          .where(
            sql`${disputes.resolvedAt} IS NOT NULL AND ${disputes.resolvedAt} <= ${disputes.slaDeadlineAt}`
          );
        return Number(resolved.value) > 0
          ? Math.round((Number(w.value) / Number(resolved.value)) * 100) / 100
          : 0;
      })(),
    };
  }),
  getTrendData: protectedProcedure
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select({
            date: sql<string>`DATE(${disputes.createdAt})`,
            cnt: count(),
          })
          .from(disputes)
          .where(
            gte(
              disputes.createdAt,
              sql`NOW() - INTERVAL '${sql.raw(String(input?.days ?? 30))} days'`
            )
          )
          .groupBy(sql`DATE(${disputes.createdAt})`)
          .orderBy(sql`DATE(${disputes.createdAt})`)
          .limit(100);
        const daily = rows.map(r => ({ date: r.date, count: Number(r.cnt) }));
        return {
          trend: daily,
          daily,
          weeklyAvg:
            daily.length > 0
              ? daily.reduce((s, d) => s + d.count, 0) /
                Math.max(1, Math.ceil(daily.length / 7))
              : 0,
          // F-12 (wave-4b): real direction (last week vs prior week) and a
          // real resolved-per-day series (was fixture "stable", no series).
          trendDirection: ((): "up" | "down" | "stable" => {
            const last7 = daily.slice(-7).reduce((x, d) => x + d.count, 0);
            const prev7 = daily.slice(-14, -7).reduce((x, d) => x + d.count, 0);
            if (last7 > prev7 * 1.1) return "up";
            if (last7 < prev7 * 0.9) return "down";
            return "stable";
          })(),
          resolvedDaily: await (async () => {
            const rrows = await db
              .select({
                date: sql<string>`DATE(${disputes.resolvedAt})`,
                cnt: count(),
              })
              .from(disputes)
              .where(sql`${disputes.resolvedAt} IS NOT NULL`)
              .groupBy(sql`DATE(${disputes.resolvedAt})`)
              .orderBy(sql`DATE(${disputes.resolvedAt})`)
              .limit(100);
            return rrows.map(r => ({ date: r.date, count: Number(r.cnt) }));
          })(),
          period: `${input?.days ?? 30} days`,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getTopCategories: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const rows = await db
      .select({ reason: disputes.reason, cnt: count() })
      .from(disputes)
      .groupBy(disputes.reason)
      .orderBy(desc(count()))
      .limit(10);
    const cats = rows.map(r => ({
      reason: r.reason,
      count: Number(r.cnt),
      impact: Number(r.cnt) * 100,
    }));
    return {
      categories: cats,
      totalDisputes: cats.reduce((s, c) => s + c.count, 0),
      totalImpact: cats.reduce((s, c) => s + c.impact, 0),
    };
  }),
  getRefundRates: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [totalRefunds] = await db
      .select({ value: count() })
      .from(refunds)
      .limit(100);
    const [totalAmount] = await db
      .select({ value: sum(refunds.originalAmount) })
      .from(refunds)
      .limit(100);
    // F-12 (wave-4b): fixture rate/month/category rows replaced with real
    // aggregates from refunds + disputes.
    const [totalDisputesRow] = await db
      .select({ value: count() })
      .from(disputes);
    const disputeTotal = Number(totalDisputesRow.value);
    const refundTotal = Number(totalRefunds.value);
    const refundMonths = await db
      .select({
        month: sql<string>`date_trunc('month', ${refunds.createdAt})::text`,
        cnt: count(),
      })
      .from(refunds)
      .groupBy(sql`date_trunc('month', ${refunds.createdAt})`)
      .orderBy(sql`date_trunc('month', ${refunds.createdAt})`);
    const disputeMonths = await db
      .select({
        month: sql<string>`date_trunc('month', ${disputes.createdAt})::text`,
        cnt: count(),
      })
      .from(disputes)
      .groupBy(sql`date_trunc('month', ${disputes.createdAt})`);
    const dm = new Map(disputeMonths.map(r => [r.month, Number(r.cnt)]));
    const catRows = await db
      .select({ category: refunds.category, cnt: count() })
      .from(refunds)
      .groupBy(refunds.category);
    return {
      totalRefunds: refundTotal,
      totalRefundAmount: Number(totalAmount.value ?? 0),
      overallRefundRate:
        disputeTotal > 0
          ? Math.round((refundTotal / disputeTotal) * 1000) / 1000
          : 0,
      byMonth: refundMonths.map(r => ({
        month: r.month.slice(0, 7),
        rate:
          (dm.get(r.month) ?? 0) > 0
            ? Math.round((Number(r.cnt) / (dm.get(r.month) ?? 1)) * 1000) / 1000
            : 0,
      })),
      byCategory: catRows.map(r => ({
        category: r.category ?? "other",
        rate:
          disputeTotal > 0
            ? Math.round((Number(r.cnt) / disputeTotal) * 1000) / 1000
            : 0,
      })),
    };
  }),
  getResolutionMetrics: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [total] = await db
      .select({ value: count() })
      .from(disputes)
      .limit(100);
    const [resolved] = await db
      .select({ value: count() })
      .from(disputes)
      .where(eq(disputes.status, "resolved"))
      .limit(100);
    // F-12 (wave-4b): fixture averages/category rows replaced with real
    // aggregates (avg resolution time, SLA rate, per-type breakdown).
    const [avgRow] = await db
      .select({
        v: sql<number>`AVG(EXTRACT(EPOCH FROM (${disputes.resolvedAt} - ${disputes.createdAt})) / 3600)`,
      })
      .from(disputes)
      .where(sql`${disputes.resolvedAt} IS NOT NULL`);
    const avgHours = Math.round(Number(avgRow?.v ?? 0));
    const [withinSla] = await db
      .select({ value: count() })
      .from(disputes)
      .where(
        sql`${disputes.resolvedAt} IS NOT NULL AND ${disputes.resolvedAt} <= ${disputes.slaDeadlineAt}`
      );
    const catRows = await db
      .select({
        category: disputes.type,
        cnt: count(),
        avgH: sql<number>`AVG(EXTRACT(EPOCH FROM (${disputes.resolvedAt} - ${disputes.createdAt})) / 3600)`,
      })
      .from(disputes)
      .groupBy(disputes.type);
    return {
      totalDisputes: Number(total.value),
      resolved: Number(resolved.value),
      avgResolutionDays: Math.round((avgHours / 24) * 10) / 10,
      avgResolutionHours: avgHours,
      slaCompliance:
        Number(resolved.value) > 0
          ? Math.round((Number(withinSla.value) / Number(resolved.value)) * 100)
          : 0, // F-12 (audit FAIL-2): was cosmetic 100
      byCategory: catRows.map(r => ({
        category: r.category,
        count: Number(r.cnt),
        avgHours: Math.round(Number(r.avgH ?? 0)),
      })),
    };
  }),
  getSlaCompliance: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [total] = await db
      .select({ value: count() })
      .from(disputes)
      .limit(100);
    const [withinSla] = await db
      .select({ value: count() })
      .from(disputes)
      .where(eq(disputes.status, "resolved"))
      .limit(100);
    return {
      totalDisputes: Number(total.value),
      withinSla: Number(withinSla.value),
      complianceRate:
        Number(total.value) > 0
          ? Math.round((Number(withinSla.value) / Number(total.value)) * 100)
          : 0, // F-12 (audit FAIL-2): was cosmetic 100
      // F-12 (wave-4b): was fixture 0.92 — now the real computed rate.
      overallCompliance:
        Number(total.value) > 0
          ? Number(withinSla.value) / Number(total.value)
          : 0, // F-12 (audit FAIL-2): was cosmetic 1
      // F-12 (verifier site 1): byPriority/trend were hardcoded literals —
      // now real aggregates (per-priority and per-day within-SLA rates).
      byPriority: await (async () => {
        const rows = await db
          .select({
            priority: disputes.priority,
            tot: count(),
            ok: sql<number>`SUM(CASE WHEN ${disputes.resolvedAt} IS NOT NULL AND ${disputes.resolvedAt} <= ${disputes.slaDeadlineAt} THEN 1 ELSE 0 END)`,
          })
          .from(disputes)
          .groupBy(disputes.priority);
        return rows.map(r => ({
          priority: r.priority,
          compliance:
            Number(r.tot) > 0
              ? Math.round((Number(r.ok) / Number(r.tot)) * 1000) / 1000
              : 0,
        }));
      })(),
      trend: await (async () => {
        const rows = await db
          .select({
            date: sql<string>`DATE(${disputes.createdAt})`,
            tot: count(),
            ok: sql<number>`SUM(CASE WHEN ${disputes.resolvedAt} IS NOT NULL AND ${disputes.resolvedAt} <= ${disputes.slaDeadlineAt} THEN 1 ELSE 0 END)`,
          })
          .from(disputes)
          .groupBy(sql`DATE(${disputes.createdAt})`)
          .orderBy(sql`DATE(${disputes.createdAt})`)
          .limit(90);
        return rows.map(r => ({
          date: r.date,
          compliance:
            Number(r.tot) > 0
              ? Math.round((Number(r.ok) / Number(r.tot)) * 1000) / 1000
              : 0,
        }));
      })(),
    };
  }),
});
