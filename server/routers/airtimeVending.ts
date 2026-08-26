/**
 * airtimeVending.ts — Airtime Vending Router
 * Full production implementation with TigerBeetle atomicity.
 * Business Rules (CBN/NCC):
 *   - Min: ₦50, Max: ₦50,000 per transaction
 *   - Supported networks: MTN, Glo, Airtel, 9mobile
 *   - Commission: 3% of face value (credited to agent float)
 *   - Daily limit per agent: ₦500,000
 *   - Idempotency via unique reference
 *
 * MOCKWARE FIX: No airtime provider API is wired in this service. Vending
 * now fails loudly when no provider is configured, and a vend is NEVER
 * recorded as synchronous success — the transaction is stored as
 * "pending" with providerStatus "pending_provider" until a real provider
 * fulfilment webhook settles it.
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, count, sql, and, gte } from "drizzle-orm";
import { z } from "zod";

import { transactions, agents, auditLog, type Transaction } from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  dispatchProviderOperation,
  type ProviderClientConfig,
} from "../lib/providerDispatch";
import { resolveProviderTx } from "../lib/providerResolution";
import { acquireLock, releaseLock } from "../lib/redisClient";
import { tbCreateTransfer, tbEnsureAgentAccount } from "../tbClient";

const NETWORKS = ["MTN", "Glo", "Airtel", "9mobile"] as const;
const MIN_AMOUNT = 50;
const MAX_AMOUNT = 50_000;
const DAILY_LIMIT = 500_000;
const COMMISSION_RATE = 0.03;

// Airtime provider integration is configured via environment; without it
// the vend cannot be fulfilled and must fail loudly.
function isAirtimeProviderConfigured(): boolean {
  return !!(
    process.env.AIRTIME_PROVIDER_URL ||
    process.env.AIRTIME_PROVIDER_API_KEY ||
    process.env.VTPASS_API_KEY ||
    process.env.RELOADLY_API_KEY
  );
}

// Real provider client. Only a configured base URL enables actual dispatch;
// legacy key-only configuration keeps the vend pending_provider (honest).
function airtimeProviderClient(): ProviderClientConfig | null {
  const baseUrl = process.env.AIRTIME_PROVIDER_URL;
  if (!baseUrl) return null;
  return {
    baseUrl,
    apiKey: process.env.AIRTIME_PROVIDER_API_KEY,
    timeoutMs: Number(process.env.AIRTIME_PROVIDER_TIMEOUT_MS ?? 10_000),
  };
}

/** Postgres unique-violation detection without a driver-specific import. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "23505"
  );
}

export const airtimeVendingRouter = router({
  vend: protectedProcedure
    .input(z.object({
      agentId: z.number(),
      network: z.enum(NETWORKS),
      phoneNumber: z.string().regex(/^(0|\+234)[789][01]\d{8}$/, "Invalid Nigerian phone number"),
      amountNGN: z.number().min(MIN_AMOUNT).max(MAX_AMOUNT),
      reference: z.string().min(5),
    }))
    .mutation(async ({ input }) => {
      if (!isAirtimeProviderConfigured()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Airtime provider not configured" });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Idempotency + unknown-outcome resolution: a retry with the same
      // reference NEVER re-dispatches; it resolves via provider status lookup.
      const existing = await db.select().from(transactions).where(eq(transactions.ref, input.reference)).limit(1);
      if (existing.length > 0) {
        const resolved = await resolveProviderTx({
          transaction: existing[0],
          client: airtimeProviderClient(),
          commissionOnCompletion: input.amountNGN * COMMISSION_RATE,
        });
        return {
          idempotent: true,
          transaction: resolved.transaction,
          status: (resolved.transaction.metadata as any)?.providerStatus ?? resolved.transaction.status,
          resolution: resolved.resolution,
        };
      }

      const [agent] = await db.select().from(agents).where(eq(agents.id, input.agentId)).limit(1);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
      if (!agent.isActive) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Agent not active" });
      if (agent.floatLocked) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Float locked" });

      const agentBalance = Number(agent.premiumReserve ?? 0);
      if (agentBalance < input.amountNGN) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Insufficient float. Available: ₦${agentBalance.toLocaleString()}` });
      }

      // Daily limit check
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const [{ dailyTotal }] = await db.select({
        dailyTotal: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
      }).from(transactions).where(and(
        eq(transactions.agentId, input.agentId),
        eq(transactions.type, "Airtime"),
        gte(transactions.createdAt, today),
        eq(transactions.status, "success")
      ));
      if (Number(dailyTotal ?? 0) + input.amountNGN > DAILY_LIMIT) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Daily airtime limit of ₦${DAILY_LIMIT.toLocaleString()} exceeded` });
      }

      const lockKey = `airtime:${input.agentId}:${input.reference}`;
      const locked = await acquireLock(lockKey, 15_000);
      if (!locked) throw new TRPCError({ code: "CONFLICT", message: "Transaction in progress" });

      try {
        // Commission is only earned once the provider fulfils the vend; it
        // is not credited at initiation time.
        const commission = 0;

        // INSERT-FIRST (F4/F5): the stable identity — a PENDING row keyed by
        // the unique `ref` — is persisted BEFORE any external side effect
        // (TB hold, provider dispatch). If the process dies after this point,
        // any retry resolves against this record instead of re-creating it.
        // A unique violation means a concurrent same-reference request won
        // the insert race — this request has NOT dispatched anything; it
        // resolves the winner's row via provider status lookup and returns
        // it idempotently.
        let tx: Transaction;
        try {
          const [inserted] = await db.insert(transactions).values({
            ref: input.reference,
            agentId: input.agentId,
            type: "Airtime",
            amount: String(input.amountNGN),
            fee: "0",
            commission: String(commission),
            customerPhone: input.phoneNumber,
            channel: "App",
            // Never synchronous success: fulfilment is confirmed asynchronously
            // by the airtime provider.
            status: "pending",
            fraudScore: "0.00",
            metadata: { tbSyncStatus: "pending",
              network: input.network,
              phoneNumber: input.phoneNumber,
              providerStatus: "pending_provider",
              tbTransferId: null,
            },
          }).returning();
          tx = inserted;
        } catch (err) {
          if (isUniqueViolation(err)) {
            const [winner] = await db.select().from(transactions).where(eq(transactions.ref, input.reference)).limit(1);
            if (winner) {
              const resolved = await resolveProviderTx({
                transaction: winner,
                client: airtimeProviderClient(),
                commissionOnCompletion: input.amountNGN * COMMISSION_RATE,
              });
              const winnerMeta = resolved.transaction.metadata as Record<string, unknown> | null;
              return {
                idempotent: true,
                transaction: resolved.transaction,
                status: (winnerMeta?.providerStatus as string | undefined) ?? resolved.transaction.status,
                resolution: resolved.resolution,
              };
            }
          }
          throw err;
        }

        // TigerBeetle: hold the vend amount against the agent float
        await tbEnsureAgentAccount(agent.agentId);
        const tbResult = await tbCreateTransfer({
          debitAccountId: `float-${agent.agentId}`,
          creditAccountId: `network-${input.network.toLowerCase()}`,
          amount: Math.round(input.amountNGN * 100),
          ledger: 2000,
          code: 200,
          ref: input.reference,
          txType: "Airtime",
          agentId: agent.agentId,
        });

        // Dispatch to the provider when a real base URL is configured. The
        // tri-state outcome is persisted honestly; "unknown" is NEVER
        // surfaced as success and is resolved later via status lookup. All
        // transitions carry an expected-state guard (`AND status='pending'`)
        // + row-count verification so a concurrently settled row is never
        // overwritten.
        const client = airtimeProviderClient();
        if (client) {
          const dispatch = await dispatchProviderOperation({
            ...client,
            path: "/vend",
            reference: input.reference,
            payload: {
              network: input.network,
              phoneNumber: input.phoneNumber,
              amountNGN: input.amountNGN,
            },
          });
          if (dispatch.outcome === "accepted") {
            const [updated] = await db.update(transactions).set({
              metadata: { ...(tx.metadata as object), tbSyncStatus: tbResult ? "synced" : "pending", tbTransferId: tbResult?.id ?? null, providerStatus: "submitted", providerRef: dispatch.providerRef ?? null },
              updatedAt: new Date(),
            }).where(and(eq(transactions.ref, input.reference), eq(transactions.status, "pending"))).returning();
            if (!updated) throw new TRPCError({ code: "CONFLICT", message: "Vend record transitioned concurrently — not overwriting" });
            logger.info(`[Airtime] ₦${input.amountNGN} ${input.network} to ${input.phoneNumber} | ref ${input.reference} submitted to provider`);
            return { idempotent: false, transaction: updated, status: "submitted", commission, tbTransferId: tbResult?.id ?? null };
          }
          if (dispatch.outcome === "rejected") {
            const [updated] = await db.update(transactions).set({
              status: "failed",
              failureReason: dispatch.reason ?? "provider rejected vend",
              metadata: { ...(tx.metadata as object), tbSyncStatus: tbResult ? "synced" : "pending", tbTransferId: tbResult?.id ?? null, providerStatus: "rejected", providerError: dispatch.reason ?? null },
              updatedAt: new Date(),
            }).where(and(eq(transactions.ref, input.reference), eq(transactions.status, "pending"))).returning();
            if (!updated) throw new TRPCError({ code: "CONFLICT", message: "Vend record transitioned concurrently — not overwriting" });
            logger.warn(`[Airtime] vend ${input.reference} rejected by provider: ${dispatch.reason}`);
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Airtime provider rejected the vend: ${dispatch.reason}` });
          }
          // Unknown outcome: stays pending, resolved via status lookup on
          // retry or by the reconciler. NO blind re-dispatch.
          const [updated] = await db.update(transactions).set({
            metadata: { ...(tx.metadata as object), tbSyncStatus: tbResult ? "synced" : "pending", tbTransferId: tbResult?.id ?? null, providerStatus: "unknown_outcome", providerError: dispatch.reason ?? null },
            updatedAt: new Date(),
          }).where(and(eq(transactions.ref, input.reference), eq(transactions.status, "pending"))).returning();
          if (!updated) throw new TRPCError({ code: "CONFLICT", message: "Vend record transitioned concurrently — not overwriting" });
          logger.error(`[Airtime] vend ${input.reference} outcome UNKNOWN (${dispatch.reason}) — held pending for status lookup, NOT re-sent`);
          return { idempotent: false, transaction: updated, status: "unknown_outcome", commission, tbTransferId: tbResult?.id ?? null };
        }

        // No dispatch URL: record the TB hold on the pending row (guarded).
        const [held] = await db.update(transactions).set({
          metadata: { ...(tx.metadata as object), tbSyncStatus: tbResult ? "synced" : "pending", tbTransferId: tbResult?.id ?? null },
          updatedAt: new Date(),
        }).where(and(eq(transactions.ref, input.reference), eq(transactions.status, "pending"))).returning();
        logger.info(`[Airtime] ₦${input.amountNGN} ${input.network} to ${input.phoneNumber} | agent ${agent.agentId} | status pending_provider | TB: ${tbResult?.id ?? "pending"}`);
        return { idempotent: false, transaction: held ?? tx, status: "pending_provider", commission, tbTransferId: tbResult?.id ?? null };
      } finally {
        await releaseLock(lockKey);
      }
    }),

  getHistory: protectedProcedure
    // F-12 (wave-4b): agentId was client-supplied — any caller could read
    // any agent's history. Session-scoped to the caller.
    .input(z.object({ type: z.string().default("Airtime"), limit: z.number().default(20), offset: z.number().default(0) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { data: [], total: 0 };
      // F-12 (wave-4b): tx_type has no "Data" value — data vending is not
      // representable. Airtime queries are real; data fails loud.
      if (input.type === "data") {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message: "data vending is not delivered (no data tx type)",
        });
      }
      const txnType = "Airtime" as const;
      const results = await db.select().from(transactions)
        .where(and(eq(transactions.agentId, ctx.user.id), eq(transactions.type, txnType)))
        .orderBy(desc(transactions.createdAt)).limit(input.limit).offset(input.offset);
      const [{ total }] = await db.select({ total: count() }).from(transactions)
        .where(and(eq(transactions.agentId, ctx.user.id), eq(transactions.type, txnType)));
      return { data: results, total: Number(total) };
    }),

  getSummary: protectedProcedure
    .input(z.object({ periodDays: z.number().default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { total: 0, volumeNGN: 0, commissionNGN: 0 };
      const since = new Date(Date.now() - input.periodDays * 86400000);
      const [stats] = await db.select({
        total: count(),
        volume: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
        commission: sql<string>`COALESCE(SUM(CAST(commission AS NUMERIC)), 0)`,
      }).from(transactions).where(and(eq(transactions.type, "Airtime"), gte(transactions.createdAt, since), eq(transactions.status, "success")));
      return { periodDays: input.periodDays, total: Number(stats?.total ?? 0), volumeNGN: Number(stats?.volume ?? 0), commissionNGN: Number(stats?.commission ?? 0) };
    }),
});
