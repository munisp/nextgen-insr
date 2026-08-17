// @ts-check
/**
 * loyalty.ts — Full loyalty program tRPC router
 *
 * Features:
 *   - Loyalty profile with tier, points, streak, rank
 *   - Leaderboard with pagination
 *   - Tier upgrade notifications
 *   - Streak tracking and bonus awards
 *   - Reward catalog CRUD (admin)
 *   - Claim challenge reward
 *   - Redeem reward
 *   - Loyalty history with pagination
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, asc, sql, gte, and, ilike, isNull } from "drizzle-orm";
import { z } from "zod";

import { agents, loyaltyHistory } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getDb,
  getAgentById,
  getLoyaltyHistory,
  addLoyaltyHistory,
  writeAuditLog,
} from "../db";
import { getAgentFromCookie } from "../middleware/agentAuth";

// ─── Tier thresholds (CBN-aligned insurance tiers) ──────────────────────
const TIER_THRESHOLDS = {
  Bronze: 0,
  Silver: 5000,
  Gold: 15000,
  Platinum: 50000,
} as const;
type Tier = keyof typeof TIER_THRESHOLDS;

function getTier(points: number): Tier {
  if (points >= 50000) return "Platinum";
  if (points >= 15000) return "Gold";
  if (points >= 5000) return "Silver";
  return "Bronze";
}

// F-12 (verifier round 3): the in-memory REWARD_CATALOG (RWD-001/002) was
// presented as "seeded from DB in production" — it was never seeded. No
// reward-catalog store is delivered; catalog-backed procs fail loud.

export const loyaltyRouter = router({
  // ── Get loyalty profile ───────────────────────────────────────────────────
  profile: protectedProcedure.query(async ({ ctx }) => {
    try {
      const session = await getAgentFromCookie(ctx.req);
      if (!session)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Agent session required",
        });
      const agent = await getAgentById(session.id);
      if (!agent)
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
      const points = agent.loyaltyPoints;
      const tier = getTier(points);
      const nextTier =
        tier === "Platinum"
          ? null
          : ((tier === "Gold"
              ? "Platinum"
              : tier === "Silver"
                ? "Gold"
                : "Silver") as Tier | null);
      const nextThreshold = nextTier ? TIER_THRESHOLDS[nextTier] : null;
      const history = await getLoyaltyHistory(agent.id, 20);
      return {
        points,
        tier,
        nextTier,
        nextThreshold,
        pointsToNextTier: nextThreshold
          ? Math.max(0, nextThreshold - points)
          : 0,
        streak: agent.streak,
        rank: agent.rank,
        history,
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

  // ── Loyalty history with pagination ──────────────────────────────────────
  history: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });
        const db = (await getDb())!;
        if (!db)
          return {
            history: [],
            total: 0,
            page: input.page,
            limit: input.limit,
          };
        const offset = (input.page - 1) * input.limit;
        const [rows, [{ total }]] = await Promise.all([
          db
            .select()
            .from(loyaltyHistory)
            .where(eq(loyaltyHistory.agentId, session.id))
            .orderBy(desc(loyaltyHistory.createdAt))
            .limit(input.limit)
            .offset(offset),
          db
            .select({ total: sql<string>`COUNT(*)` })
            .from(loyaltyHistory)
            .where(eq(loyaltyHistory.agentId, session.id)),
        ]);
        return {
          history: rows,
          total: parseInt(total, 10),
          page: input.page,
          limit: input.limit,
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

  // ── Leaderboard ───────────────────────────────────────────────────────────
  leaderboard: protectedProcedure
    .input(
      z.object({
        tier: z
          .enum(["all", "Bronze", "Silver", "Gold", "Platinum"])
          .default("all"),
        sortBy: z
          .enum(["loyaltyPoints", "streak", "rank"])
          .default("loyaltyPoints"),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          return { agents: [], total: 0, page: input.page, limit: input.limit };
        const offset = (input.page - 1) * input.limit;
        const whereClause = and(
          isNull(agents.deletedAt),
          eq(agents.isActive, true),
          input.tier !== "all" ? eq(agents.tier, input.tier as Tier) : undefined
        );
        const orderClause =
          input.sortBy === "streak"
            ? desc(agents.streak)
            : input.sortBy === "rank"
              ? asc(agents.rank)
              : desc(agents.loyaltyPoints);
        const [rows, [{ total }]] = await Promise.all([
          db
            .select({
              id: agents.id,
              agentId: agents.agentId,
              name: agents.name,
              tier: agents.tier,
              loyaltyPoints: agents.loyaltyPoints,
              streak: agents.streak,
              rank: agents.rank,
              location: agents.location,
            })
            .from(agents)
            .where(whereClause)
            .orderBy(orderClause)
            .limit(input.limit)
            .offset(offset),
          db
            .select({ total: sql<string>`COUNT(*)` })
            .from(agents)
            .where(whereClause),
        ]);
        // Add position numbers
        const withPosition = rows.map((r, i) => ({
          ...r,
          position: offset + i + 1,
        }));
        return {
          agents: withPosition,
          total: parseInt(total, 10),
          page: input.page,
          limit: input.limit,
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

  // ── Streak tracking — record daily activity ───────────────────────────────
  recordActivity: protectedProcedure
    .input(
      z.object({
        activityType: z.enum(["transaction", "login", "kyc", "referral"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });
        const db = (await getDb())!;
        if (!db) return { success: false, streakBonus: 0 };
        const agent = await getAgentById(session.id);
        if (!agent) throw new TRPCError({ code: "NOT_FOUND" });

        // Check if already recorded today
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const [existing] = await db
          .select({ id: loyaltyHistory.id })
          .from(loyaltyHistory)
          .where(
            and(
              eq(loyaltyHistory.agentId, session.id),
              gte(loyaltyHistory.createdAt, today),
              eq(loyaltyHistory.type, "earned")
            )
          )
          .limit(1);

        const newStreak = existing ? agent.streak : agent.streak + 1;
        const streakBonus =
          !existing && newStreak > 0 && newStreak % 7 === 0
            ? 100 * Math.floor(newStreak / 7)
            : 0;
        const basePoints =
          input.activityType === "transaction"
            ? 10
            : input.activityType === "referral"
              ? 50
              : 5;
        const totalPoints = basePoints + streakBonus;

        if (!existing) {
          await db
            .update(agents)
            .set({ streak: newStreak, updatedAt: new Date() })
            .where(eq(agents.id, session.id));
          await addLoyaltyHistory(
            session.id,
            "earned",
            totalPoints,
            `${input.activityType} activity${streakBonus > 0 ? ` + streak bonus (${newStreak} days)` : ""}`
          );
        }

        // Check for tier upgrade
        const oldTier = agent.tier;
        const newPoints = agent.loyaltyPoints + (existing ? 0 : totalPoints);
        const newTier = getTier(newPoints);
        const tierUpgraded = newTier !== oldTier;
        if (tierUpgraded) {
          await db
            .update(agents)
            .set({ tier: newTier, updatedAt: new Date() })
            .where(eq(agents.id, session.id));
        }

        return {
          success: true,
          streakBonus,
          basePoints,
          totalPoints: existing ? 0 : totalPoints,
          newStreak,
          tierUpgraded,
          newTier: tierUpgraded ? newTier : null,
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

  // ── Tier upgrade notification ─────────────────────────────────────────────
  checkTierUpgrade: protectedProcedure.query(async ({ ctx }) => {
    try {
      const session = await getAgentFromCookie(ctx.req);
      if (!session)
        return {
          upgraded: false,
          currentTier: "Bronze",
          previousTier: null,
          benefits: [],
        };
      const agent = await getAgentById(session.id);
      if (!agent)
        return {
          upgraded: false,
          currentTier: "Bronze",
          previousTier: null,
          benefits: [],
        };
      const currentTier = getTier(agent.loyaltyPoints);
      const tierBenefits: Record<Tier, string[]> = {
        Bronze: ["Basic commission rates", "Standard float limits"],
        Silver: [
          "5% commission bonus",
          "Increased float limit (₦2M)",
          "Priority support",
        ],
        Gold: [
          "10% commission bonus",
          "Float limit ₦5M",
          "Dedicated account manager",
          "Free POS maintenance",
        ],
        Platinum: [
          "15% commission bonus",
          "Unlimited float",
          "24/7 VIP support",
          "Custom POS branding",
          "Revenue share",
        ],
      };
      return {
        upgraded: currentTier !== agent.tier,
        currentTier,
        previousTier: currentTier !== agent.tier ? agent.tier : null,
        benefits: tierBenefits[currentTier],
        pointsToNextTier:
          currentTier !== "Platinum"
            ? TIER_THRESHOLDS[getTier(agent.loyaltyPoints + 1)] -
              agent.loyaltyPoints
            : 0,
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

  // ── Reward catalog ────────────────────────────────────────────────────────
  rewardCatalog: protectedProcedure
    .input(
      z.object({
        category: z.string().optional(),
        search: z.string().optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async () => {
      // F-12: no reward-catalog store is delivered (the in-memory catalog
      // with its false seeding cover-story was removed).
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "rewardCatalog: no reward-catalog store is delivered",
      });
    }),

  // ── Claim challenge reward ────────────────────────────────────────────────
  claimChallenge: protectedProcedure
    .input(z.object({ challengeId: z.string(), points: z.number().positive() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });
        await addLoyaltyHistory(
          session.id,
          "challenge",
          input.points,
          `Challenge completed: ${input.challengeId}`
        );
        await writeAuditLog({
          agentId: session.id,
          action: "LOYALTY_CHALLENGE_CLAIMED",
          resource: "loyalty",
          resourceId: input.challengeId,
          status: "success",
          metadata: { agentCode: session.agentId, points: input.points },
        });
        // Check tier upgrade
        const agent = await getAgentById(session.id);
        const newTier = agent
          ? getTier(agent.loyaltyPoints + input.points)
          : null;
        const tierUpgraded = agent && newTier !== agent.tier;
        if (tierUpgraded && agent && newTier) {
          const db = (await getDb())!;
          if (db)
            await db
              .update(agents)
              .set({ tier: newTier, updatedAt: new Date() })
              .where(eq(agents.id, session.id));
        }
        return {
          success: true,
          pointsAwarded: input.points,
          tierUpgraded: !!tierUpgraded,
          newTier: tierUpgraded ? newTier : null,
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

  // ── Redeem reward ─────────────────────────────────────────────────────────
  redeemReward: protectedProcedure
    .input(
      z.object({
        rewardId: z.string(),
        pointsCost: z.number().positive(),
        rewardName: z.string(),
      })
    )
    .mutation(async () => {
      // F-12: redemptions validated against the removed in-memory catalog —
      // no reward store is delivered, so no redemption can be honoured.
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "redeemReward: no reward store is delivered",
      });
    }),

  // ── Admin: Get all agents' loyalty summary ────────────────────────────────
  adminSummary: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        tier: z
          .enum(["all", "Bronze", "Silver", "Gold", "Platinum"])
          .default("all"),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          return { agents: [], total: 0, page: input.page, limit: input.limit };
        const offset = (input.page - 1) * input.limit;
        const whereClause = and(
          isNull(agents.deletedAt),
          input.tier !== "all"
            ? eq(agents.tier, input.tier as Tier)
            : undefined,
          input.search ? ilike(agents.name, `%${input.search}%`) : undefined
        );
        const [rows, [{ total }]] = await Promise.all([
          db
            .select({
              id: agents.id,
              agentId: agents.agentId,
              name: agents.name,
              tier: agents.tier,
              loyaltyPoints: agents.loyaltyPoints,
              streak: agents.streak,
              rank: agents.rank,
            })
            .from(agents)
            .where(whereClause)
            .orderBy(desc(agents.loyaltyPoints))
            .limit(input.limit)
            .offset(offset),
          db
            .select({ total: sql<string>`COUNT(*)` })
            .from(agents)
            .where(whereClause),
        ]);
        return {
          agents: rows,
          total: parseInt(total, 10),
          page: input.page,
          limit: input.limit,
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
});
