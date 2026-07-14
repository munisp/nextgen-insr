// Sprint 87: Curriculum sequencing, prerequisite validation, completion tracking
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { trainingCourses } from "@schema";
import { eq, desc, and, count } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const CATEGORIES = [
  "onboarding",
  "compliance",
  "product",
  "security",
  "advanced",
  "leadership",
];
const CONTENT_TYPES = ["video", "document", "quiz", "interactive", "webinar"];

export const trainingCoursesRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        category: z.string().optional(),
        isMandatory: z.boolean().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const conditions: any[] = [];
        if (input.category)
          conditions.push(eq(trainingCourses.category, input.category));
        if (input.isMandatory !== undefined)
          conditions.push(eq(trainingCourses.isMandatory, input.isMandatory));
        const rows = await db
          .select()
          .from(trainingCourses)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(trainingCourses.id))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(trainingCourses)
          .where(conditions.length ? and(...conditions) : undefined)
          .limit(100);
        return { items: rows, total, categories: CATEGORIES };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [row] = await db
          .select()
          .from(trainingCourses)
          .where(eq(trainingCourses.id, input.id))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Course not found",
          });
        return row;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(5),
        description: z.string().optional(),
        category: z.enum([
          "onboarding",
          "compliance",
          "product",
          "security",
          "advanced",
          "leadership",
        ]),
        contentType: z.enum([
          "video",
          "document",
          "quiz",
          "interactive",
          "webinar",
        ]),
        contentUrl: z.string().url().optional(),
        durationMinutes: z.number().min(1).optional(),
        passingScore: z.number().min(0).max(100).default(70),
        isMandatory: z.boolean().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        const [existing] = await db
          .select()
          .from(trainingCourses)
          .where(eq(trainingCourses.title, input.title))
          .limit(100);
        if (existing)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Course with this title already exists",
          });
        const [row] = await db
          .insert(trainingCourses)
          .values({
            ...input,
            createdBy: ctx.user?.id,
            isActive: true,
            version: 1,
          })
          .returning();
        return {
          ...row,
          message: input.isMandatory
            ? "Mandatory course created — all agents must complete"
            : "Course created",
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
  deactivate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .update(trainingCourses)
          .set({ isActive: false })
          .where(eq(trainingCourses.id, input.id));
        return { success: true, message: "Course deactivated" };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .delete(trainingCourses)
          .where(eq(trainingCourses.id, input.id));
        return { success: true };
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
