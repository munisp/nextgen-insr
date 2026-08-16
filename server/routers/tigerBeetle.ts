/**
 * tigerBeetle.ts — TigerBeetle Ledger Router
 *
 * Exposes TigerBeetle sidecar operations via tRPC:
 *   - Account management (create, balance query)
 *   - Transfer operations (create, list, status)
 *   - Sync status monitoring
 *   - Reconciliation between PG and TB
 *
 * All fund movements use double-entry accounting:
 *   Debit = money leaving an account
 *   Credit = money entering an account
 *   Every transfer must balance: sum(debits) == sum(credits)
 */
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { tigerBeetleSyncLog, transactions, agents } from "../../drizzle/schema";
import { desc, eq, count, sql, and, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  tbCreateTransfer,
  tbEnsureAgentAccount,
  tbGetAgentBalance,
  tbGetSyncStatus,
  tbIsHealthy,
  type TBTransferRequest,
} from "../tbClient";
import { logger } from "../_core/logger";

// Ledger codes
const LEDGER = {
  AGENT_ACCOUNTS: 2000,
  INSURANCE_PREMIUMS: 3000,
  CLAIMS_PAYOUTS: 4000,
  COMMISSIONS: 5000,
  SETTLEMENTS: 6000,
};

// Transfer type codes
const TX_CODE = {
  CASH_IN: 100,
  CASH_OUT: 200,
  TRANSFER: 300,
  REVERSAL: 400,
  COMMISSION: 500,
  SETTLEMENT: 600,
  PREMIUM: 700,
  CLAIM_PAYOUT: 800,
  FEE: 900,
};

export const tigerBeetleRouter = router({
  // ── Health & Status ─────────────────────────────────────────────────────────
  health: protectedProcedure.query(async () => {
    const healthy = await tbIsHealthy();
    const syncStatus = healthy ? await tbGetSyncStatus() : null;
    return {
      healthy,
      syncStatus,
      sidecarUrl: process.env.TB_SIDECAR_URL ?? "http://localhost:7070",
    };
  }),

  getSyncStatus: protectedProcedure.query(async () => {
    const status = await tbGetSyncStatus();
    if (!status) {
      return { healthy: false, pending: 0, synced: 0, failed: 0, postgres: "disconnected" as const };
    }
    return { healthy: true, ...status };
  }),

  // ── Account Operations ───────────────────────────────────────────────────────
  ensureAgentAccount: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ input }) => {
      const created = await tbEnsureAgentAccount(input.agentId);
      return { success: created, agentId: input.agentId };
    }),

  getAgentBalance: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input }) => {
      const balance = await tbGetAgentBalance(input.agentId);
      if (!balance) {
        // Fall back to PostgreSQL float balance
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "DB unavailable" });
        const [agent] = await db.select({
          premiumReserve: agents.premiumReserve,
        }).from(agents).where(eq(agents.agentId, input.agentId)).limit(1);
        if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
        const balanceNGN = Number(agent.premiumReserve ?? 0);
        return { balanceNGN, balanceKobo: Math.round(balanceNGN * 100), source: "postgresql" };
      }
      return { ...balance, source: "tigerbeetle" };
    }),

  // ── Transfer Operations ──────────────────────────────────────────────────────
  createTransfer: adminProcedure
    .input(z.object({
      debitAccountId: z.string(),
      creditAccountId: z.string(),
      amountNGN: z.number().positive(),
      txType: z.enum(["cash_in", "cash_out", "transfer", "reversal", "commission", "settlement", "premium", "claim_payout", "fee"]),
      ref: z.string().optional(),
      agentId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const codeMap: Record<string, number> = {
        cash_in: TX_CODE.CASH_IN, cash_out: TX_CODE.CASH_OUT, transfer: TX_CODE.TRANSFER,
        reversal: TX_CODE.REVERSAL, commission: TX_CODE.COMMISSION, settlement: TX_CODE.SETTLEMENT,
        premium: TX_CODE.PREMIUM, claim_payout: TX_CODE.CLAIM_PAYOUT, fee: TX_CODE.FEE,
      };
      const result = await tbCreateTransfer({
        debitAccountId: input.debitAccountId,
        creditAccountId: input.creditAccountId,
        amount: Math.round(input.amountNGN * 100),
        ledger: LEDGER.AGENT_ACCOUNTS,
        code: codeMap[input.txType],
        ref: input.ref,
        txType: input.txType,
        agentId: input.agentId,
      });
      if (!result) {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "TigerBeetle sidecar unavailable" });
      }
      return result;
    }),

  // ── Sync Log ────────────────────────────────────────────────────────────────
  getSyncLog: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
      status: z.enum(["all", "pending", "synced", "failed"]).default("all"),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { data: [], total: 0 };

      const query = db.select().from(tigerBeetleSyncLog)
        .orderBy(desc(tigerBeetleSyncLog.id))
        .limit(input.limit)
        .offset(input.offset);

      const results = input.status === "all"
        ? await query
        : await query.where(eq(tigerBeetleSyncLog.status, input.status));

      const [{ total }] = await db.select({ total: count() }).from(tigerBeetleSyncLog);
      return { data: results, total: Number(total) };
    }),

  // ── Reconciliation ───────────────────────────────────────────────────────────
  reconcile: adminProcedure
    .input(z.object({
      agentId: z.string(),
      periodDays: z.number().min(1).max(90).default(1),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const since = new Date(Date.now() - input.periodDays * 86400000);

      // Get PG transaction totals
      const [pgStats] = await db.select({
        txCount: count(),
        totalAmount: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
        totalFees: sql<string>`COALESCE(SUM(CAST(fee AS NUMERIC)), 0)`,
      }).from(transactions)
        .where(and(
          eq(transactions.agentId, Number(input.agentId)),
          gte(transactions.createdAt, since),
          eq(transactions.status, "success")
        ));

      // Get TB balance
      const tbBalance = await tbGetAgentBalance(input.agentId);

      // Get PG float balance
      const [agent] = await db.select({ premiumReserve: agents.premiumReserve })
        .from(agents).where(eq(agents.agentId, input.agentId)).limit(1);

      const pgBalance = Number(agent?.premiumReserve ?? 0);
      const tbBalanceNGN = tbBalance?.balanceNGN ?? null;
      const discrepancy = tbBalanceNGN !== null ? Math.abs(pgBalance - tbBalanceNGN) : null;

      return {
        agentId: input.agentId,
        periodDays: input.periodDays,
        postgresql: {
          transactionCount: Number(pgStats?.txCount ?? 0),
          totalAmount: Number(pgStats?.totalAmount ?? 0),
          totalFees: Number(pgStats?.totalFees ?? 0),
          floatBalance: pgBalance,
        },
        tigerBeetle: tbBalance ? {
          balanceNGN: tbBalance.balanceNGN,
          balanceKobo: tbBalance.balanceKobo,
        } : null,
        reconciled: discrepancy !== null && discrepancy < 0.01,
        discrepancyNGN: discrepancy,
        reconciledAt: new Date().toISOString(),
      };
    }),

  // ── Pending Sync Retry ───────────────────────────────────────────────────────
  retryPendingSync: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const pending = await db.select().from(tigerBeetleSyncLog)
        .where(eq(tigerBeetleSyncLog.status, "pending"))
        .orderBy(tigerBeetleSyncLog.id)
        .limit(input.limit);

      let retried = 0, succeeded = 0, failed = 0;

      for (const entry of pending) {
        retried++;
        const result = await tbCreateTransfer({
          id: entry.transferId ?? undefined,
          debitAccountId: entry.debitAccountId ?? "sys-bank-reserve",
          creditAccountId: entry.creditAccountId ?? "sys-bank-reserve",
          amount: Number(entry.amount ?? 0),
          ledger: Number(entry.ledger ?? 2000),
          code: Number(entry.code ?? 300),
        });

        if (result) {
          await db.update(tigerBeetleSyncLog)
            .set({ status: "synced", syncedAt: new Date() })
            .where(eq(tigerBeetleSyncLog.id, entry.id));
          succeeded++;
        } else {
          await db.update(tigerBeetleSyncLog)
            .set({ retryCount: (entry.retryCount ?? 0) + 1 })
            .where(eq(tigerBeetleSyncLog.id, entry.id));
          failed++;
        }
      }

      return { retried, succeeded, failed, timestamp: new Date().toISOString() };
    }),

  // ── Analytics ───────────────────────────────────────────────────────────────
  getAnalytics: protectedProcedure
    .input(z.object({ periodDays: z.number().min(1).max(90).default(7) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { totalTransfers: 0, totalVolumeNGN: 0, syncRate: 0 };

      const since = new Date(Date.now() - input.periodDays * 86400000);

      const [stats] = await db.select({
        total: count(),
        synced: sql<number>`COUNT(*) FILTER (WHERE status = 'synced')`,
        pending: sql<number>`COUNT(*) FILTER (WHERE status = 'pending')`,
        failed: sql<number>`COUNT(*) FILTER (WHERE status = 'failed')`,
        totalKobo: sql<string>`COALESCE(SUM(CAST("amount" AS NUMERIC)), 0)`,
      }).from(tigerBeetleSyncLog)
        .where(gte(tigerBeetleSyncLog.createdAt, since));

      const total = Number(stats?.total ?? 0);
      const synced = Number(stats?.synced ?? 0);

      return {
        periodDays: input.periodDays,
        totalTransfers: total,
        syncedTransfers: synced,
        pendingTransfers: Number(stats?.pending ?? 0),
        failedTransfers: Number(stats?.failed ?? 0),
        syncRate: total > 0 ? Math.round((synced / total) * 10000) / 100 : 100,
        totalVolumeNGN: Number(stats?.totalKobo ?? 0) / 100,
      };
    }),
});
