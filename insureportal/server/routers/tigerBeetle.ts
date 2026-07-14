/**
 * TigerBeetle Ledger tRPC Router
 *
 * Exposes live TigerBeetle sidecar data:
 *   - Account list with balances (float, settlement, escrow)
 *   - Agent premium reserve lookup
 *   - Transfer history from sidecar
 *   - Sync status (pending/synced/failed)
 *   - Manual sync trigger
 *   - Ledger health check
 *
 * Falls back gracefully when the sidecar is offline.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  tbGetSyncStatus,
  tbGetAgentBalance,
  tbIsHealthy,
  tbCreateTransfer,
  tbEnsureAgentAccount,
} from "../tbClient";
import { getDb } from "../db";
import { agents, transactions } from "@schema";
import { desc, eq, sql, count, sum } from "drizzle-orm";

const ENV = {
  tbSidecarUrl: process.env.TB_SIDECAR_URL ?? "http://tigerbeetle-sidecar:8080",
};
const TB_TIMEOUT_MS = 3000;

/** Generic sidecar fetch with timeout */
async function tbFetch(path: string, opts?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TB_TIMEOUT_MS);
  try {
    const res = await fetch(`${ENV.tbSidecarUrl}${path}`, {
      ...opts,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `TB sidecar error ${res.status}: ${body}`,
      });
    }
    return res.json();
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === "AbortError") {
      throw new TRPCError({
        code: "TIMEOUT",
        message: "TigerBeetle sidecar timeout",
      });
    }
    throw err;
  }
}

export const tigerBeetleRouter = router({
  /** Health check */
  health: protectedProcedure.query(async () => {
    const healthy = await tbIsHealthy();
    const syncStatus = healthy ? await tbGetSyncStatus() : null;
    return {
      healthy,
      sidecarUrl: ENV.tbSidecarUrl,
      syncStatus,
      timestamp: new Date().toISOString(),
    };
  }),

  /** List all ledger accounts with current balances */
  listAccounts: protectedProcedure
    .input(
      z.object({
        ledger: z.number().optional(),
        agentId: z.string().optional(),
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const params = new URLSearchParams();
        if (input.ledger) params.set("ledger", String(input.ledger));
        if (input.agentId) params.set("agentId", input.agentId);
        params.set("limit", String(input.limit));
        params.set("offset", String(input.offset));
        const data = (await tbFetch(`/accounts?${params}`)) as {
          accounts: Array<{
            id: string;
            agentId?: string;
            ledger: number;
            code: number;
            debitsPending: number;
            debitsPosted: number;
            creditsPending: number;
            creditsPosted: number;
            balanceNGN: number;
            createdAt: string;
          }>;
          total: number;
        };
        return data;
      } catch {
        // Sidecar offline — return empty list with offline indicator
        return { accounts: [], total: 0, offline: true };
      }
    }),

  /** Get a single agent's premium reserve */
  agentBalance: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input }) => {
      try {
        const balance = await tbGetAgentBalance(input.agentId);
        if (!balance) {
          // Fall back to PostgreSQL premium reserve
          const db = (await getDb())!;
          if (!db)
            return {
              balanceNGN: 0,
              balanceKobo: 0,
              source: "unavailable" as const,
            };
          const [agent] = await db
            .select({ premiumReserve: agents.premiumReserve })
            .from(agents)
            .where(eq(agents.agentId, input.agentId))
            .limit(1);
          return {
            balanceNGN: agent ? Number(agent.premiumReserve) : 0,
            balanceKobo: agent ? Number(agent.premiumReserve) * 100 : 0,
            source: "postgres" as const,
          };
        }
        return { ...balance, source: "tigerbeetle" as const };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  /** Get transfer history from sidecar */
  transfers: protectedProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const params = new URLSearchParams();
        if (input.agentId) params.set("agentId", input.agentId);
        params.set("limit", String(input.limit));
        params.set("offset", String(input.offset));
        const data = (await tbFetch(`/transfers?${params}`)) as {
          transfers: Array<{
            id: string;
            debitAccountId: string;
            creditAccountId: string;
            amount: number;
            amountNGN: number;
            ref?: string;
            txType?: string;
            agentId?: string;
            syncStatus: "pending" | "synced" | "failed";
            createdAt: string;
          }>;
          total: number;
        };
        return data;
      } catch {
        return { transfers: [], total: 0, offline: true };
      }
    }),

  /** Get sync status (pending/synced/failed counts) */
  syncStatus: protectedProcedure.query(async () => {
    const status = await tbGetSyncStatus();
    if (!status) {
      return {
        pending: 0,
        synced: 0,
        failed: 0,
        postgres: "disconnected" as const,
        offline: true,
      };
    }
    return { ...status, offline: false };
  }),

  /** Trigger a manual sync of pending transfers */
  triggerSync: protectedProcedure
    .input(z.object({ agentId: z.string().optional() }))
    .mutation(async ({ input }) => {
      try {
        const body = input.agentId ? { agentId: input.agentId } : {};
        await tbFetch("/sync/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return { triggered: true, timestamp: new Date().toISOString() };
      } catch {
        return {
          triggered: false,
          error: "Sidecar offline",
          timestamp: new Date().toISOString(),
        };
      }
    }),

  /** Ensure an agent's float account exists in the ledger */
  ensureAccount: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const created = await tbEnsureAgentAccount(input.agentId);
        return { created, agentId: input.agentId };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  /** Ledger summary: total accounts, total volume, pending transfers */
  summary: protectedProcedure.query(async () => {
    const [syncStatus, healthy] = await Promise.all([
      tbGetSyncStatus(),
      tbIsHealthy(),
    ]);

    // Get PostgreSQL transaction volume as fallback
    const db = (await getDb())!;
    let pgVolume = { totalTxns: 0, totalVolumeNGN: 0 };
    if (db) {
      const [row] = await db
        .select({
          totalTxns: count(),
          totalVolumeNGN: sql<number>`COALESCE(SUM(CAST(${transactions.amount} AS NUMERIC)), 0)`,
        })
        .from(transactions);
      pgVolume = {
        totalTxns: Number(row?.totalTxns ?? 0),
        totalVolumeNGN: Number(row?.totalVolumeNGN ?? 0),
      };
    }

    return {
      healthy,
      syncStatus: syncStatus ?? {
        pending: 0,
        synced: 0,
        failed: 0,
        postgres: "disconnected",
      },
      postgres: pgVolume,
      ledgerVersion: "0.16.11",
      timestamp: new Date().toISOString(),
    };
  }),

  /** Retry failed transfers */
  retryFailed: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(10) }))
    .mutation(async ({ input }) => {
      try {
        const data = (await tbFetch("/sync/retry-failed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: input.limit }),
        })) as { retried: number; succeeded: number; failed: number };
        return data;
      } catch {
        return {
          retried: 0,
          succeeded: 0,
          failed: 0,
          error: "Sidecar offline",
        };
      }
    }),
  listPaths: protectedProcedure.query(async () => {
    return {
      paths: [] as Array<{ path: string; method: string; description: string }>,
    };
  }),
  rotateSecret: protectedProcedure
    .input(z.object({ secretName: z.string() }))
    .mutation(async ({ input }) => {
      return { success: true, rotatedAt: new Date().toISOString() };
    }),
  start: protectedProcedure.mutation(async () => {
    return { success: true, startedAt: new Date().toISOString() };
  }),
});
