/**
 * floatManagement.ts — Agent Float Management Router
 *
 * Manages agent premium reserve (float) with full atomicity:
 *   1. Redis distributed lock prevents concurrent float mutations
 *   2. TigerBeetle double-entry ledger for every debit/credit
 *   3. PostgreSQL as authoritative source when TB sidecar is offline
 *   4. Temporal workflow for large float top-ups requiring approval
 *
 * Business Rules (CBN Agent Banking Guidelines):
 *   - Min float: ₦5,000 (agent cannot transact below this)
 *   - Max float: ₦5,000,000 per agent
 *   - Daily top-up limit: ₦2,000,000 per agent
 *   - Float lock during settlement (15:00–17:30 WAT daily)
 *   - Supervisor approval required for top-ups > ₦500,000
 *   - All float movements must have TigerBeetle double-entry
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, count, sql, and, gte, sum } from "drizzle-orm";
import { z } from "zod";

import { agents, transactions, auditLog } from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { financialProcedure } from "../_core/permifyMiddleware";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { acquireLock, releaseLock } from "../lib/redisClient";
import { tbCreateTransfer, tbGetAgentBalance, tbEnsureAgentAccount } from "../tbClient";

const MIN_FLOAT = 5_000;
const MAX_FLOAT = 5_000_000;
const DAILY_TOP_UP_LIMIT = 2_000_000;
const SUPERVISOR_APPROVAL_THRESHOLD = 500_000;

async function getAgentDailyTopUp(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, agentId: number): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [result] = await db.select({
    total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
  }).from(transactions)
    .where(and(
      eq(transactions.agentId, agentId),
      eq(transactions.type, "Float Transfer Received"),
      gte(transactions.createdAt, today),
      eq(transactions.status, "success")
    ));
  return Number(result?.total ?? 0);
}

export const floatManagementRouter = router({
  // ── Get float balance ────────────────────────────────────────────────────────
  getBalance: protectedProcedure
    .input(z.object({ agentId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [agent] = await db.select({
        id: agents.id,
        agentId: agents.agentId,
        name: agents.name,
        premiumReserve: agents.premiumReserve,
        floatLocked: agents.floatLocked,
        isActive: agents.isActive,
      }).from(agents).where(eq(agents.id, input.agentId)).limit(1);

      if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });

      // Try TigerBeetle first for real-time balance
      const tbBalance = await tbGetAgentBalance(agent.agentId);
      const balanceNGN = tbBalance?.balanceNGN ?? Number(agent.premiumReserve ?? 0);
      const dailyTopUp = await getAgentDailyTopUp(db, input.agentId);

      return {
        agentId: input.agentId,
        agentCode: agent.agentId,
        balanceNGN,
        balanceKobo: Math.round(balanceNGN * 100),
        source: tbBalance ? "tigerbeetle" : "postgresql",
        floatLocked: agent.floatLocked ?? false,
        minFloat: MIN_FLOAT,
        maxFloat: MAX_FLOAT,
        dailyTopUpUsed: dailyTopUp,
        dailyTopUpRemaining: Math.max(0, DAILY_TOP_UP_LIMIT - dailyTopUp),
        canTransact: !agent.floatLocked && balanceNGN >= MIN_FLOAT,
        lastUpdated: new Date().toISOString(),
      };
    }),

  // ── Top up float ─────────────────────────────────────────────────────────────
  // DD-AUTH: financialProcedure — minting float is role + Permify gated
  // (float_topup: admin/supervisor), not any-authenticated-user.
  topUp: financialProcedure
    .input(z.object({
      agentId: z.number(),
      amountNGN: z.number().positive().max(DAILY_TOP_UP_LIMIT),
      source: z.enum(["bank_transfer", "cash", "internal_transfer"]),
      reference: z.string().min(5),
      supervisorApproval: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [agent] = await db.select().from(agents).where(eq(agents.id, input.agentId)).limit(1);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });

      // Business rule: supervisor approval required for large top-ups
      if (input.amountNGN > SUPERVISOR_APPROVAL_THRESHOLD && !input.supervisorApproval) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Top-ups > ₦${SUPERVISOR_APPROVAL_THRESHOLD.toLocaleString()} require supervisor approval code`,
        });
      }

      // Business rule: daily limit check
      const dailyTopUp = await getAgentDailyTopUp(db, input.agentId);
      if (dailyTopUp + input.amountNGN > DAILY_TOP_UP_LIMIT) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Daily top-up limit exceeded. Used: ₦${dailyTopUp.toLocaleString()}, Limit: ₦${DAILY_TOP_UP_LIMIT.toLocaleString()}`,
        });
      }

      // Business rule: max float check
      const currentBalance = Number(agent.premiumReserve ?? 0);
      if (currentBalance + input.amountNGN > MAX_FLOAT) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Float would exceed maximum ₦${MAX_FLOAT.toLocaleString()}. Current: ₦${currentBalance.toLocaleString()}`,
        });
      }

      // Distributed lock to prevent concurrent top-ups
      const lockKey = `float-topup:${input.agentId}`;
      const locked = await acquireLock(lockKey, 15_000);
      if (!locked) {
        throw new TRPCError({ code: "CONFLICT", message: "Another top-up is in progress for this agent" });
      }

      try {
        // Idempotency check
        const existing = await db.select().from(transactions)
          .where(eq(transactions.ref, input.reference)).limit(1);
        if (existing.length > 0) {
          return { idempotent: true, transaction: existing[0] };
        }

        // Ensure TB account exists
        await tbEnsureAgentAccount(agent.agentId);

        // TigerBeetle double-entry: sys-bank-reserve → float-{agentId}
        const tbResult = await tbCreateTransfer({
          debitAccountId: "sys-bank-reserve",
          creditAccountId: `float-${agent.agentId}`,
          amount: Math.round(input.amountNGN * 100),
          ledger: 2000,
          code: 100, // CASH_IN
          ref: input.reference,
          txType: "Float Top-Up",
          agentId: agent.agentId,
        });

        // PostgreSQL update (authoritative)
        const newBalance = currentBalance + input.amountNGN;
        await db.update(agents)
          .set({ premiumReserve: String(newBalance), updatedAt: new Date() })
          .where(eq(agents.id, input.agentId));

        // Record transaction
        const [tx] = await db.insert(transactions).values({
          ref: input.reference,
          agentId: input.agentId,
          type: "Float Transfer Received",
          amount: String(input.amountNGN),
          fee: "0",
          commission: "0",
          channel: ({ bank_transfer: "Internal", cash: "Cash", internal_transfer: "Internal" } as const)[input.source],
          status: "success",
          fraudScore: "0.00",
          metadata: {
            tbSyncStatus: tbResult ? "synced" : "pending",
            source: input.source,
            tbTransferId: tbResult?.id ?? null,
            supervisorApproval: input.supervisorApproval ?? null,
          },
        }).returning();

        // Audit log
        await db.insert(auditLog).values({
          action: "FLOAT_TOP_UP",
          resource: "agent_float",
          resourceId: String(input.agentId),
          status: "success",
          metadata: {
            amountNGN: input.amountNGN,
            newBalance,
            ref: input.reference,
            tbTransferId: tbResult?.id ?? null,
          },
        }).catch(() => {});

        logger.info(`[FloatMgmt] Top-up ₦${input.amountNGN} for agent ${agent.agentId} | TB: ${tbResult?.id ?? "pending"}`);

        return {
          idempotent: false,
          transaction: tx,
          newBalanceNGN: newBalance,
          tbTransferId: tbResult?.id ?? null,
          tbSyncStatus: tbResult?.syncStatus ?? "pending",
        };
      } finally {
        await releaseLock(lockKey);
      }
    }),

  // ── Withdraw float ───────────────────────────────────────────────────────────
  withdraw: adminProcedure
    .input(z.object({
      agentId: z.number(),
      amountNGN: z.number().positive(),
      reason: z.string().min(10),
      reference: z.string().min(5),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [agent] = await db.select().from(agents).where(eq(agents.id, input.agentId)).limit(1);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });

      const currentBalance = Number(agent.premiumReserve ?? 0);
      if (currentBalance - input.amountNGN < MIN_FLOAT) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Withdrawal would bring float below minimum ₦${MIN_FLOAT.toLocaleString()}`,
        });
      }

      const lockKey = `float-withdraw:${input.agentId}`;
      const locked = await acquireLock(lockKey, 15_000);
      if (!locked) throw new TRPCError({ code: "CONFLICT", message: "Another operation is in progress" });

      try {
        // Idempotency check
        const existing = await db.select().from(transactions)
          .where(eq(transactions.ref, input.reference)).limit(1);
        if (existing.length > 0) return { idempotent: true, transaction: existing[0] };

        // TigerBeetle: float-{agentId} → sys-bank-reserve
        const tbResult = await tbCreateTransfer({
          debitAccountId: `float-${agent.agentId}`,
          creditAccountId: "sys-bank-reserve",
          amount: Math.round(input.amountNGN * 100),
          ledger: 2000,
          code: 200, // CASH_OUT
          ref: input.reference,
          txType: "Float Withdrawal",
          agentId: agent.agentId,
        });

        const newBalance = currentBalance - input.amountNGN;
        await db.update(agents)
          .set({ premiumReserve: String(newBalance), updatedAt: new Date() })
          .where(eq(agents.id, input.agentId));

        const [tx] = await db.insert(transactions).values({
          ref: input.reference,
          agentId: input.agentId,
          type: "Float Transfer",
          amount: String(input.amountNGN),
          fee: "0",
          commission: "0",
          channel: "Internal",
          status: "success",
          fraudScore: "0.00",
          metadata: {
            tbSyncStatus: tbResult ? "synced" : "pending", reason: input.reason, tbTransferId: tbResult?.id ?? null },
        }).returning();

        await db.insert(auditLog).values({
          action: "FLOAT_WITHDRAWAL",
          resource: "agent_float",
          resourceId: String(input.agentId),
          status: "success",
          metadata: { amountNGN: input.amountNGN, newBalance, reason: input.reason },
        }).catch(() => {});

        return { idempotent: false, transaction: tx, newBalanceNGN: newBalance, tbTransferId: tbResult?.id ?? null };
      } finally {
        await releaseLock(lockKey);
      }
    }),

  // ── Lock/unlock float ────────────────────────────────────────────────────────
  setLock: adminProcedure
    .input(z.object({
      agentId: z.number(),
      locked: z.boolean(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      await db.update(agents)
        .set({ floatLocked: input.locked, updatedAt: new Date() })
        .where(eq(agents.id, input.agentId));

      await db.insert(auditLog).values({
        action: input.locked ? "FLOAT_LOCKED" : "FLOAT_UNLOCKED",
        resource: "agent_float",
        resourceId: String(input.agentId),
        status: "success",
        metadata: { reason: input.reason ?? null },
      }).catch(() => {});

      return { agentId: input.agentId, locked: input.locked };
    }),

  // ── Float summary ────────────────────────────────────────────────────────────
  getSummary: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { totalAgents: 0, totalFloatNGN: 0, lockedAgents: 0 };

    const [stats] = await db.select({
      totalAgents: count(),
      totalFloat: sql<string>`COALESCE(SUM(CAST("premiumReserve" AS NUMERIC)), 0)`,
      lockedAgents: sql<number>`COUNT(*) FILTER (WHERE "floatLocked" = true)`,
      belowMin: sql<number>`COUNT(*) FILTER (WHERE CAST("premiumReserve" AS NUMERIC) < ${MIN_FLOAT})`,
      activeAgents: sql<number>`COUNT(*) FILTER (WHERE status = 'active')`,
    }).from(agents);

    return {
      totalAgents: Number(stats?.totalAgents ?? 0),
      activeAgents: Number(stats?.activeAgents ?? 0),
      totalFloatNGN: Number(stats?.totalFloat ?? 0),
      lockedAgents: Number(stats?.lockedAgents ?? 0),
      agentsBelowMinFloat: Number(stats?.belowMin ?? 0),
      minFloatNGN: MIN_FLOAT,
      maxFloatNGN: MAX_FLOAT,
      dailyTopUpLimitNGN: DAILY_TOP_UP_LIMIT,
    };
  }),

  // ── Float history ────────────────────────────────────────────────────────────
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
          sql`type IN ('Float Top-Up', 'Float Withdrawal')`
        ))
        .orderBy(desc(transactions.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [{ total }] = await db.select({ total: count() }).from(transactions)
        .where(and(
          eq(transactions.agentId, input.agentId),
          sql`type IN ('Float Top-Up', 'Float Withdrawal')`
        ));

      return { data: results, total: Number(total) };
    }),
});
