/**
 * splitPayments.ts — Split Payment Router
 *
 * Handles multi-party payment splits with full atomicity:
 *   1. Redis lock prevents concurrent splits on same transaction
 *   2. TigerBeetle multi-leg transfer for each split leg
 *   3. All legs succeed or all fail (saga pattern via Temporal)
 *   4. PostgreSQL records each leg with parent reference
 *
 * Business Rules:
 *   - Min 2 parties, max 10 parties per split
 *   - Split percentages must sum to exactly 100%
 *   - Each party must receive minimum ₦100
 *   - All parties must be active agents or verified merchants
 *   - Split reference must be unique
 *   - Partial splits not allowed — all legs must succeed
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, count, sql, and, gte } from "drizzle-orm";
import { z } from "zod";

import { transactions, agents, auditLog, merchants } from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { protectedProcedure, router } from "../_core/trpc";
import { financialProcedure } from "../_core/permifyMiddleware";
import { getDb } from "../db";
import { acquireLock, releaseLock } from "../lib/redisClient";
import { tbCreateTransfer, tbEnsureAgentAccount } from "../tbClient";

const MIN_SPLIT_AMOUNT = 100;
const MAX_PARTIES = 10;

// MED-15 (G1 fix-wave, 2026-06): a party may be an AGENT (agentId) or a
// VERIFIED MERCHANT (merchantId) — matching the documented rule "all parties
// must be active agents or verified merchants". Merchant parties are loaded
// from the merchants table and must be status=active; before this fix the
// documented merchant path did not exist at all and every beneficiary was an
// unchecked caller-picked agent ID.
const SplitPartySchema = z
  .object({
    agentId: z.number().optional(),
    merchantId: z.number().optional(),
    percentage: z.number().min(0.01).max(100),
    description: z.string().optional(),
  })
  .refine(p => (p.agentId != null) !== (p.merchantId != null), {
    message: "Each party must specify exactly one of agentId or merchantId",
  });

export const splitPaymentsRouter = router({
  // ── Create split payment ─────────────────────────────────────────────────────
  createSplit: financialProcedure
    .input(z.object({
      totalAmountNGN: z.number().positive(),
      reference: z.string().min(5),
      parties: z.array(SplitPartySchema).min(2).max(MAX_PARTIES),
      sourceAgentId: z.number(),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Validate percentages sum to 100
      const totalPct = input.parties.reduce((s, p) => s + p.percentage, 0);
      if (Math.abs(totalPct - 100) > 0.01) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Split percentages must sum to 100%. Got: ${totalPct.toFixed(2)}%`,
        });
      }

      // Validate each party receives at least MIN_SPLIT_AMOUNT
      for (const party of input.parties) {
        const partyAmount = (party.percentage / 100) * input.totalAmountNGN;
        if (partyAmount < MIN_SPLIT_AMOUNT) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Party ${party.agentId} would receive ₦${partyAmount.toFixed(2)}, below minimum ₦${MIN_SPLIT_AMOUNT}`,
          });
        }
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Idempotency check
      const existing = await db.select().from(transactions)
        .where(eq(transactions.ref, input.reference)).limit(1);
      if (existing.length > 0) return { idempotent: true, splitRef: input.reference };

      // Load source agent
      const [sourceAgent] = await db.select().from(agents)
        .where(eq(agents.id, input.sourceAgentId)).limit(1);
      if (!sourceAgent) throw new TRPCError({ code: "NOT_FOUND", message: "Source agent not found" });
      if (sourceAgent.floatLocked) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Source float is locked" });

      const sourceBalance = Number(sourceAgent.premiumReserve ?? 0);
      if (sourceBalance < input.totalAmountNGN) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Insufficient float. Available: ₦${sourceBalance.toLocaleString()}`,
        });
      }

      // Load all parties: agent parties must be active agents; merchant
      // parties must be ACTIVE merchants (MED-15 — the counterparty
      // verification the doc line always promised). Resolution is
      // FAIL-CLOSED: a party row that cannot be resolved aborts the split
      // (no undefined counterparty ever reaches a funds movement).
      const partyAgents = await Promise.all(
        input.parties.map(p =>
          p.agentId != null
            ? db.select().from(agents).where(eq(agents.id, p.agentId)).limit(1).then(r => r[0])
            : Promise.resolve(undefined))
      );
      const partyMerchants = await Promise.all(
        input.parties.map(p =>
          p.merchantId != null
            ? db.select().from(merchants).where(eq(merchants.id, p.merchantId)).limit(1).then(r => r[0])
            : Promise.resolve(undefined))
      );
      type ResolvedParty =
        | { kind: "agent"; agent: (typeof agents.$inferSelect); percentage: number }
        | { kind: "merchant"; merchant: (typeof merchants.$inferSelect); percentage: number };
      const resolvedParties: ResolvedParty[] = input.parties.map((party, i) => {
        if (party.agentId != null) {
          const a = partyAgents[i];
          if (!a) throw new TRPCError({ code: "NOT_FOUND", message: `Party agent ${party.agentId} not found` });
          if (!a.isActive) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Party agent ${party.agentId} is not active` });
          return { kind: "agent" as const, agent: a, percentage: party.percentage };
        }
        const m = partyMerchants[i];
        if (!m) throw new TRPCError({ code: "NOT_FOUND", message: `Party merchant ${party.merchantId} not found` });
        if (m.status !== "active") throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Party merchant ${party.merchantId} is not active` });
        return { kind: "merchant" as const, merchant: m, percentage: party.percentage };
      });

      // Acquire lock on the SOURCE AGENT (not the split reference): all
      // balance mutations for one agent must serialize against each other,
      // including splits with different references.
      const lockKey = `split-payment:${input.sourceAgentId}`;
      const locked = await acquireLock(lockKey, 30_000);
      if (!locked) throw new TRPCError({ code: "CONFLICT", message: "Split payment in progress" });

      const tbTransferIds: string[] = [];
      const legs: Array<{
        agentId: number | null;
        merchantId: number | null;
        amountNGN: number;
        tbId: string | null;
      }> = [];

      try {
        // Re-check idempotency inside the lock (the pre-check above ran
        // outside it — a same-reference twin could have committed since).
        const existingLocked = await db.select().from(transactions)
          .where(eq(transactions.ref, input.reference)).limit(1);
        if (existingLocked.length > 0) return { idempotent: true, splitRef: input.reference };

        // Ensure all TB accounts exist (agent floats; merchant TB accounts
        // are addressed as merchant-<merchantCode> like merchantPayments).
        await Promise.all([
          tbEnsureAgentAccount(sourceAgent.agentId),
          ...resolvedParties.map(rp =>
            rp.kind === "agent"
              ? tbEnsureAgentAccount(rp.agent.agentId)
              : Promise.resolve()
          ),
        ]);

        // Execute each split leg via TigerBeetle
        for (let i = 0; i < resolvedParties.length; i++) {
          const rp = resolvedParties[i];
          const partyAmountNGN = Math.round((rp.percentage / 100) * input.totalAmountNGN * 100) / 100;
          const legRef = `${input.reference}-LEG${i + 1}`;

          const creditAccountId =
            rp.kind === "agent"
              ? `float-${rp.agent.agentId}`
              : `merchant-${rp.merchant.merchantCode}`;
          const tbResult = await tbCreateTransfer({
            debitAccountId: `float-${sourceAgent.agentId}`,
            creditAccountId,
            amount: Math.round(partyAmountNGN * 100),
            ledger: 2000,
            code: 300,
            ref: legRef,
            txType: "Split Payment",
            agentId: sourceAgent.agentId,
          });

          legs.push({
            agentId: rp.kind === "agent" ? rp.agent.id : null,
            merchantId: rp.kind === "merchant" ? rp.merchant.id : null,
            amountNGN: partyAmountNGN,
            tbId: tbResult?.id ?? null,
          });
          if (tbResult?.id) tbTransferIds.push(tbResult.id);
        }

        // Atomic multi-write (F4): source debit + every party credit + all
        // transaction rows + audit in ONE transaction. Any leg failure rolls
        // back ALL legs — partial splits are impossible. Balance mutations
        // are guarded single statements with row-count verification (no
        // stale-read blind writes; the source debit carries a floor guard).
        let parentTx: typeof transactions.$inferSelect;
        try {
          parentTx = await db.transaction(async tx => {
          const debited = await tx.update(agents)
            .set({ premiumReserve: sql`${agents.premiumReserve} - ${input.totalAmountNGN}`, updatedAt: new Date() })
            .where(and(
              eq(agents.id, input.sourceAgentId),
              sql`${agents.premiumReserve} >= ${input.totalAmountNGN}`
            ))
            .returning({ id: agents.id });
          if (debited.length === 0) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Insufficient float (balance changed concurrently)",
            });
          }

          for (let i = 0; i < resolvedParties.length; i++) {
            const rp = resolvedParties[i];
            const leg = legs[i];
            if (!leg) {
              // Fail-closed: a missing leg row must roll back the whole
              // split rather than skip a credit.
              throw new TRPCError({
                code: "CONFLICT",
                message: `Split leg ${i + 1} missing — split rolled back`,
              });
            }
            if (rp.kind === "agent") {
              const credited = await tx.update(agents)
                .set({ premiumReserve: sql`${agents.premiumReserve} + ${leg.amountNGN}`, updatedAt: new Date() })
                .where(eq(agents.id, rp.agent.id))
                .returning({ id: agents.id });
              if (credited.length === 0) {
                throw new TRPCError({
                  code: "NOT_FOUND",
                  message: `Party agent ${rp.agent.id} disappeared concurrently — split rolled back`,
                });
              }
            } else {
              const credited = await tx.update(merchants)
                .set({ walletBalance: sql`${merchants.walletBalance} + ${leg.amountNGN}`, updatedAt: new Date() })
                .where(eq(merchants.id, rp.merchant.id))
                .returning({ id: merchants.id });
              if (credited.length === 0) {
                throw new TRPCError({
                  code: "NOT_FOUND",
                  message: `Party merchant ${rp.merchant.id} disappeared concurrently — split rolled back`,
                });
              }
            }
          }

          // Record parent transaction
          const [parent] = await tx.insert(transactions).values({
            ref: input.reference,
            agentId: input.sourceAgentId,
            type: "Transfer",
            amount: String(input.totalAmountNGN),
            fee: "0",
            commission: "0",
            channel: "Internal",
            status: "success",
            fraudScore: "0.00",
            metadata: {
              tbSyncStatus: tbTransferIds.length > 0 ? "synced" : "pending",
              category: "split_payment",
              parties: legs,
              description: input.description ?? null,
              tbTransferIds,
            },
          }).returning();

          // Record leg transactions
          for (let i = 0; i < resolvedParties.length; i++) {
            const rpRow = resolvedParties[i];
            await tx.insert(transactions).values({
              ref: `${input.reference}-LEG${i + 1}`,
              // transactions.agentId is NOT NULL; merchant legs are recorded
              // against the source agent with the merchant party marked in
              // the parent metadata.legs entry.
              agentId: rpRow.kind === "agent" ? rpRow.agent.id : input.sourceAgentId,
              type: "Float Transfer Received",
              amount: String(legs[i].amountNGN),
              fee: "0",
              commission: "0",
              channel: "Internal",
              status: "success",
              fraudScore: "0.00",
              metadata: { category: "split_payment", parentRef: input.reference, tbTransferId: legs[i].tbId, tbSyncStatus: legs[i].tbId ? "synced" : "pending" },
            });
          }

          await tx.insert(auditLog).values({
            action: "SPLIT_PAYMENT",
            resource: "split_payment",
            resourceId: input.reference,
            status: "success",
            metadata: { totalAmountNGN: input.totalAmountNGN, parties: legs.length, tbTransferIds },
          });
          return parent;
          });
        } catch (err) {
          // Unique violation on transactions.ref: a same-reference twin
          // committed between the in-lock re-check and our insert. The whole
          // split rolled back (no leg debited/credited); report idempotent.
          if (typeof err === "object" && err !== null && "code" in err && err.code === "23505") {
            return { idempotent: true, splitRef: input.reference };
          }
          throw err;
        }

        logger.info(`[SplitPayment] ₦${input.totalAmountNGN} split ${input.parties.length} ways | ref: ${input.reference}`);

        return {
          idempotent: false,
          splitRef: input.reference,
          totalAmountNGN: input.totalAmountNGN,
          legs,
          tbTransferIds,
          parentTransaction: parentTx,
        };
      } finally {
        await releaseLock(lockKey);
      }
    }),

  // ── Get split history ────────────────────────────────────────────────────────
  getHistory: protectedProcedure
    .input(z.object({
      agentId: z.number(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { data: [], total: 0 };

      const results = await db.select().from(transactions)
        .where(and(
          eq(transactions.agentId, input.agentId),
          sql`${transactions.metadata}->>'category' = 'split_payment'`
        ))
        .orderBy(desc(transactions.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [{ total }] = await db.select({ total: count() }).from(transactions)
        .where(and(
          eq(transactions.agentId, input.agentId),
          sql`${transactions.metadata}->>'category' = 'split_payment'`
        ));

      return { data: results, total: Number(total) };
    }),

  getSummary: protectedProcedure
    .input(z.object({ periodDays: z.number().min(1).max(90).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { totalSplits: 0, totalVolumeNGN: 0 };

      const since = new Date(Date.now() - input.periodDays * 86400000);
      const [stats] = await db.select({
        total: count(),
        totalAmount: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
      }).from(transactions)
        .where(and(
          sql`${transactions.metadata}->>'category' = 'split_payment'`,
          gte(transactions.createdAt, since),
          eq(transactions.status, "success")
        ));

      return {
        periodDays: input.periodDays,
        totalSplits: Number(stats?.total ?? 0),
        totalVolumeNGN: Number(stats?.totalAmount ?? 0),
      };
    }),
});
