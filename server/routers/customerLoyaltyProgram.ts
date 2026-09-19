import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count, sum } from "drizzle-orm";
import { z } from "zod";

import { loyaltyHistory, customers, agents, auditLog } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb, writeAuditLog } from "../db";


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
  // I-wave 2026-02 (AB-12): points are redeemable at 1pt = ₦1 — granting
  // them is a FUNDS operation. This back-office grant is STAFF/ADMIN ONLY
  // (there is no legitimate user-facing arbitrary-grant path on this
  // endpoint), bounded, and audited.
  earnPoints: protectedProcedure
    .input(
      z.object({
        customerId: z.number(),
        points: z.number().int().positive().max(100_000),
        reason: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user?.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only staff can grant loyalty points",
          });
        }
        const db = (await getDb())!;
        // loyalty_history is keyed by agentId (the "customerId" input name is
        // legacy) — the previous insert referenced a non-existent customerId
        // column and could never have succeeded against a real database.
        // The grant credits the agent's loyalty balance AND writes the ledger
        // entry atomically (coupled award, same discipline as AB-11).
        return await db.transaction(async (tx) => {
          const [agent] = await tx
            .select({ loyaltyPoints: agents.loyaltyPoints })
            .from(agents)
            .where(eq(agents.id, input.customerId))
            .limit(1);
          if (!agent) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
          }
          const balanceAfter = (agent.loyaltyPoints ?? 0) + input.points;
          await tx
            .update(agents)
            .set({ loyaltyPoints: balanceAfter, updatedAt: new Date() })
            .where(eq(agents.id, input.customerId));
          const [entry] = await tx
            .insert(loyaltyHistory)
            .values({
              agentId: input.customerId,
              points: input.points,
              type: "earned",
              description: input.reason,
              balanceAfter,
            } as any)
            .returning();
          await writeAuditLog({
            action: "loyalty_points_earned",
            resource: "loyalty_history",
            resourceId: String(entry.id),
            status: "success",
            metadata: { agentId: input.customerId, points: input.points, staffUser: String(ctx.user.id) },
          });
          return entry;
        });
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
