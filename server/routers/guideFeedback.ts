import { eq, count, avg, desc, sql } from "drizzle-orm";
import { z } from "zod";

import { guideFeedback } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

export const guideFeedbackRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().default(20),
          offset: z.number().default(0),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { data: [], total: 0 };
      const lim = input?.limit ?? 20;
      const off = input?.offset ?? 0;
      const data = await db
        .select()
        .from(guideFeedback)
        .orderBy(desc(guideFeedback.createdAt))
        .limit(lim)
        .offset(off);
      const [tot] = await db.select({ value: count() }).from(guideFeedback);
      return { data, total: Number(tot.value) };
    }),

  stats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { total: 0, active: 0, pending: 0, avgRating: 0 };
    const [tot] = await db.select({ value: count() }).from(guideFeedback);
    const [avgR] = await db
      .select({ value: avg(guideFeedback.rating) })
      .from(guideFeedback);
    return {
      total: Number(tot.value),
      active: Number(tot.value),
      pending: 0,
      avgRating: avgR.value ? Number(Number(avgR.value).toFixed(1)) : 0,
    };
  }),

  submit: protectedProcedure
    .input(
      z
        .object({
          guideId: z.string().optional(),
          rating: z.number().optional(),
          comment: z.string().optional(),
        })
        .optional()
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db || !input) return { success: true };
      await db.insert(guideFeedback).values({
        guideId: input.guideId ?? "general",
        rating: input.rating ?? 5,
        comment: input.comment,
      });
      return { success: true };
    }),

  summary: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return { total: 0, breakdown: [], lastUpdated: new Date().toISOString() };
    const [tot] = await db.select({ value: count() }).from(guideFeedback);
    const breakdown = await db
      .select({
        guideId: guideFeedback.guideId,
        cnt: count(),
        avgRating: avg(guideFeedback.rating),
      })
      .from(guideFeedback)
      .groupBy(guideFeedback.guideId);
    return {
      total: Number(tot.value),
      breakdown: breakdown.map((r: any) => ({
        guideId: r.guideId,
        count: Number(r.cnt),
        avgRating: r.avgRating ? Number(Number(r.avgRating).toFixed(1)) : 0,
      })),
      lastUpdated: new Date().toISOString(),
    };
  }),

  subsectionStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { sections: [], avgRating: 0, totalResponses: 0 };
    const sections = await db
      .select({
        subsection: guideFeedback.subsection,
        cnt: count(),
        avgRating: avg(guideFeedback.rating),
      })
      .from(guideFeedback)
      .groupBy(guideFeedback.subsection);
    const [totals] = await db
      .select({
        total: count(),
        avg: avg(guideFeedback.rating),
      })
      .from(guideFeedback);
    return {
      sections: sections.map((s: any) => ({
        name: s.subsection ?? "general",
        count: Number(s.cnt),
        avgRating: s.avgRating ? Number(Number(s.avgRating).toFixed(1)) : 0,
      })),
      avgRating: totals.avg ? Number(Number(totals.avg).toFixed(1)) : 0,
      totalResponses: Number(totals.total),
    };
  }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { deleted: true, id: input.id };
      await db
        .delete(guideFeedback)
        .where(eq(guideFeedback.id, Number(input.id)));
      return { deleted: true, id: input.id };
    }),
});
