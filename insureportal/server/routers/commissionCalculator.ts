import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  publicProcedure as openProcedure,
  protectedProcedure,
  router,
} from "../_core/trpc";
import { getDb } from "../db";
import { commissionRules } from "@schema";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";

export const commissionCalculatorRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
      const results = await database
        .select()
        .from(commissionRules)
        .orderBy(desc(commissionRules.id))
        .limit(input.limit)
        .offset(input.offset);

      const [totalResult] = await database
        .select({ total: count() })
        .from(commissionRules);

      return {
        data: results,
        total: totalResult?.total ?? 0,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
      const [record] = await database
        .select()
        .from(commissionRules)
        .where(eq(commissionRules.id, input.id))
        .limit(1);

      if (!record) {
        throw new Error(`Record with id ${input.id} not found`);
      }
      return record;
    }),

  getSummary: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
    const [totalResult] = await database
      .select({ total: count() })
      .from(commissionRules);

    return {
      totalRecords: totalResult?.total ?? 0,
      lastUpdated: new Date().toISOString(),
    };
  }),

  getRecent: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(7),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
      const since = new Date();
      since.setDate(since.getDate() - input.days);

      const results = await database
        .select()
        .from(commissionRules)
        .orderBy(desc(commissionRules.id))
        .limit(input.limit);

      return results;
    }),

  // ── Sprint 78 domain-specific procedures ──────────────────────────────────
  getTiers: openProcedure.query(async () => {
    const tiers = [
      {
        name: "Bronze",
        minVolume: 0,
        maxVolume: 500000,
        rate: 0.005,
        minTx: 0,
        bonusRate: 0,
      },
      {
        name: "Silver",
        minVolume: 500001,
        maxVolume: 2000000,
        rate: 0.007,
        minTx: 50,
        bonusRate: 0.001,
      },
      {
        name: "Gold",
        minVolume: 2000001,
        maxVolume: 10000000,
        rate: 0.01,
        minTx: 200,
        bonusRate: 0.002,
      },
      {
        name: "Platinum",
        minVolume: 10000001,
        maxVolume: 50000000,
        rate: 0.012,
        minTx: 500,
        bonusRate: 0.003,
      },
      {
        name: "Diamond",
        minVolume: 50000001,
        maxVolume: Infinity,
        rate: 0.015,
        minTx: 1000,
        bonusRate: 0.005,
      },
    ];
    const multipliers = {
      premium_payment: 1.0,
      claim_payout: 1.2,
      transfer: 0.8,
      bill_pay: 0.6,
      airtime: 0.5,
    };
    return { tiers, multipliers };
  }),

  calculate: openProcedure
    .input(
      z.object({
        agentId: z.string(),
        transactions: z.array(
          z.object({
            ref: z.string(),
            type: z.string(),
            amount: z.number(),
            status: z.string(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const tiers = [
        {
          name: "Bronze",
          minVolume: 0,
          maxVolume: 500000,
          rate: 0.005,
          minTx: 0,
          bonusRate: 0,
        },
        {
          name: "Silver",
          minVolume: 500001,
          maxVolume: 2000000,
          rate: 0.007,
          minTx: 50,
          bonusRate: 0.001,
        },
        {
          name: "Gold",
          minVolume: 2000001,
          maxVolume: 10000000,
          rate: 0.01,
          minTx: 200,
          bonusRate: 0.002,
        },
        {
          name: "Platinum",
          minVolume: 10000001,
          maxVolume: 50000000,
          rate: 0.012,
          minTx: 500,
          bonusRate: 0.003,
        },
        {
          name: "Diamond",
          minVolume: 50000001,
          maxVolume: Infinity,
          rate: 0.015,
          minTx: 1000,
          bonusRate: 0.005,
        },
      ];
      const multipliers: Record<string, number> = {
        premium_payment: 1.0,
        claim_payout: 1.2,
        transfer: 0.8,
        bill_pay: 0.6,
        airtime: 0.5,
      };
      const completed = input.transactions.filter(
        t => t.status === "completed"
      );
      const reversed = input.transactions.filter(t => t.status === "reversed");
      const totalVolume = completed.reduce((s, t) => s + t.amount, 0);
      const txCount = completed.length;
      const tier =
        tiers.find(
          t => totalVolume >= t.minVolume && totalVolume <= t.maxVolume
        ) || tiers[0];
      let baseCommission = 0;
      for (const tx of completed) {
        const mult = multipliers[tx.type] ?? 1.0;
        baseCommission += tx.amount * tier.rate * mult;
      }
      const bonusCommission =
        txCount >= tier.minTx && tier.bonusRate > 0
          ? totalVolume * tier.bonusRate
          : 0;
      const clawbackAmount = reversed.reduce(
        (s, t) => s + t.amount * tier.rate,
        0
      );
      const totalCommission = baseCommission + bonusCommission;
      const netCommission = totalCommission - clawbackAmount;
      return {
        agentId: input.agentId,
        tier: tier.name,
        totalVolume,
        txCount,
        baseCommission,
        bonusCommission,
        clawbackAmount,
        totalCommission,
        netCommission,
      };
    }),

  simulate: openProcedure
    .input(
      z.object({ volume: z.number(), txCount: z.number(), txType: z.string() })
    )
    .query(async ({ input }) => {
      const tiers = [
        {
          name: "Bronze",
          minVolume: 0,
          maxVolume: 500000,
          rate: 0.005,
          minTx: 0,
          bonusRate: 0,
        },
        {
          name: "Silver",
          minVolume: 500001,
          maxVolume: 2000000,
          rate: 0.007,
          minTx: 50,
          bonusRate: 0.001,
        },
        {
          name: "Gold",
          minVolume: 2000001,
          maxVolume: 10000000,
          rate: 0.01,
          minTx: 200,
          bonusRate: 0.002,
        },
        {
          name: "Platinum",
          minVolume: 10000001,
          maxVolume: 50000000,
          rate: 0.012,
          minTx: 500,
          bonusRate: 0.003,
        },
        {
          name: "Diamond",
          minVolume: 50000001,
          maxVolume: Infinity,
          rate: 0.015,
          minTx: 1000,
          bonusRate: 0.005,
        },
      ];
      const multipliers: Record<string, number> = {
        premium_payment: 1.0,
        claim_payout: 1.2,
        transfer: 0.8,
        bill_pay: 0.6,
        airtime: 0.5,
      };
      const mult = multipliers[input.txType] ?? 1.0;
      const tier =
        tiers.find(
          t => input.volume >= t.minVolume && input.volume <= t.maxVolume
        ) || tiers[0];
      const baseCommission = input.volume * tier.rate * mult;
      const bonusCommission =
        input.txCount >= tier.minTx && tier.bonusRate > 0
          ? input.volume * tier.bonusRate
          : 0;
      const totalCommission = baseCommission + bonusCommission;
      const tierIdx = tiers.indexOf(tier);
      const nextTier = tierIdx < tiers.length - 1 ? tiers[tierIdx + 1] : null;
      return {
        tier: tier.name,
        totalCommission,
        baseCommission,
        bonusCommission,
        nextTier: nextTier?.name ?? null,
        volumeToNextTier: nextTier ? nextTier.minVolume - input.volume : 0,
      };
    }),
});
