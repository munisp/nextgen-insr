/**
 * merchantPayments.ts — Merchant Payments Router
 * Full production: POS merchant payments with TigerBeetle atomicity.
 * Business Rules: Min ₦100, Max ₦1M, Daily ₦5M, MDR 1.5%, Settlement T+1
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, count, sql, and, gte } from "drizzle-orm";
import { z } from "zod";

import { transactions, agents, auditLog } from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { acquireLock, releaseLock } from "../lib/redisClient";
import { tbCreateTransfer, tbEnsureAgentAccount } from "../tbClient";

const MIN_AMOUNT = 100, MAX_AMOUNT = 1_000_000, DAILY_LIMIT = 5_000_000;
const MDR = 0.015; // Merchant Discount Rate

export const merchantPaymentsRouter = router({
  pay: protectedProcedure
    .input(z.object({
      agentId: z.number(), merchantId: z.string().min(5),
      amountNGN: z.number().min(MIN_AMOUNT).max(MAX_AMOUNT),
      reference: z.string().min(5), description: z.string().optional(),
      paymentMethod: z.enum(["card", "transfer", "qr", "ussd"]),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const existing = await db.select().from(transactions).where(eq(transactions.ref, input.reference)).limit(1);
      if (existing.length > 0) return { idempotent: true, transaction: existing[0] };
      const [agent] = await db.select().from(agents).where(eq(agents.id, input.agentId)).limit(1);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
      if (!agent.isActive || agent.floatLocked) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Agent not available" });
      const agentBalance = Number(agent.premiumReserve ?? 0);
      if (agentBalance < input.amountNGN) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Insufficient float. Available: ₦${agentBalance.toLocaleString()}` });
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const [{ dailyTotal }] = await db.select({ dailyTotal: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)` })
        .from(transactions).where(and(eq(transactions.agentId, input.agentId), sql`${transactions.metadata}->>'category' = 'merchant_payment'`, gte(transactions.createdAt, today), eq(transactions.status, "success")));
      if (Number(dailyTotal ?? 0) + input.amountNGN > DAILY_LIMIT) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Daily limit ₦${DAILY_LIMIT.toLocaleString()} exceeded` });
      const lockKey = `merchant-pay:${input.agentId}:${input.reference}`;
      const locked = await acquireLock(lockKey, 15_000);
      if (!locked) throw new TRPCError({ code: "CONFLICT", message: "Payment in progress" });
      try {
        await tbEnsureAgentAccount(agent.agentId);
        const mdrFee = Math.round(input.amountNGN * MDR * 100) / 100;
        const merchantAmount = input.amountNGN - mdrFee;
        const tbResult = await tbCreateTransfer({
          debitAccountId: `float-${agent.agentId}`, creditAccountId: `merchant-${input.merchantId}`,
          amount: Math.round(merchantAmount * 100), ledger: 2000, code: 300,
          ref: input.reference, txType: "Merchant Payment", agentId: agent.agentId,
        });
        const newBalance = agentBalance - input.amountNGN;
        await db.update(agents).set({ premiumReserve: String(newBalance), updatedAt: new Date() }).where(eq(agents.id, input.agentId));
        const txType = input.paymentMethod === "card" ? "Card Payment" as const
          : input.paymentMethod === "qr" ? "QR Payment" as const : "Transfer" as const;
        const [tx] = await db.insert(transactions).values({
          ref: input.reference, agentId: input.agentId, type: txType,
          amount: String(input.amountNGN), fee: String(mdrFee), commission: "0",
          channel: ({ card: "Card", transfer: "Internal", qr: "QR", ussd: "USSD" } as const)[input.paymentMethod], status: "success", fraudScore: "0.00",
          metadata: { tbSyncStatus: tbResult ? "synced" : "pending", category: "merchant_payment", merchantRef: input.reference, merchantId: input.merchantId, mdrFee, merchantAmount, description: input.description ?? null, tbTransferId: tbResult?.id ?? null },
        }).returning();
        await db.insert(auditLog).values({ action: "MERCHANT_PAYMENT", resource: "merchant_payment", resourceId: input.reference, status: "success", metadata: { merchantId: input.merchantId, amountNGN: input.amountNGN } }).catch(() => {});
        logger.info(`[MerchantPayment] ₦${input.amountNGN} to merchant ${input.merchantId} | agent ${agent.agentId} | TB: ${tbResult?.id ?? "pending"}`);
        return { idempotent: false, transaction: tx, mdrFee, merchantAmount, newBalanceNGN: newBalance, tbTransferId: tbResult?.id ?? null };
      } finally { await releaseLock(lockKey); }
    }),

  list: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20), offset: z.number().min(0).default(0) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { data: [], total: 0 };
      const results = await db.select().from(transactions).where(sql`${transactions.metadata}->>'category' = 'merchant_payment'`).orderBy(desc(transactions.createdAt)).limit(input.limit).offset(input.offset);
      const [{ total }] = await db.select({ total: count() }).from(transactions).where(sql`${transactions.metadata}->>'category' = 'merchant_payment'`);
      return { data: results, total: Number(total) };
    }),

  getSummary: protectedProcedure
    .input(z.object({ periodDays: z.number().default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { total: 0, volumeNGN: 0, mdrFeesNGN: 0 };
      const since = new Date(Date.now() - input.periodDays * 86400000);
      const [stats] = await db.select({
        total: count(), volume: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`, fees: sql<string>`COALESCE(SUM(CAST(fee AS NUMERIC)), 0)`,
      }).from(transactions).where(and(sql`${transactions.metadata}->>'category' = 'merchant_payment'`, gte(transactions.createdAt, since), eq(transactions.status, "success")));
      return { periodDays: input.periodDays, total: Number(stats?.total ?? 0), volumeNGN: Number(stats?.volume ?? 0), mdrFeesNGN: Number(stats?.fees ?? 0), mdrRate: MDR, limits: { minAmountNGN: MIN_AMOUNT, maxAmountNGN: MAX_AMOUNT, dailyLimitNGN: DAILY_LIMIT } };
    }),
});
