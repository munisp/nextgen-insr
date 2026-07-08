// @ts-check

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { eq, desc, and, sql, count, sum } from "drizzle-orm";
import { loyaltyHistory, customers, auditLog } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

export const customerLoyaltyProgramRouter = router({
  getBalance: protectedProcedure
    .input(z.object({ customerId: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [earned] = await db
          .select({ total: sum(loyaltyHistory.points) })
          .from(loyaltyHistory)
          .where(
            and(
              eq(loyaltyHistory.agentId, input.customerId),
              eq(loyaltyHistory.type, "earned")
            )
          )
          .limit(100);
        const [redeemed] = await db
          .select({ total: sum(loyaltyHistory.points) })
          .from(loyaltyHistory)
          .where(
            and(
              eq(loyaltyHistory.agentId, input.customerId),
              eq(loyaltyHistory.type, "redeemed")
            )
          )
          .limit(100);
        return {
          customerId: input.customerId,
          earned: Number(earned.total ?? 0),
          redeemed: Number(redeemed.total ?? 0),
          balance: Number(earned.total ?? 0) - Number(redeemed.total ?? 0),
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
  getHistory: protectedProcedure
    .input(z.object({ customerId: z.number(), limit: z.number().default(50) }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(loyaltyHistory)
          .where(eq(loyaltyHistory.agentId, input.customerId))
          .orderBy(desc(loyaltyHistory.createdAt))
          .limit(input.limit);
        return { history: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  earnPoints: protectedProcedure
    .input(
      z.object({
        customerId: z.number(),
        points: z.number().positive(),
        reason: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [entry] = await db
          .insert(loyaltyHistory)
          .values({
            customerId: input.customerId,
            points: input.points,
            type: "earned",
            description: input.reason,
          } as any)
          .returning();
        await db.insert(auditLog).values({
          action: "loyalty_points_earned",
          resource: "loyalty_history",
          resourceId: String(entry.id),
          status: "success",
          metadata: { customerId: input.customerId, points: input.points },
        } as any);
        return entry;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  redeemPoints: protectedProcedure
    .input(
      z.object({
        customerId: z.number(),
        points: z.number().positive(),
        reward: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [earned] = await db
          .select({ total: sum(loyaltyHistory.points) })
          .from(loyaltyHistory)
          .where(
            and(
              eq(loyaltyHistory.agentId, input.customerId),
              eq(loyaltyHistory.type, "earned")
            )
          )
          .limit(100);
        const [redeemed] = await db
          .select({ total: sum(loyaltyHistory.points) })
          .from(loyaltyHistory)
          .where(
            and(
              eq(loyaltyHistory.agentId, input.customerId),
              eq(loyaltyHistory.type, "redeemed")
            )
          )
          .limit(100);
        const balance = Number(earned.total ?? 0) - Number(redeemed.total ?? 0);
        if (balance < input.points)
          throw new Error("Insufficient loyalty points");
        const [entry] = await db
          .insert(loyaltyHistory)
          .values({
            customerId: input.customerId,
            points: -input.points,
            type: "redeemed",
            description: input.reward,
          } as any)
          .returning();
        await db.insert(auditLog).values({
          action: "loyalty_points_redeemed",
          resource: "loyalty_history",
          resourceId: String(entry.id),
          status: "success",
          metadata: {
            customerId: input.customerId,
            points: input.points,
            reward: input.reward,
          },
        } as any);
        return entry;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getStats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [totalEarned] = await db
      .select({ total: sum(loyaltyHistory.points) })
      .from(loyaltyHistory)
      .where(eq(loyaltyHistory.type, "earned"))
      .limit(100);
    const [totalRedeemed] = await db
      .select({ total: sum(loyaltyHistory.points) })
      .from(loyaltyHistory)
      .where(eq(loyaltyHistory.type, "redeemed"))
      .limit(100);
    const [memberCount] = await db
      .select({ value: count() })
      .from(customers)
      .limit(100);
    return {
      totalPointsEarned: Number(totalEarned.total ?? 0),
      totalPointsRedeemed: Number(totalRedeemed.total ?? 0),
      totalMembers: Number(memberCount.value),
    };
  }),
});
