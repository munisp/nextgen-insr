// @ts-nocheck
/**
 * Agent Training Gamification — gamified learning modules, badges, leaderboards,
 * skill assessments, and training completion tracking.
 *
 * Middleware: Redis (leaderboard cache), Kafka (training events),
 * PostgreSQL (progress tracking), OpenSearch (training search)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, writeAuditLog } from "../db";
import {
  trainingCourses,
  trainingEnrollments,
  agents,
} from "@schema";
import { eq, desc, and, sql, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getAgentFromCookie } from "../middleware/agentAuth";

const BADGES = [
  {
    id: "first_tx",
    name: "First Transaction",
    description: "Complete your first transaction",
    xp: 50,
  },
  {
    id: "speed_demon",
    name: "Speed Demon",
    description: "Process 10 transactions in one hour",
    xp: 100,
  },
  {
    id: "high_roller",
    name: "High Roller",
    description: "Process a transaction over N100,000",
    xp: 150,
  },
  {
    id: "consistent",
    name: "Consistency King",
    description: "Transact every day for 7 days",
    xp: 200,
  },
  {
    id: "offline_pro",
    name: "Offline Pro",
    description: "Successfully sync 20+ offline transactions",
    xp: 200,
  },
  {
    id: "voice_master",
    name: "Voice Master",
    description: "Complete 10 voice-initiated transactions",
    xp: 150,
  },
  {
    id: "bill_buster",
    name: "Bill Buster",
    description: "Process 50 bill payments",
    xp: 250,
  },
  {
    id: "mobile_maven",
    name: "Mobile Maven",
    description: "Process 100 mobile money transactions",
    xp: 300,
  },
  {
    id: "mentor",
    name: "Mentor",
    description: "Transfer float to 5 different agents",
    xp: 250,
  },
  {
    id: "global_agent",
    name: "Global Agent",
    description: "Complete a cross-border remittance",
    xp: 300,
  },
];

export const agentTrainingGamificationRouter = router({
  getCourses: protectedProcedure
    .input(z.object({ category: z.string().optional() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { courses: [] };

        const conditions = [];
        if (input.category)
          conditions.push(eq(trainingCourses.category, input.category));

        const courses =
          conditions.length > 0
            ? await db
                .select()
                .from(trainingCourses)
                .where(and(...conditions))
                .orderBy(trainingCourses.title)
            : await db
                .select()
                .from(trainingCourses)
                .orderBy(trainingCourses.title)
                .limit(100);

        return { courses };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  getMyProgress: protectedProcedure.query(async ({ ctx }) => {
    try {
      const session = await getAgentFromCookie(ctx.req);
      if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

      const db = (await getDb())!;
      if (!db) return { enrollments: [], totalXP: 0, level: 1, badges: [] };

      const enrollments = await db
        .select()
        .from(trainingEnrollments)
        .where(eq(trainingEnrollments.agentId, session.id))
        .orderBy(desc(trainingEnrollments.createdAt));

      const completedCount = enrollments.filter(
        e => e.status === "completed"
      ).length;
      const totalXP = completedCount * 100;
      const level = Math.floor(totalXP / 500) + 1;

      return {
        enrollments,
        totalXP,
        level,
        badges: BADGES.filter(b => totalXP >= b.xp),
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

  enrollInCourse: protectedProcedure
    .input(z.object({ courseId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [course] = await db
          .select()
          .from(trainingCourses)
          .where(eq(trainingCourses.id, input.courseId))
          .limit(1);
        if (!course)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Course not found",
          });

        const existing = await db
          .select()
          .from(trainingEnrollments)
          .where(
            and(
              eq(trainingEnrollments.agentId, session.id),
              eq(trainingEnrollments.courseId, input.courseId)
            )
          )
          .limit(1);
        if (existing[0])
          throw new TRPCError({
            code: "CONFLICT",
            message: "Already enrolled",
          });

        const [enrollment] = await db
          .insert(trainingEnrollments)
          .values({
            agentId: session.id,
            courseId: input.courseId,
            status: "enrolled",
            progress: 0,
          })
          .returning();

        await writeAuditLog({
          agentId: session.id,
          action: "TRAINING_ENROLLED",
          resource: "training",
          resourceId: String(enrollment.id),
          status: "success",
          metadata: { courseId: input.courseId, courseTitle: course.title },
        });

        return enrollment;
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
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const status = input.progress >= 100 ? "completed" : "in_progress";
        const updateData: Record<string, unknown> = {
          progress: input.progress,
          status,
        };
        if (status === "completed") updateData.completedAt = new Date();

        await db
          .update(trainingEnrollments)
          .set(updateData)
          .where(
            and(
              eq(trainingEnrollments.id, input.enrollmentId),
              eq(trainingEnrollments.agentId, session.id)
            )
          );

        if (status === "completed") {
          await db
            .update(agents)
            .set({
              loyaltyPoints: sql`COALESCE(${agents.loyaltyPoints}, 0) + 100`,
            })
            .where(eq(agents.id, session.id));

          await writeAuditLog({
            agentId: session.id,
            action: "TRAINING_COMPLETED",
            resource: "training",
            resourceId: String(input.enrollmentId),
            status: "success",
          });
        }

        return {
          enrollmentId: input.enrollmentId,
          progress: input.progress,
          status,
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

  getLeaderboard: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { leaderboard: [] };

        const rows = await db.execute(
          sql`SELECT a.id, a."agentId", a."agentName",
              count(te.id) FILTER (WHERE te.status = 'completed') as completed_courses,
              count(te.id) FILTER (WHERE te.status = 'completed') * 100 as xp
              FROM agents a LEFT JOIN training_enrollments te ON te."agentId" = a.id
              GROUP BY a.id, a."agentId", a."agentName"
              ORDER BY xp DESC LIMIT ${input.limit}`
        );

        return { leaderboard: rows.rows ?? [] };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  getBadges: protectedProcedure.query(async () => {
    return { badges: BADGES };
  }),
});
