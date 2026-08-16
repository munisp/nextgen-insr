// Sprint 87: Event sequencing, funnel analysis, attribution
import { TRPCError } from "@trpc/server";
import { eq, desc, and, count, sql } from "drizzle-orm";
import { z } from "zod";

import { customerJourneySteps } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

const JOURNEY_STAGES = [
  "awareness",
  "consideration",
  "onboarding",
  "first_transaction",
  "active",
  "loyal",
  "churned",
];

export const customer_journey_eventsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        customerId: z.number().optional(),
        stage: z.string().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const conditions: any[] = [];
        if (input.customerId)
          conditions.push(
            eq(customerJourneySteps.customerId, input.customerId)
          );
        if (input.stage)
          conditions.push(eq(customerJourneySteps.status, input.stage));
        const rows = await db
          .select()
          .from(customerJourneySteps)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(customerJourneySteps.id))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(customerJourneySteps)
          .where(conditions.length ? and(...conditions) : undefined)
          .limit(100);
        return { items: rows, total };
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
          .from(customerJourneySteps)
          .where(eq(customerJourneySteps.id, input.id))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Journey event not found",
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
  trackEvent: protectedProcedure
    .input(
      z.object({
        customerId: z.number(),
        stage: z.enum([
          "awareness",
          "consideration",
          "onboarding",
          "first_transaction",
          "active",
          "loyal",
          "churned",
        ]),
        eventType: z.string(),
        metadata: z.record(z.string(), z.any()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [row] = await db
          .insert(customerJourneySteps)
          .values({ ...input, createdAt: new Date() } as any)
          .returning();
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
  getFunnelAnalysis: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const stageCounts = await db
      .select({ stage: customerJourneySteps.status, count: count() })
      .from(customerJourneySteps)
      .groupBy(customerJourneySteps.status)
      .limit(100);
    const funnel = JOURNEY_STAGES.map((stage, i) => {
      const found = stageCounts.find(
        (s: Record<string, unknown>) => s.stage === stage
      );
      const stageCount = found ? Number(found.count) : 0;
      const prevCount =
        i > 0
          ? stageCounts.find(
              (s: Record<string, unknown>) => s.stage === JOURNEY_STAGES[i - 1]
            )?.count || 0
          : stageCount;
      return {
        stage,
        count: stageCount,
        conversionRate:
          prevCount > 0
            ? Math.round((stageCount / Number(prevCount)) * 100)
            : 0,
      };
    });
    return { funnel, stages: JOURNEY_STAGES };
  }),
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .delete(customerJourneySteps)
          .where(eq(customerJourneySteps.id, input.id));
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
