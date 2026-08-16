/**
 * premiumTopUp.ts — Insurance Premium Top-Up Router
 * Handles premium payment top-ups with TigerBeetle atomicity.
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, count, sql, and, gte } from "drizzle-orm";
import { z } from "zod";

import { transactions, policies, auditLog } from "../../drizzle/schema";
import { premiums } from "../../drizzle/schema.additions";
import { logger } from "../_core/logger";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { acquireLock, releaseLock } from "../lib/redisClient";
import { tbCreateTransfer, tbEnsureAgentAccount } from "../tbClient";

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

      // Idempotency: the payment reference binds to exactly one durable
      // effect. Replay must ALSO verify the payload — silently replaying a
      // different amount/policy under a reused reference would mask a client
      // bug or replay attack (F-02).
      const existing = await db.select().from(transactions)
        .where(eq(transactions.ref, input.reference)).limit(1);
      if (existing.length > 0) {
        const prev = existing[0]!;
        const prevMeta = (prev.metadata ?? {}) as { policyId?: number };
        if (Number(prev.amount) !== input.amountNGN || prevMeta.policyId !== input.policyId) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Payment reference was already used with a different amount or policy. " +
              "Refusing to re-execute; submit with a new reference.",
          });
        }
        return { idempotent: true, transaction: prev };
      }

      const [policy] = await db.select().from(policies).where(eq(policies.id, input.policyId)).limit(1);
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      if (!["active", "bound", "lapsed"].includes(policy.status ?? "")) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Policy status '${policy.status}' does not allow premium payment` });
      }

      const txAgentId = input.agentId ?? policy.agentId;
      if (txAgentId == null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "agentId required: policy has no agent and none was provided" });
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

        // F-02: ALL PostgreSQL effects (transaction row, premium ledger row,
        // lapsed-policy reactivation) commit or roll back as ONE unit. The
        // reference is reserved first with ON CONFLICT DO NOTHING so a
        // concurrent duplicate gets zero rows back and replays the winner —
        // previously the check-then-insert race made the loser's premium
        // insert hit the unique constraint AFTER its premiums-row write,
        // leaving partial durable state and a 500 instead of a replay.
        type TopUpOutcome =
          | { replay: true }
          | { replay: false; tx: typeof transactions.$inferSelect; premium: typeof premiums.$inferSelect };
        const outcome = await db.transaction(async (tx): Promise<TopUpOutcome> => {
          const reserved = await tx.insert(transactions).values({
            ref: input.reference,
            agentId: txAgentId,
            type: "Insurance",
            amount: String(input.amountNGN),
            fee: "0",
            commission: "0",
            channel: ({ cash: "Cash", bank_transfer: "Internal", mobile_money: "App", card: "Card" } as const)[input.paymentMethod],
            status: "success",
            fraudScore: "0.00",
            metadata: { tbSyncStatus: tbResult ? "synced" : "pending", policyId: input.policyId, tbTransferId: tbResult?.id ?? null },
          }).onConflictDoNothing({ target: transactions.ref }).returning();
          if (reserved.length === 0) return { replay: true };

          // Record premium payment (premiums.premiumRef is UNIQUE; inside the
          // same transaction it can never leak without the transaction row).
          const [premiumRecord] = await tx.insert(premiums).values({
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

          // Link premium row into the transaction metadata and return the
          // durable (post-update) row to the caller.
          const [linkedTx] = await tx.update(transactions)
            .set({ metadata: { tbSyncStatus: tbResult ? "synced" : "pending", policyId: input.policyId, premiumId: premiumRecord.id, tbTransferId: tbResult?.id ?? null } })
            .where(eq(transactions.ref, input.reference))
            .returning();

          // Activate lapsed policy
          if (policy.status === "lapsed") {
            await tx.update(policies).set({ status: "active", updatedAt: new Date() }).where(eq(policies.id, input.policyId));
          }

          return { replay: false, tx: linkedTx ?? reserved[0]!, premium: premiumRecord };
        });

        if (outcome.replay) {
          const [winner] = await db.select().from(transactions)
            .where(eq(transactions.ref, input.reference)).limit(1);
          if (winner) return { idempotent: true, transaction: winner };
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Payment conflicted but no winner row found" });
        }

        await db.insert(auditLog).values({
          action: "PREMIUM_TOP_UP",
          resource: "policy",
          resourceId: String(input.policyId),
          status: "success",
          metadata: { amountNGN: input.amountNGN, reference: input.reference },
        }).catch(() => {});

        logger.info(`[PremiumTopUp] ₦${input.amountNGN} for policy ${input.policyId} | TB: ${tbResult?.id ?? "pending"}`);
        return { idempotent: false, transaction: outcome.tx, premium: outcome.premium, tbTransferId: tbResult?.id ?? null };
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
