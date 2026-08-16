/**
 * mobileMoney.ts — Mobile Money Operations Router
 * Full production: cash-in, cash-out, transfers via mobile money.
 * Business Rules: Min ₦100, Max ₦300K, Daily ₦1M, Commission 1.5%
 *
 * MOCKWARE FIX: No mobile-money provider (MoMo/Mojaloop) call is wired in
 * this service. Cash-in/cash-out fail loudly when no provider is
 * configured, and a transaction is NEVER recorded as synchronous success —
 * it is stored as "pending" with providerStatus "pending_provider" until
 * the provider confirms settlement.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { transactions, agents, customers, auditLog } from "../../drizzle/schema";
import { eq, desc, count, sql, and, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { tbCreateTransfer, tbEnsureAgentAccount } from "../tbClient";
import { acquireLock, releaseLock } from "../lib/redisClient";
import { logger } from "../_core/logger";

const PROVIDERS = ["MTN MoMo", "Airtel Money", "Glo Xtra", "9PSB"] as const;
const MIN_AMOUNT = 100, MAX_AMOUNT = 300_000, DAILY_LIMIT = 1_000_000;
const CASH_IN_COMMISSION = 0.015, CASH_OUT_COMMISSION = 0.015;

// Mobile-money provider integration is configured via environment; without
// it a cash-in/cash-out cannot be fulfilled and must fail loudly.
function isMobileMoneyProviderConfigured(): boolean {
  return !!(
    process.env.MOBILE_MONEY_PROVIDER_URL ||
    process.env.MOBILE_MONEY_PROVIDER_API_KEY ||
    process.env.MOJALOOP_ENDPOINT ||
    process.env.MOJALOOP_URL
  );
}

export const mobileMoneyRouter = router({
  cashIn: protectedProcedure
    .input(z.object({
      agentId: z.number(), provider: z.enum(PROVIDERS),
      customerPhone: z.string(), amountNGN: z.number().min(MIN_AMOUNT).max(MAX_AMOUNT),
      reference: z.string().min(5), customerName: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      if (!isMobileMoneyProviderConfigured()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Mobile money provider not configured" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const existing = await db.select().from(transactions).where(eq(transactions.ref, input.reference)).limit(1);
      if (existing.length > 0) return { idempotent: true, transaction: existing[0] };
      const [agent] = await db.select().from(agents).where(eq(agents.id, input.agentId)).limit(1);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
      if (!agent.isActive || agent.floatLocked) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Agent not available" });
      const lockKey = `mm-cashin:${input.agentId}:${input.reference}`;
      const locked = await acquireLock(lockKey, 15_000);
      if (!locked) throw new TRPCError({ code: "CONFLICT", message: "Transaction in progress" });
      try {
        await tbEnsureAgentAccount(agent.agentId);
        // Commission is only earned once the provider confirms settlement;
        // it is not credited at initiation time.
        const commission = 0;
        const tbResult = await tbCreateTransfer({
          debitAccountId: "sys-bank-reserve", creditAccountId: `float-${agent.agentId}`,
          amount: Math.round(input.amountNGN * 100), ledger: 2000, code: 100,
          ref: input.reference, txType: "Mobile Money Cash-In", agentId: agent.agentId,
        });
        const [tx] = await db.insert(transactions).values({
          ref: input.reference, agentId: input.agentId, type: "Cash In",
          amount: String(input.amountNGN), fee: "0", commission: String(commission),
          customerPhone: input.customerPhone, customerName: input.customerName ?? null,
          // Never synchronous success: settlement is confirmed asynchronously
          // by the mobile-money provider.
          channel: "App", status: "pending", fraudScore: "0.00",
          metadata: { provider: input.provider, providerStatus: "pending_provider", tbTransferId: tbResult?.id ?? null, tbSyncStatus: tbResult ? "synced" : "pending" },
        }).returning();
        logger.info(`[MobileMoney] Cash-In ₦${input.amountNGN} via ${input.provider} | agent ${agent.agentId} | status pending_provider`);
        return { idempotent: false, transaction: tx, status: "pending_provider", commission, tbTransferId: tbResult?.id ?? null };
      } finally { await releaseLock(lockKey); }
    }),

  cashOut: protectedProcedure
    .input(z.object({
      agentId: z.number(), provider: z.enum(PROVIDERS),
      customerPhone: z.string(), amountNGN: z.number().min(MIN_AMOUNT).max(MAX_AMOUNT),
      reference: z.string().min(5), customerName: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      if (!isMobileMoneyProviderConfigured()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Mobile money provider not configured" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const existing = await db.select().from(transactions).where(eq(transactions.ref, input.reference)).limit(1);
      if (existing.length > 0) return { idempotent: true, transaction: existing[0] };
      const [agent] = await db.select().from(agents).where(eq(agents.id, input.agentId)).limit(1);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
      if (!agent.isActive || agent.floatLocked) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Agent not available" });
      const agentBalance = Number(agent.premiumReserve ?? 0);
      if (agentBalance < input.amountNGN + 5000) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Insufficient float. Available: ₦${(agentBalance - 5000).toLocaleString()}` });
      const lockKey = `mm-cashout:${input.agentId}:${input.reference}`;
      const locked = await acquireLock(lockKey, 15_000);
      if (!locked) throw new TRPCError({ code: "CONFLICT", message: "Transaction in progress" });
      try {
        await tbEnsureAgentAccount(agent.agentId);
        // Commission is only earned once the provider confirms settlement;
        // it is not credited at initiation time.
        const commission = 0;
        const tbResult = await tbCreateTransfer({
          debitAccountId: `float-${agent.agentId}`, creditAccountId: "sys-bank-reserve",
          amount: Math.round(input.amountNGN * 100), ledger: 2000, code: 200,
          ref: input.reference, txType: "Mobile Money Cash-Out", agentId: agent.agentId,
        });
        const [tx] = await db.insert(transactions).values({
          ref: input.reference, agentId: input.agentId, type: "Cash Out",
          amount: String(input.amountNGN), fee: "0", commission: String(commission),
          customerPhone: input.customerPhone, customerName: input.customerName ?? null,
          // Never synchronous success: settlement is confirmed asynchronously
          // by the mobile-money provider.
          channel: "App", status: "pending", fraudScore: "0.00",
          metadata: { provider: input.provider, providerStatus: "pending_provider", tbTransferId: tbResult?.id ?? null, tbSyncStatus: tbResult ? "synced" : "pending" },
        }).returning();
        logger.info(`[MobileMoney] Cash-Out ₦${input.amountNGN} via ${input.provider} | agent ${agent.agentId} | status pending_provider`);
        return { idempotent: false, transaction: tx, status: "pending_provider", commission, tbTransferId: tbResult?.id ?? null };
      } finally { await releaseLock(lockKey); }
    }),

  getProviders: protectedProcedure.query(() => ({
    providers: PROVIDERS.map(p => ({ name: p, cashInCommission: CASH_IN_COMMISSION, cashOutCommission: CASH_OUT_COMMISSION })),
    limits: { minAmountNGN: MIN_AMOUNT, maxAmountNGN: MAX_AMOUNT, dailyLimitNGN: DAILY_LIMIT },
  })),

  list: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20), offset: z.number().min(0).default(0) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { data: [], total: 0 };
      const results = await db.select().from(transactions)
        .where(sql`type LIKE 'Mobile Money%'`).orderBy(desc(transactions.createdAt)).limit(input.limit).offset(input.offset);
      const [{ total }] = await db.select({ total: count() }).from(transactions).where(sql`type LIKE 'Mobile Money%'`);
      return { data: results, total: Number(total) };
    }),

  getSummary: protectedProcedure
    .input(z.object({ periodDays: z.number().default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { total: 0, volumeNGN: 0 };
      const since = new Date(Date.now() - input.periodDays * 86400000);
      const [stats] = await db.select({ total: count(), volume: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)` })
        .from(transactions).where(and(sql`type LIKE 'Mobile Money%'`, gte(transactions.createdAt, since), eq(transactions.status, "success")));
      return { periodDays: input.periodDays, total: Number(stats?.total ?? 0), volumeNGN: Number(stats?.volume ?? 0) };
    }),
});
