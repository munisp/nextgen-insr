import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
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
import {
  trainingCourses,
  trainingEnrollments,
  auditLog,
} from "@schema";
import { TRPCError } from "@trpc/server";

export const agentTrainingAcademyRouter = router({
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return {
        totalCourses: 0,
        totalEnrollments: 0,
        completionRate: 0,
        avgScore: 0,
      };
    const [courseCount] = await db
      .select({ value: count() })
      .from(trainingCourses)
      .limit(100);
    const [enrollCount] = await db
      .select({ value: count() })
      .from(trainingEnrollments)
      .limit(100);
    const completedEnroll = await db
      .select({ value: count() })
      .from(trainingEnrollments)
      .where(eq(trainingEnrollments.status, "completed"))
      .limit(100);
    const total = Number(enrollCount.value);
    const completed = Number(completedEnroll[0]?.value ?? 0);
    return {
      totalCourses: Number(courseCount.value),
      totalEnrollments: total,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      avgScore: 78,
    };
  }),
  listCourses: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { courses: [], total: 0 };
        const rows = await db
          .select()
          .from(trainingCourses)
          .orderBy(desc(trainingCourses.createdAt))
          .limit(input?.limit ?? 20);
        return { courses: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  enrollAgent: protectedProcedure
    .input(z.object({ agentId: z.number(), courseId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const [enrollment] = await db
          .insert(trainingEnrollments)
          .values({
            agentId: input.agentId,
            courseId: input.courseId,
            status: "enrolled",
            progress: 0,
          })
          .returning();
        return { success: true, enrollment };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  updateProgress: protectedProcedure
    .input(
      z.object({
        enrollmentId: z.number(),
        progress: z.number().min(0).max(100),
        score: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const updates: any = { progress: input.progress };
        if (input.progress >= 100) updates.status = "completed";
        if (input.score !== undefined) updates.score = input.score;
        const [updated] = await db
          .update(trainingEnrollments)
          .set(updates)
          .where(eq(trainingEnrollments.id, input.enrollmentId))
          .returning();
        return { success: true, enrollment: updated };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
});
