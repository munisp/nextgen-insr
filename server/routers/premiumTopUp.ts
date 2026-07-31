/**
 * premiumTopUp.ts — Insurance Premium Top-Up Router
 * Handles premium payment top-ups with TigerBeetle atomicity.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { transactions, policies, auditLog } from "../../drizzle/schema";
import { premiums } from "../../drizzle/schema.additions";
import { eq, desc, count, sql, and, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { tbCreateTransfer, tbEnsureAgentAccount } from "../tbClient";
import { acquireLock, releaseLock } from "../lib/redisClient";
import { logger } from "../_core/logger";

export const premiumTopUpRouter = router({
  topUp: protectedProcedure
    .input(z.object({
      policyId: z.number(),
      amountNGN: z.number().positive(),
      paymentMethod: z.enum(["cash", "bank_transfer", "mobile_money", "card"]),
      reference: z.string().min(5),
      agentId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Idempotency
      const existing = await db.select().from(transactions)
        .where(eq(transactions.reference, input.reference)).limit(1);
      if (existing.length > 0) return { idempotent: true, transaction: existing[0] };

      const [policy] = await db.select().from(policies).where(eq(policies.id, input.policyId)).limit(1);
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      if (!["active", "bound", "lapsed"].includes(policy.status ?? "")) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Policy status '${policy.status}' does not allow premium payment` });
      }

      const lockKey = `premium-topup:${input.policyId}:${input.reference}`;
      const locked = await acquireLock(lockKey, 15_000);
      if (!locked) throw new TRPCError({ code: "CONFLICT", message: "Payment in progress" });

      try {
        const tbResult = await tbCreateTransfer({
          debitAccountId: `customer-${policy.customerId}`,
          creditAccountId: "insurer-premium-pool",
          amount: Math.round(input.amountNGN * 100),
          ledger: 3000,
          code: 700,
          ref: input.reference,
          txType: "premium_payment",
          agentId: input.agentId ? String(input.agentId) : undefined,
        });

        // Record premium payment
        const [premiumRecord] = await db.insert(premiums).values({
          policyId: input.policyId,
          customerId: policy.customerId ?? undefined,
          agentId: input.agentId ?? undefined,
          premiumRef: input.reference,
          amount: String(input.amountNGN),
          currency: "NGN",
          dueDate: new Date(),
          paidDate: new Date(),
          status: "paid",
          paymentMethod: input.paymentMethod,
          paymentRef: input.reference,
          tbTransferId: tbResult?.id ?? null,
        }).returning();

        // Activate lapsed policy
        if (policy.status === "lapsed") {
          await db.update(policies).set({ status: "active", updatedAt: new Date() }).where(eq(policies.id, input.policyId));
        }

        const [tx] = await db.insert(transactions).values({
          reference: input.reference,
          agentId: input.agentId ?? null,
          type: "Premium Payment",
          amount: String(input.amountNGN),
          fee: "0",
          commission: "0",
          channel: input.paymentMethod,
          status: "success",
          fraudScore: "0.00",
          tbSyncStatus: tbResult ? "synced" : "pending",
          metadata: { policyId: input.policyId, premiumId: premiumRecord.id, tbTransferId: tbResult?.id ?? null },
        }).returning();

        await db.insert(auditLog).values({
          action: "PREMIUM_TOP_UP",
          resource: "policy",
          resourceId: String(input.policyId),
          status: "success",
          metadata: { amountNGN: input.amountNGN, reference: input.reference },
        }).catch(() => {});

        logger.info(`[PremiumTopUp] ₦${input.amountNGN} for policy ${input.policyId} | TB: ${tbResult?.id ?? "pending"}`);
        return { idempotent: false, transaction: tx, premium: premiumRecord, tbTransferId: tbResult?.id ?? null };
      } finally {
        await releaseLock(lockKey);
      }
    }),

  getHistory: protectedProcedure
    .input(z.object({ policyId: z.number(), limit: z.number().default(20), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { data: [], total: 0 };
      const results = await db.select().from(premiums)
        .where(eq(premiums.policyId, input.policyId))
        .orderBy(desc(premiums.id)).limit(input.limit).offset(input.offset);
      const [{ total }] = await db.select({ total: count() }).from(premiums).where(eq(premiums.policyId, input.policyId));
      return { data: results, total: Number(total) };
    }),

  getSummary: protectedProcedure
    .input(z.object({ periodDays: z.number().default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { totalPayments: 0, totalVolumeNGN: 0 };
      const since = new Date(Date.now() - input.periodDays * 86400000);
      const [stats] = await db.select({
        total: count(),
        totalAmount: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
        overdue: sql<number>`COUNT(*) FILTER (WHERE status = 'overdue')`,
      }).from(premiums).where(gte(premiums.createdAt, since));
      return {
        periodDays: input.periodDays,
        totalPayments: Number(stats?.total ?? 0),
        totalVolumeNGN: Number(stats?.totalAmount ?? 0),
        overdueCount: Number(stats?.overdue ?? 0),
      };
    }),
});
