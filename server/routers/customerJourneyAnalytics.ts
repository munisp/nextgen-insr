// @ts-check

/**
 * F12: Customer Journey Analytics
 * Journey steps, funnel analysis, touchpoint tracking, conversion metrics
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { customerJourneySteps } from "../../drizzle/schema";
import { eq, desc, and, gte, count, sql } from "drizzle-orm";

export const customerJourneyAnalyticsRouter = router({
  listSteps: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(50),
        customerId: z.number().optional(),
        journeyType: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { items: [], total: 0 };
        const conditions = [];
        if (input.customerId)
          conditions.push(
            eq(customerJourneySteps.customerId, input.customerId)
          );
        if (input.journeyType)
          conditions.push(eq(customerJourneySteps.stepType, input.journeyType));
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const items = await db
          .select()
          .from(customerJourneySteps)
          .where(where)
          .orderBy(desc(customerJourneySteps.createdAt))
          .limit(input.limit)
          .offset((input.page - 1) * input.limit);
        const [{ total }] = await db
          .select({ total: count() })
          .from(customerJourneySteps)
          .where(where)
          .limit(100);
        return { items, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  recordStep: protectedProcedure
    .input(
      z.object({
        customerId: z.number(),
        journeyType: z.string(),
        stepName: z.string(),
        stepOrder: z.number(),
        channel: z.string(),
        metadata: z.any().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        const [step] = await db
          .insert(customerJourneySteps)
          .values({
            customerId: input.customerId,
            journeyType: input.journeyType,
            stepName: input.stepName,
            stepOrder: input.stepOrder,
            channel: input.channel,
            metadata: input.metadata ? JSON.stringify(input.metadata) : null,
          } as any)
          .returning();
        return { step };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  funnelAnalysis: protectedProcedure
    .input(
      z.object({
        journeyType: z.string(),
        period: z.enum(["7d", "30d", "90d"]).default("30d"),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { funnel: [] };
        const periodDays = { "7d": 7, "30d": 30, "90d": 90 };
        const since = new Date(
          Date.now() - periodDays[input.period] * 86400000
        );
        const data = await db
          .select({
            stepName: customerJourneySteps.stepType,
            stepOrder: customerJourneySteps.stepType,
            count: count(),
          })
          .from(customerJourneySteps)
          .where(
            and(
              eq(customerJourneySteps.stepType, input.journeyType),
              gte(customerJourneySteps.createdAt, since)
            )
          )
          .groupBy(customerJourneySteps.stepType, customerJourneySteps.stepType)
          .orderBy(customerJourneySteps.stepType);
        return { funnel: data };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  touchpointSummary: protectedProcedure
    .input(z.object({ period: z.enum(["7d", "30d", "90d"]).default("30d") }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { touchpoints: [] };
        const periodDays = { "7d": 7, "30d": 30, "90d": 90 };
        const since = new Date(
          Date.now() - periodDays[input.period] * 86400000
        );
        const data = await db
          .select({
            channel: (customerJourneySteps as any).channel,
            count: count(),
          })
          .from(customerJourneySteps)
          .where(gte(customerJourneySteps.createdAt, since))
          .groupBy((customerJourneySteps as any).channel);
        return { touchpoints: data };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  journeyTypes: protectedProcedure.query(() => [
    "onboarding",
    "first_transaction",
    "kyc_verification",
    "loan_application",
    "dispute_resolution",
    "churn_prevention",
  ]),
});
