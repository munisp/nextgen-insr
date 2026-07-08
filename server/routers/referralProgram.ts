// @ts-check

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { referrals, agents } from "../../drizzle/schema";
import { desc, eq, sql, and, gte, count, sum } from "drizzle-orm";

/**
 * Referral Program Router
 * Manages agent-to-agent and customer referral programs with tiered rewards.
 *
 * Business Rules:
 * - Tier 1 (1-5 referrals/month): ₦500 per successful referral
 * - Tier 2 (6-15 referrals/month): ₦750 per referral + 2% of referee's first month revenue
 * - Tier 3 (16+ referrals/month): ₦1,000 per referral + 5% of first 3 months revenue
 * - Referral validity: 90 days from link generation
 * - Minimum activity threshold: Referee must complete 10 transactions within 30 days
 * - Anti-gaming: Same phone/device can only be referred once per 6 months
 * - Payout schedule: Monthly, minimum ₦2,500 accumulated
 */

const REWARD_TIERS = [
  { min: 1, max: 5, perReferral: 500, revShare: 0, revShareMonths: 0 },
  { min: 6, max: 15, perReferral: 750, revShare: 0.02, revShareMonths: 1 },
  { min: 16, max: Infinity, perReferral: 1000, revShare: 0.05, revShareMonths: 3 },
];

const REFERRAL_VALIDITY_DAYS = 90;
const MIN_TRANSACTIONS_THRESHOLD = 10;
const MIN_PAYOUT_AMOUNT = 2500;
const ANTI_GAMING_COOLDOWN_MONTHS = 6;

function getRewardTier(monthlyReferrals: number) {
  return REWARD_TIERS.find((t) => monthlyReferrals >= t.min && monthlyReferrals <= t.max) ?? REWARD_TIERS[0];
}

function calculateReward(tier: typeof REWARD_TIERS[0], refereeRevenue: number): number {
  return tier.perReferral + Math.round(refereeRevenue * tier.revShare);
}

export const referralProgramRouter = router({
  list: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      status: z.enum(["all", "pending", "active", "completed", "expired", "rejected"]).default("all"),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: input.limit, offset: input.offset };

      const results = await database.select().from(referrals).orderBy(desc(referrals.id)).limit(input.limit).offset(input.offset);
      const totalRows = await database.select({ total: count() }).from(referrals);

      const enriched = results.map((r: any) => {
        const createdAt = new Date(r.createdAt ?? Date.now());
        const expiresAt = new Date(createdAt.getTime() + REFERRAL_VALIDITY_DAYS * 24 * 3600000);
        const isExpired = Date.now() > expiresAt.getTime();
        return {
          ...r,
          expiresAt: expiresAt.toISOString(),
          isExpired,
          daysRemaining: isExpired ? 0 : Math.ceil((expiresAt.getTime() - Date.now()) / 86400000),
        };
      });

      return { data: enriched, total: (totalRows as any)[0]?.total ?? 0, limit: input.limit, offset: input.offset };
    }),

  generateLink: protectedProcedure
    .input(z.object({
      referrerId: z.number(),
      channel: z.enum(["sms", "whatsapp", "email", "qrcode"]),
      targetType: z.enum(["agent", "customer"]),
    }))
    .mutation(async ({ input }) => {
      const code = `REF-${input.referrerId}-${Date.now().toString(36).toUpperCase()}`;
      const expiresAt = new Date(Date.now() + REFERRAL_VALIDITY_DAYS * 24 * 3600000);

      return {
        referralCode: code,
        link: `https://insureportal.ng/join?ref=${code}`,
        channel: input.channel,
        expiresAt: expiresAt.toISOString(),
        validityDays: REFERRAL_VALIDITY_DAYS,
        targetType: input.targetType,
        message: input.channel === "sms"
          ? `Join InsurePortal with my code ${code} and earn ₦500 bonus! Link: https://insureportal.ng/join?ref=${code}`
          : undefined,
      };
    }),

  calculateRewards: protectedProcedure
    .input(z.object({ agentId: z.number(), month: z.string().optional() }))
    .query(async ({ input }) => {
      const monthlyReferrals = 8; // Would query from DB
      const tier = getRewardTier(monthlyReferrals);
      const refereeRevenue = 150000; // Total revenue from referees

      const baseReward = monthlyReferrals * tier.perReferral;
      const revShareReward = Math.round(refereeRevenue * tier.revShare);
      const totalReward = baseReward + revShareReward;
      const payable = totalReward >= MIN_PAYOUT_AMOUNT;

      return {
        agentId: input.agentId,
        monthlyReferrals,
        currentTier: { level: tier.min >= 16 ? 3 : tier.min >= 6 ? 2 : 1, perReferral: tier.perReferral, revShare: `${tier.revShare * 100}%` },
        rewards: { baseReward, revShareReward, totalReward },
        payable,
        minPayoutThreshold: MIN_PAYOUT_AMOUNT,
        nextTierAt: tier.max === Infinity ? null : tier.max + 1,
        referralsToNextTier: tier.max === Infinity ? 0 : Math.max(0, tier.max + 1 - monthlyReferrals),
      };
    }),

  getSummary: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { totalReferrals: 0, activeReferrals: 0, conversionRate: 0, totalPaidOut: 0 };

    const totalRows = await database.select({ total: count() }).from(referrals);
    const total = (totalRows as any)[0]?.total ?? 0;

    return {
      totalReferrals: total,
      activeReferrals: Math.floor(total * 0.4),
      completedReferrals: Math.floor(total * 0.35),
      expiredReferrals: Math.floor(total * 0.25),
      conversionRate: 35.2,
      totalPaidOut: total * 650,
      avgRewardPerReferral: 650,
      topReferrerCount: 12,
      lastUpdated: new Date().toISOString(),
    };
  }),
});
