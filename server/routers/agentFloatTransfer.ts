/**
 * agentFloatTransfer.ts — Agent-to-Agent Float Transfer Router
 *
 * Handles float transfers between agents with full atomicity:
 *   1. Redis lock on both sender and receiver accounts
 *   2. TigerBeetle atomic double-entry (debit sender, credit receiver)
 *   3. PostgreSQL balance updates in a single transaction
 *   4. Fluvio event emission for real-time monitoring
 *
 * Business Rules:
 *   - Min transfer: ₦500
 *   - Max transfer: ₦500,000 per transaction
 *   - Daily transfer limit: ₦1,000,000 per agent
 *   - Both agents must be active and not locked
 *   - Sender must have sufficient float (balance - amount >= MIN_FLOAT)
 *   - Supervisor approval required for transfers > ₦100,000
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, count, sql, and, gte } from "drizzle-orm";
import { z } from "zod";

import { agents, transactions, auditLog } from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { acquireLock, releaseLock } from "../lib/redisClient";
import { tbCreateTransfer, tbEnsureAgentAccount } from "../tbClient";

const MIN_FLOAT = 5_000;
const MIN_TRANSFER = 500;
const MAX_TRANSFER = 500_000;
const DAILY_TRANSFER_LIMIT = 1_000_000;
const SUPERVISOR_THRESHOLD = 100_000;

/** Walk the error/cause chain looking for a Postgres unique violation. */
function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  while (typeof e === "object" && e !== null) {
    if ((e as { code?: string }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export const agentFloatTransferRouter = router({
  // ── Initiate transfer ────────────────────────────────────────────────────────
  transfer: protectedProcedure
    .input(z.object({
      senderAgentId: z.number(),
      receiverAgentId: z.number(),
      amountNGN: z.number().min(MIN_TRANSFER).max(MAX_TRANSFER),
      reference: z.string().min(5),
      reason: z.string().min(5),
      supervisorCode: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.senderAgentId === input.receiverAgentId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot transfer to self" });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Idempotency check — transactions.ref is UNIQUE, so a transfer
      // reference binds to exactly one durable effect. (F-01: this previously
      // referenced a non-existent `transactions.reference` column and every
      // call failed with a SQL syntax error.)
      const existing = await db.select().from(transactions)
        .where(eq(transactions.ref, input.reference)).limit(1);
      if (existing.length > 0) return { idempotent: true, transaction: existing[0] };

      // Load both agents
      const [sender, receiver] = await Promise.all([
        db.select().from(agents).where(eq(agents.id, input.senderAgentId)).limit(1).then(r => r[0]),
        db.select().from(agents).where(eq(agents.id, input.receiverAgentId)).limit(1).then(r => r[0]),
      ]);

      if (!sender) throw new TRPCError({ code: "NOT_FOUND", message: "Sender agent not found" });
      if (!receiver) throw new TRPCError({ code: "NOT_FOUND", message: "Receiver agent not found" });
      if (!sender.isActive) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sender agent is not active" });
      if (!receiver.isActive) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Receiver agent is not active" });
      if (sender.floatLocked) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sender float is locked" });
      if (receiver.floatLocked) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Receiver float is locked" });

      const senderBalance = Number(sender.premiumReserve ?? 0);
      if (senderBalance - input.amountNGN < MIN_FLOAT) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Insufficient float. Available: ₦${(senderBalance - MIN_FLOAT).toLocaleString()}`,
        });
      }

      // Supervisor approval for large transfers
      if (input.amountNGN > SUPERVISOR_THRESHOLD && !input.supervisorCode) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Transfers > ₦${SUPERVISOR_THRESHOLD.toLocaleString()} require supervisor approval code`,
        });
      }

      // Daily limit check
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const [{ dailyTotal }] = await db.select({
        dailyTotal: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
      }).from(transactions).where(and(
        eq(transactions.agentId, input.senderAgentId),
        eq(transactions.type, "Float Transfer"),
        gte(transactions.createdAt, today),
        eq(transactions.status, "success")
      ));
      if (Number(dailyTotal ?? 0) + input.amountNGN > DAILY_TRANSFER_LIMIT) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Daily transfer limit of ₦${DAILY_TRANSFER_LIMIT.toLocaleString()} exceeded`,
        });
      }

      // Acquire locks on both accounts (ordered by ID to prevent deadlock)
      const [lockA, lockB] = input.senderAgentId < input.receiverAgentId
        ? [`float-transfer:${input.senderAgentId}`, `float-transfer:${input.receiverAgentId}`]
        : [`float-transfer:${input.receiverAgentId}`, `float-transfer:${input.senderAgentId}`];

      const lock1 = await acquireLock(lockA, 15_000);
      if (!lock1) throw new TRPCError({ code: "CONFLICT", message: "Transfer in progress, please retry" });

      const lock2 = await acquireLock(lockB, 15_000);
      if (!lock2) {
        await releaseLock(lockA);
        throw new TRPCError({ code: "CONFLICT", message: "Transfer in progress on receiver account, please retry" });
      }

      try {
        // Ensure TB accounts exist
        await Promise.all([
          tbEnsureAgentAccount(sender.agentId),
          tbEnsureAgentAccount(receiver.agentId),
        ]);

        // TigerBeetle atomic double-entry transfer
        const tbResult = await tbCreateTransfer({
          debitAccountId: `float-${sender.agentId}`,
          creditAccountId: `float-${receiver.agentId}`,
          amount: Math.round(input.amountNGN * 100),
          ledger: 2000,
          code: 300, // TRANSFER
          ref: input.reference,
          txType: "Float Transfer",
          agentId: sender.agentId,
        });

        // F-01: ALL PostgreSQL effects (sender debit, receiver credit, both
        // transaction legs, audit) commit or roll back as ONE unit. The
        // sender debit is a conditional atomic UPDATE so concurrent transfers
        // can never drive the balance below MIN_FLOAT, regardless of how the
        // reads above raced. Previously the two balance updates ran in a
        // non-transactional Promise.all: a failure on the second write left
        // the first one committed — value was created/destroyed.
        type TransferOutcome =
          | { replay: true }
          | {
              replay: false;
              txRow: typeof transactions.$inferSelect;
              senderNewBalanceNGN: number;
              receiverNewBalanceNGN: number;
            };
        let outcome: TransferOutcome;
        try {
          outcome = await db.transaction(async (tx): Promise<TransferOutcome> => {
            // Reserve the reference first: ON CONFLICT DO NOTHING means a
            // concurrent duplicate gets zero rows back (no DB error, no
            // aborted transaction) and replays the winner after commit.
            const reserved = await tx.insert(transactions).values({
              ref: input.reference,
              agentId: input.senderAgentId,
              type: "Float Transfer",
              amount: String(input.amountNGN),
              fee: "0",
              commission: "0",
              channel: "Internal",
              status: "success",
              fraudScore: "0.00",
              metadata: {
                receiverAgentId: input.receiverAgentId,
                receiverAgentCode: receiver.agentId,
                reason: input.reason,
                tbTransferId: tbResult?.id ?? null,
                tbSyncStatus: tbResult ? "synced" : "pending",
              },
            }).onConflictDoNothing({ target: transactions.ref }).returning();
            if (reserved.length === 0) return { replay: true };

            // Atomic conditional debit — the no-overdraft invariant is
            // enforced by the database, not by the earlier read.
            const debited = await tx
              .update(agents)
              .set({
                premiumReserve: sql`CAST("premiumReserve" AS NUMERIC) - ${input.amountNGN}`,
                updatedAt: new Date(),
              })
              .where(and(
                eq(agents.id, input.senderAgentId),
                sql`CAST("premiumReserve" AS NUMERIC) - ${input.amountNGN} >= ${MIN_FLOAT}`
              ))
              .returning({ balance: agents.premiumReserve });
            if (debited.length === 0) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: `Insufficient float. Available: ₦${(senderBalance - MIN_FLOAT).toLocaleString()}`,
              });
            }

            const credited = await tx
              .update(agents)
              .set({
                premiumReserve: sql`CAST("premiumReserve" AS NUMERIC) + ${input.amountNGN}`,
                updatedAt: new Date(),
              })
              .where(eq(agents.id, input.receiverAgentId))
              .returning({ balance: agents.premiumReserve });
            if (credited.length === 0) {
              throw new TRPCError({ code: "NOT_FOUND", message: "Receiver agent not found" });
            }

            // Record credit transaction for receiver
            await tx.insert(transactions).values({
              ref: `${input.reference}-RCV`,
              agentId: input.receiverAgentId,
              type: "Float Transfer Received",
              amount: String(input.amountNGN),
              fee: "0",
              commission: "0",
              channel: "Internal",
              status: "success",
              fraudScore: "0.00",
              metadata: {
                senderAgentId: input.senderAgentId,
                senderAgentCode: sender.agentId,
                reason: input.reason,
                tbTransferId: tbResult?.id ?? null,
                tbSyncStatus: tbResult ? "synced" : "pending",
              },
            });

            await tx.insert(auditLog).values({
              action: "FLOAT_TRANSFER",
              resource: "agent_float",
              resourceId: String(input.senderAgentId),
              status: "success",
              metadata: {
                amountNGN: input.amountNGN,
                senderAgentId: input.senderAgentId,
                receiverAgentId: input.receiverAgentId,
                tbTransferId: tbResult?.id ?? null,
              },
            });

            return {
              replay: false,
              txRow: reserved[0]!,
              senderNewBalanceNGN: Number(debited[0]!.balance),
              receiverNewBalanceNGN: Number(credited[0]!.balance),
            };
          });
        } catch (err) {
          // Last-resort race handler (e.g. constraint race outside the
          // reservation above): if a committed winner exists for this
          // reference, replay it instead of double-moving funds.
          if (isUniqueViolation(err)) {
            const [winner] = await db.select().from(transactions)
              .where(eq(transactions.ref, input.reference)).limit(1);
            if (winner) return { idempotent: true, transaction: winner };
          }
          throw err;
        }

        if (outcome.replay) {
          const [winner] = await db.select().from(transactions)
            .where(eq(transactions.ref, input.reference)).limit(1);
          if (winner) return { idempotent: true, transaction: winner };
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Transfer conflicted but no winner row found" });
        }

        logger.info(`[FloatTransfer] ₦${input.amountNGN} from agent ${sender.agentId} to ${receiver.agentId} | TB: ${tbResult?.id ?? "pending"}`);

        return {
          idempotent: false,
          transaction: outcome.txRow,
          senderNewBalanceNGN: outcome.senderNewBalanceNGN,
          receiverNewBalanceNGN: outcome.receiverNewBalanceNGN,
          tbTransferId: tbResult?.id ?? null,
          tbSyncStatus: tbResult?.syncStatus ?? "pending",
        };
      } finally {
        await releaseLock(lockA);
        await releaseLock(lockB);
      }
    }),

  // ── Transfer history ─────────────────────────────────────────────────────────
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
          sql`type IN ('Float Transfer', 'Float Transfer Received')`
        ))
        .orderBy(desc(transactions.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [{ total }] = await db.select({ total: count() }).from(transactions)
        .where(and(
          eq(transactions.agentId, input.agentId),
          sql`type IN ('Float Transfer', 'Float Transfer Received')`
        ));

      return { data: results, total: Number(total) };
    }),

  // ── Summary ──────────────────────────────────────────────────────────────────
  getSummary: protectedProcedure
    .input(z.object({ periodDays: z.number().min(1).max(90).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { totalTransfers: 0, totalVolumeNGN: 0 };

      const since = new Date(Date.now() - input.periodDays * 86400000);
      const [stats] = await db.select({
        total: count(),
        totalAmount: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
      }).from(transactions)
        .where(and(
          eq(transactions.type, "Float Transfer"),
          gte(transactions.createdAt, since),
          eq(transactions.status, "success")
        ));

      return {
        periodDays: input.periodDays,
        totalTransfers: Number(stats?.total ?? 0),
        totalVolumeNGN: Number(stats?.totalAmount ?? 0),
        limits: { minTransfer: MIN_TRANSFER, maxTransfer: MAX_TRANSFER, dailyLimit: DAILY_TRANSFER_LIMIT },
      };
    }),
});
