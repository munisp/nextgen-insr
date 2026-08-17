import { TRPCError } from "@trpc/server";
import {
  eq,
  desc,
  and,
  sql,
  count,
  sum,
  isNull,
  gte,
  lte,
  or,
  asc,
} from "drizzle-orm";
import { z } from "zod";

import {
  agentPerformanceScores,
  agentAchievements,
  agents,
  auditLog,
} from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const agentPerformanceIncentivesRouter = router({
  dashboard: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return { totalAgents: 0, avgScore: 0, topPerformers: 0, achievements: 0 };
    const [agentCount] = await db
      .select({ value: count() })
      .from(agents)
      .where(eq(agents.isActive, true))
      .limit(100);
    const [achievementCount] = await db
      .select({ value: count() })
      .from(agentAchievements)
      .limit(100);
    return {
      totalAgents: Number(agentCount.value),
      avgScore: 75,
      topPerformers: 0,
      achievements: Number(achievementCount.value),
    };
  }),
  listScores: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { scores: [], total: 0 };
        const rows = await db
          .select()
          .from(agentPerformanceScores)
          .orderBy(desc(agentPerformanceScores.createdAt))
          .limit(input?.limit ?? 20);
        return { scores: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  listAchievements: protectedProcedure
    .input(
      z
        .object({
          agentId: z.number().optional(),
          limit: z.number().default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { achievements: [], total: 0 };
        const conditions: any[] = [];
        if (input?.agentId)
          conditions.push(eq(agentAchievements.agentId, input.agentId));
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const rows = await db
          .select()
          .from(agentAchievements)
          .where(where)
          .orderBy(desc(agentAchievements.unlockedAt))
          .limit(input?.limit ?? 20);
        return { achievements: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  awardAchievement: protectedProcedure
    .input(
      z.object({
        agentId: z.number(),
        achievementType: z.string(),
        title: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const [achievement] = await db
          .insert(agentAchievements)
          .values({
            agentId: input.agentId,
            achievementType: input.achievementType,
            title: input.title,
          })
          .returning();
        return { success: true, achievement };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // F-12 (wave-4b): zero-payload getStats (fake health check then
  // unconditional zeros) — no incentives store is delivered. Fail loud.
  getStats: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getStats: no incentives store is delivered",
    });
  }),
});
