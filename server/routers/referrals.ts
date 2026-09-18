/**
 * Referral Program Router
 * Agents earn bonus points + cash when they refer new agents who activate.
 */
import crypto from "crypto";

import { TRPCError } from "@trpc/server";
import { eq, desc, and, count, sql } from "drizzle-orm";
import { z } from "zod";

import { referrals, agents, loyaltyHistory, transactions } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { getAgentFromCookie } from "../middleware/agentAuth";



// Default referral rewards
const REFERRAL_BONUS_POINTS = 500;
const REFERRAL_BONUS_CASH = 1000; // ₦1,000

/**
 * G2 audit 2026-02 (#11): resolve the caller's agent identity from the
 * agent-session cookie — never from client-supplied IDs. Admins (Keycloak
 * role) may act on any agent. Returns null when the caller is neither.
 */
async function resolveCallerAgent(ctx: { req: any; user?: { role?: string | null } | null }) {
  const session = await getAgentFromCookie(ctx.req);
  if (session) return { agentPk: session.id, agentCode: session.agentId, isAdmin: false };
  if (ctx.user?.role === "admin") return { agentPk: null, agentCode: null, isAdmin: true };
  return null;
}

export const referralsRouter = router({
  // ── Generate a referral code for an agent ────────────────────────────────
  generateCode: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        // IDOR fix: the caller may only mint a code for THEIR OWN agent
        // account (session-derived), unless they are an admin.
        const caller = await resolveCallerAgent(ctx);
        if (!caller || (!caller.isAdmin && caller.agentCode !== input.agentId)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Cannot generate a referral code for another agent" });
        }

        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.agentId, input.agentId))
          .limit(1);
        if (!agent)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Agent not found",
          });

        // Generate a unique 8-char referral code
        const referralCode = `REF${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

        // Check if an active referral already exists
        const existing = await db
          .select()
          .from(referrals)
          .where(
            and(
              eq(referrals.referrerAgentId, agent.id),
              eq(referrals.status, "pending")
            )
          )
          .limit(1);

        if (existing.length > 0) {
          return { referralCode: existing[0].referralCode, existing: true };
        }

        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
        const [referral] = await db
          .insert(referrals)
          .values({
            referrerAgentId: agent.id,
            referrerCode: input.agentId,
            referralCode,
            bonusPoints: REFERRAL_BONUS_POINTS,
            bonusCash: String(REFERRAL_BONUS_CASH),
            expiresAt,
          })
          .returning();

        return { referralCode: referral.referralCode, existing: false };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Use a referral code during agent registration ────────────────────────
  useCode: protectedProcedure
    .input(
      z.object({
        referralCode: z.string(),
        refereeAgentCode: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        // IDOR fix: only the referee THEMSELVES (session-derived) may attach
        // their agent account to a referral code, unless admin.
        const caller = await resolveCallerAgent(ctx);
        if (!caller || (!caller.isAdmin && caller.agentCode !== input.refereeAgentCode)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Cannot apply a referral code to another agent" });
        }

        const [referral] = await db
          .select()
          .from(referrals)
          .where(eq(referrals.referralCode, input.referralCode))
          .limit(1);

        if (!referral)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Invalid referral code",
          });
        if (referral.status !== "pending") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Referral code already used or expired",
          });
        }
        if (referral.expiresAt && referral.expiresAt < new Date()) {
          await db
            .update(referrals)
            .set({ status: "expired" })
            .where(eq(referrals.referralCode, input.referralCode));
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Referral code has expired",
          });
        }

        const [referee] = await db
          .select()
          .from(agents)
          .where(eq(agents.agentId, input.refereeAgentCode))
          .limit(1);
        if (!referee)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Referee agent not found",
          });

        // Link the referee to the referral
        await db
          .update(referrals)
          .set({
            refereeAgentId: referee.id,
            refereeCode: input.refereeAgentCode,
            status: "activated",
            activatedAt: new Date(),
          })
          .where(eq(referrals.referralCode, input.referralCode));

        return { success: true, message: "Referral code applied successfully" };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Award referral bonus (called when referee completes first transaction) ─
  awardBonus: protectedProcedure
    .input(z.object({ refereeAgentCode: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        // G2 audit 2026-02 (#11): a referral bonus moves real money — it is
        // NOT caller-triggerable. The caller must be the referee agent
        // (session-derived) or an admin, AND a qualifying first successful
        // transaction by the referee must exist server-side.
        const caller = await resolveCallerAgent(ctx);
        if (!caller || (!caller.isAdmin && caller.agentCode !== input.refereeAgentCode)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Cannot trigger a referral bonus for another agent" });
        }

        // Server-side proof (checked BEFORE claiming): the referee must have
        // at least one SUCCESSFUL transaction — the "first transaction"
        // qualifying event. A success transaction is immutable history, so
        // this check needs no lock.
        const [refereeAgent] = await db
          .select()
          .from(agents)
          .where(eq(agents.agentId, input.refereeAgentCode))
          .limit(1);
        const [qualifying] = refereeAgent
          ? await db
              .select({ c: count() })
              .from(transactions)
              .where(and(eq(transactions.agentId, refereeAgent.id), eq(transactions.status, "success")))
          : [{ c: 0 }];
        if (!refereeAgent || Number(qualifying?.c ?? 0) === 0) {
          return { awarded: false, reason: "no_qualifying_transaction" };
        }

        return await db.transaction(async (tx) => {
          // Atomic single-statement claim: the status guard makes exactly one
          // concurrent caller flip activated → rewarded; everyone else gets
          // zero rows (no double-award), without FOR UPDATE.
          const claimed = await tx
            .update(referrals)
            .set({ status: "rewarded", rewardedAt: new Date() })
            .where(
              and(
                eq(referrals.refereeCode, input.refereeAgentCode),
                eq(referrals.status, "activated")
              )
            )
            .returning();
          const referral = claimed[0];
          if (!referral) return { awarded: false };

          // Award bonus points to referrer
          const [referrer] = await tx
            .select()
            .from(agents)
            .where(eq(agents.id, referral.referrerAgentId))
            .limit(1);
          if (!referrer) return { awarded: false };

          const newPoints = referrer.loyaltyPoints + referral.bonusPoints;
          await tx
            .update(agents)
            .set({
              loyaltyPoints: newPoints,
              commissionBalance: sql`${agents.commissionBalance} + ${referral.bonusCash}`,
              updatedAt: new Date(),
            })
            .where(eq(agents.id, referral.referrerAgentId));

          // Record loyalty history
          await tx.insert(loyaltyHistory).values({
            agentId: referral.referrerAgentId,
            type: "bonus",
            points: referral.bonusPoints,
            description: `Referral bonus for activating agent ${input.refereeAgentCode}`,
            balanceAfter: newPoints,
          });

          // (Referral was already marked rewarded by the atomic claim above.)
          return {
            awarded: true,
            bonusPoints: referral.bonusPoints,
            bonusCash: referral.bonusCash,
          };
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

  // ── Get referral stats for an agent ──────────────────────────────────────
  agentStats: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          return {
            total: 0,
            pending: 0,
            activated: 0,
            rewarded: 0,
            totalEarned: "0",
          };

        // IDOR fix: agents may only read their OWN referral stats.
        const caller = await resolveCallerAgent(ctx);
        if (!caller || (!caller.isAdmin && caller.agentCode !== input.agentId)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Cannot view another agent's referral stats" });
        }

        const rows = await db
          .select()
          .from(referrals)
          .where(eq(referrals.referrerCode, input.agentId));

        const total = rows.length;
        const pending = rows.filter((r: any) => r.status === "pending").length;
        const activated = rows.filter(
          (r: any) => r.status === "activated"
        ).length;
        const rewarded = rows.filter(
          (r: any) => r.status === "rewarded"
        ).length;
        const totalEarned = rows
          .filter((r: any) => r.status === "rewarded")
          .reduce(
            (sum: any, r: any) => sum + parseFloat(r.bonusCash as string),
            0
          )
          .toFixed(2);

        return { total, pending, activated, rewarded, totalEarned };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── List all referrals (admin) ────────────────────────────────────────────
  listAll: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        status: z
          .enum(["pending", "activated", "rewarded", "expired"])
          .optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { items: [], total: 0 };
        const offset = (input.page - 1) * input.limit;
        const where = input.status
          ? eq(referrals.status, input.status)
          : undefined;
        const [items, [{ c: total }]] = await Promise.all([
          db
            .select()
            .from(referrals)
            .where(where)
            .orderBy(desc(referrals.createdAt))
            .limit(input.limit)
            .offset(offset),
          db.select({ c: count() }).from(referrals).where(where),
        ]);
        return { items, total: Number(total) };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── list (with search support for UI) ──────────────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        status: z
          .enum(["pending", "activated", "rewarded", "expired"])
          .optional(),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { items: [], total: 0 };
        const offset = (input.page - 1) * input.limit;
        const where = input.status
          ? eq(referrals.status, input.status)
          : undefined;
        const [allItems, [{ c: total }]] = await Promise.all([
          db
            .select()
            .from(referrals)
            .where(where)
            .orderBy(desc(referrals.createdAt))
            .limit(input.limit)
            .offset(offset),
          db.select({ c: count() }).from(referrals).where(where),
        ]);
        const items = input.search
          ? allItems.filter(
              (r: any) =>
                r.referrerCode.includes(input.search!) ||
                (r.refereeCode ?? "").includes(input.search!) ||
                r.referralCode.includes(input.search!)
            )
          : allItems;
        return { items, total: Number(total) };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── stats ────────────────────────────────────────────────────────────────────
  stats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    if (!db)
      return {
        total: 0,
        activated: 0,
        rewarded: 0,
        expired: 0,
        totalRewardAmount: 0,
      };
    const rows = await db.select().from(referrals).limit(100);
    const activated = rows.filter((r: any) => r.status === "activated").length;
    const rewarded = rows.filter((r: any) => r.status === "rewarded").length;
    const expired = rows.filter((r: any) => r.status === "expired").length;
    const totalRewardAmount = rows
      .filter((r: any) => r.status === "rewarded")
      .reduce((sum: any, r: any) => sum + parseFloat(r.bonusCash as string), 0);
    return {
      total: rows.length,
      activated,
      rewarded,
      expired,
      totalRewardAmount,
    };
  }),

  // ── markRewarded ──────────────────────────────────────────────────────────────
  markRewarded: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const [updated] = await db
          .update(referrals)
          .set({ status: "rewarded", rewardedAt: new Date() })
          .where(eq(referrals.id, input.id))
          .returning();
        return updated;
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
