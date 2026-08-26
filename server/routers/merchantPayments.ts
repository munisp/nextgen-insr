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
import { permifyCheck } from "../_core/permify";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { fluvioProduce } from "../fluvio";
import { publishEvent, type KafkaTopic } from "../kafkaClient";
import { acquireLock, releaseLock } from "../lib/redisClient";
import { cacheSet } from "../redisClient";
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
      // Sprint 44 wiring (F-12): domain-level authz before any funds move.
      // permifyCheck is fail-closed (deny on unavailable) unless the insecure
      // PERMIFY_FAIL_OPEN opt-in is set.
      const allowed = await permifyCheck({
        subjectType: "user", subjectId: agent.agentId,
        entityType: "merchantPayments", entityId: input.merchantId,
        permission: "execute",
      });
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Agent is not authorized for merchant payments" });
      const agentBalance = Number(agent.premiumReserve ?? 0);
      if (agentBalance < input.amountNGN) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Insufficient float. Available: ₦${agentBalance.toLocaleString()}` });
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const [{ dailyTotal }] = await db.select({ dailyTotal: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)` })
        .from(transactions).where(and(eq(transactions.agentId, input.agentId), sql`${transactions.metadata}->>'category' = 'merchant_payment'`, gte(transactions.createdAt, today), eq(transactions.status, "success")));
      if (Number(dailyTotal ?? 0) + input.amountNGN > DAILY_LIMIT) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Daily limit ₦${DAILY_LIMIT.toLocaleString()} exceeded` });
      // Lock per AGENT (not per reference): the balance mutation must be
      // serialized against ALL concurrent payments for this agent, not just
      // same-reference retries.
      const lockKey = `merchant-pay:${input.agentId}`;
      const locked = await acquireLock(lockKey, 15_000);
      if (!locked) throw new TRPCError({ code: "CONFLICT", message: "Another payment is in progress for this agent" });
      try {
        // Re-check idempotency inside the lock: the pre-check above ran
        // outside it, so a same-reference twin could have committed since.
        const existingLocked = await db.select().from(transactions).where(eq(transactions.ref, input.reference)).limit(1);
        if (existingLocked.length > 0) return { idempotent: true, transaction: existingLocked[0] };
        await tbEnsureAgentAccount(agent.agentId);
        const mdrFee = Math.round(input.amountNGN * MDR * 100) / 100;
        const merchantAmount = input.amountNGN - mdrFee;
        const tbResult = await tbCreateTransfer({
          debitAccountId: `float-${agent.agentId}`, creditAccountId: `merchant-${input.merchantId}`,
          amount: Math.round(merchantAmount * 100), ledger: 2000, code: 300,
          ref: input.reference, txType: "Merchant Payment", agentId: agent.agentId,
        });
        const txType = input.paymentMethod === "card" ? "Card Payment" as const
          : input.paymentMethod === "qr" ? "QR Payment" as const : "Transfer" as const;
        // Atomic multi-write (F4): guarded balance debit + transaction row +
        // audit row in ONE transaction. The debit is a single guarded
        // statement (SET balance = balance - amount WHERE balance >= amount)
        // with row-count verification — no stale-read blind write, and a
        // concurrent balance change fails closed instead of losing updates.
        let committed: { row: typeof transactions.$inferSelect; newBalance: number };
        try {
          committed = await db.transaction(async tx => {
            const debited = await tx.update(agents)
              .set({ premiumReserve: sql`${agents.premiumReserve} - ${input.amountNGN}`, updatedAt: new Date() })
              .where(and(eq(agents.id, input.agentId), sql`${agents.premiumReserve} >= ${input.amountNGN}`))
              .returning({ premiumReserve: agents.premiumReserve });
            if (debited.length === 0) {
              throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Insufficient float (balance changed concurrently)" });
            }
            const [row] = await tx.insert(transactions).values({
              ref: input.reference, agentId: input.agentId, type: txType,
              amount: String(input.amountNGN), fee: String(mdrFee), commission: "0",
              channel: ({ card: "Card", transfer: "Internal", qr: "QR", ussd: "USSD" } as const)[input.paymentMethod], status: "success", fraudScore: "0.00",
              metadata: { tbSyncStatus: tbResult ? "synced" : "pending", category: "merchant_payment", merchantRef: input.reference, merchantId: input.merchantId, mdrFee, merchantAmount, description: input.description ?? null, tbTransferId: tbResult?.id ?? null },
            }).returning();
            await tx.insert(auditLog).values({ action: "MERCHANT_PAYMENT", resource: "merchant_payment", resourceId: input.reference, status: "success", metadata: { merchantId: input.merchantId, amountNGN: input.amountNGN } });
            return { row, newBalance: Number(debited[0].premiumReserve) };
          });
        } catch (err) {
          // Unique violation on transactions.ref: a same-reference twin
          // committed between the in-lock re-check and our insert. The
          // transaction rolled back (no debit); return the winner's row.
          if (typeof err === "object" && err !== null && "code" in err && err.code === "23505") {
            const [winner] = await db.select().from(transactions).where(eq(transactions.ref, input.reference)).limit(1);
            if (winner) return { idempotent: true, transaction: winner };
          }
          throw err;
        }
        const { row: tx, newBalance } = committed;
        // Sprint 44 wiring (F-12): event fan-out + status cache. Best-effort
        // AFTER the funds effect is durable (TB transfer + Postgres row).
        try {
        await publishEvent("pos.merchantpayments" as KafkaTopic, "system", {
          event: "merchant_payment.completed", reference: input.reference,
          merchantId: input.merchantId, amountNGN: input.amountNGN,
          agentId: agent.agentId, mdrFee,
        });
        await fluvioProduce("pos.merchantpayments", {
          value: JSON.stringify({ event: "merchant_payment.completed", reference: input.reference, amountNGN: input.amountNGN }),
        });
        await cacheSet(`tx:status:${input.reference}`, "success", 300);
        } catch (e) {
          logger.warn(`[MerchantPayment] post-commit eventing degraded (tx is durable): ${e instanceof Error ? e.message : String(e)}`);
        }
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
