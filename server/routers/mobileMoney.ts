/**
 * mobileMoney.ts — Mobile Money Operations Router
 * Full production: cash-in, cash-out, transfers via mobile money.
 * Business Rules: Min ₦100, Max ₦300K, Daily ₦1M, Commission 1.5%
 *
 * MOCKWARE FIX: No mobile-money provider (MoMo/Mojaloop) call is wired in
 * this service. Cash-in/cash-out fail loudly when no provider is
 * configured, and a transaction is NEVER recorded as synchronous success —
 * it is stored as "pending" with providerStatus "pending_provider" until
 * the provider confirms settlement.
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, count, sql, and, gte } from "drizzle-orm";
import { z } from "zod";

import { transactions, agents, customers, auditLog } from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { permifyCheck } from "../_core/permify";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { fluvioProduce } from "../fluvio";
import { publishEvent, type KafkaTopic } from "../kafkaClient";
import {
  dispatchProviderOperation,
  type ProviderClientConfig,
} from "../lib/providerDispatch";
import { resolveProviderTx } from "../lib/providerResolution";
import { acquireLock, releaseLock } from "../lib/redisClient";
import { cacheSet } from "../redisClient";
import { tbCreateTransfer, tbEnsureAgentAccount } from "../tbClient";

const PROVIDERS = ["MTN MoMo", "Airtel Money", "Glo Xtra", "9PSB"] as const;
const MIN_AMOUNT = 100, MAX_AMOUNT = 300_000, DAILY_LIMIT = 1_000_000;
const CASH_IN_COMMISSION = 0.015, CASH_OUT_COMMISSION = 0.015;

// Mobile-money provider integration is configured via environment; without
// it a cash-in/cash-out cannot be fulfilled and must fail loudly.
function isMobileMoneyProviderConfigured(): boolean {
  return !!(
    process.env.MOBILE_MONEY_PROVIDER_URL ||
    process.env.MOBILE_MONEY_PROVIDER_API_KEY ||
    process.env.MOJALOOP_ENDPOINT ||
    process.env.MOJALOOP_URL
  );
}

// Real provider client. Only a configured base URL enables actual dispatch;
// key-only / Mojaloop-endpoint configuration keeps the op pending_provider.
function mobileMoneyProviderClient(): ProviderClientConfig | null {
  const baseUrl = process.env.MOBILE_MONEY_PROVIDER_URL;
  if (!baseUrl) return null;
  return {
    baseUrl,
    apiKey: process.env.MOBILE_MONEY_PROVIDER_API_KEY,
    timeoutMs: Number(process.env.MOBILE_MONEY_PROVIDER_TIMEOUT_MS ?? 10_000),
  };
}

// Dispatch a cash-in/cash-out to the configured provider and persist the
// tri-state outcome honestly. "unknown" is NEVER surfaced as success; it is
// resolved later via status lookup (retry path or reconciler).
async function dispatchMobileMoneyOp(opts: {
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  tx: { ref: string; metadata: unknown };
  kind: "cashin" | "cashout";
  payload: Record<string, unknown>;
}): Promise<{ status: "submitted" | "unknown_outcome"; transaction: unknown }> {
  const client = mobileMoneyProviderClient()!;
  const dispatch = await dispatchProviderOperation({
    ...client,
    path: `/${opts.kind}`,
    reference: opts.tx.ref,
    payload: opts.payload,
  });
  if (dispatch.outcome === "accepted") {
    const [updated] = await opts.db.update(transactions).set({
      metadata: { ...(opts.tx.metadata as object), providerStatus: "submitted", providerRef: dispatch.providerRef ?? null },
      updatedAt: new Date(),
    }).where(eq(transactions.ref, opts.tx.ref)).returning();
    return { status: "submitted", transaction: updated ?? opts.tx };
  }
  if (dispatch.outcome === "rejected") {
    await opts.db.update(transactions).set({
      status: "failed",
      failureReason: dispatch.reason ?? "provider rejected operation",
      metadata: { ...(opts.tx.metadata as object), providerStatus: "rejected", providerError: dispatch.reason ?? null },
      updatedAt: new Date(),
    }).where(eq(transactions.ref, opts.tx.ref));
    logger.warn(`[MobileMoney] ${opts.tx.ref} rejected by provider: ${dispatch.reason}`);
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Mobile money provider rejected the operation: ${dispatch.reason}` });
  }
  const [updated] = await opts.db.update(transactions).set({
    metadata: { ...(opts.tx.metadata as object), providerStatus: "unknown_outcome", providerError: dispatch.reason ?? null },
    updatedAt: new Date(),
  }).where(eq(transactions.ref, opts.tx.ref)).returning();
  logger.error(`[MobileMoney] ${opts.tx.ref} outcome UNKNOWN (${dispatch.reason}) — held pending for status lookup, NOT re-sent`);
  return { status: "unknown_outcome", transaction: updated ?? opts.tx };
}

export const mobileMoneyRouter = router({
  cashIn: protectedProcedure
    .input(z.object({
      agentId: z.number(), provider: z.enum(PROVIDERS),
      customerPhone: z.string(), amountNGN: z.number().min(MIN_AMOUNT).max(MAX_AMOUNT),
      reference: z.string().min(5), customerName: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      if (!isMobileMoneyProviderConfigured()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Mobile money provider not configured" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      // Idempotency + unknown-outcome resolution via provider status lookup.
      const existing = await db.select().from(transactions).where(eq(transactions.ref, input.reference)).limit(1);
      if (existing.length > 0) {
        const resolved = await resolveProviderTx({
          transaction: existing[0],
          client: mobileMoneyProviderClient(),
          commissionOnCompletion: input.amountNGN * CASH_IN_COMMISSION,
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
      if (!agent.isActive || agent.floatLocked) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Agent not available" });
      // Sprint 44 wiring (F-12): domain-level authz before any funds move
      // (fail-closed unless the insecure PERMIFY_FAIL_OPEN opt-in is set).
      const allowed = await permifyCheck({
        subjectType: "user", subjectId: agent.agentId,
        entityType: "mobileMoney", entityId: input.provider,
        permission: "execute",
      });
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Agent is not authorized for mobile money operations" });
      const lockKey = `mm-cashin:${input.agentId}:${input.reference}`;
      const locked = await acquireLock(lockKey, 15_000);
      if (!locked) throw new TRPCError({ code: "CONFLICT", message: "Transaction in progress" });
      try {
        await tbEnsureAgentAccount(agent.agentId);
        // Commission is only earned once the provider confirms settlement;
        // it is not credited at initiation time.
        const commission = 0;
        const tbResult = await tbCreateTransfer({
          debitAccountId: "sys-bank-reserve", creditAccountId: `float-${agent.agentId}`,
          amount: Math.round(input.amountNGN * 100), ledger: 2000, code: 100,
          ref: input.reference, txType: "Mobile Money Cash-In", agentId: agent.agentId,
        });
        const [tx] = await db.insert(transactions).values({
          ref: input.reference, agentId: input.agentId, type: "Cash In",
          amount: String(input.amountNGN), fee: "0", commission: String(commission),
          customerPhone: input.customerPhone, customerName: input.customerName ?? null,
          // Never synchronous success: settlement is confirmed asynchronously
          // by the mobile-money provider.
          channel: "App", status: "pending", fraudScore: "0.00",
          metadata: { provider: input.provider, providerStatus: "pending_provider", tbTransferId: tbResult?.id ?? null, tbSyncStatus: tbResult ? "synced" : "pending" },
        }).returning();
        // Sprint 44 wiring (F-12): event fan-out + status cache, best-effort
        // AFTER the pending transaction row is durable.
        try {
        await publishEvent("pos.mobilemoney" as KafkaTopic, "system", {
          event: "mobilemoney.cashin.initiated", reference: input.reference,
          provider: input.provider, amountNGN: input.amountNGN, agentId: agent.agentId,
        });
        await fluvioProduce("pos.mobilemoney", {
          value: JSON.stringify({ event: "mobilemoney.cashin.initiated", reference: input.reference, provider: input.provider, amountNGN: input.amountNGN }),
        });
        await cacheSet(`tx:status:${input.reference}`, "pending_provider", 300);
        } catch (e) {
          logger.warn(`[MobileMoney] post-commit eventing degraded (tx is durable): ${e instanceof Error ? e.message : String(e)}`);
        }
        if (mobileMoneyProviderClient()) {
          let dispatched;
          try {
            dispatched = await dispatchMobileMoneyOp({
              db, tx, kind: "cashin",
            payload: { provider: input.provider, customerPhone: input.customerPhone, amountNGN: input.amountNGN },
          });
          return { idempotent: false, transaction: dispatched.transaction, status: dispatched.status, commission, tbTransferId: tbResult?.id ?? null };
          } catch (e) {
            // Fail-loud: the pending tx row is durable; retry with the same
            // reference resolves via the provider status lookup (idempotent).
            logger.error(`[MobileMoney] Cash-In provider dispatch failed (fail-closed): ${e instanceof Error ? e.message : String(e)}`);
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Mobile money dispatch failed: ${e instanceof Error ? e.message : "unknown error"}` });
          }
        }
        logger.info(`[MobileMoney] Cash-In ₦${input.amountNGN} via ${input.provider} | agent ${agent.agentId} | status pending_provider`);
        return { idempotent: false, transaction: tx, status: "pending_provider", commission, tbTransferId: tbResult?.id ?? null };
      } finally { await releaseLock(lockKey); }
    }),

  cashOut: protectedProcedure
    .input(z.object({
      agentId: z.number(), provider: z.enum(PROVIDERS),
      customerPhone: z.string(), amountNGN: z.number().min(MIN_AMOUNT).max(MAX_AMOUNT),
      reference: z.string().min(5), customerName: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      if (!isMobileMoneyProviderConfigured()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Mobile money provider not configured" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      // Idempotency + unknown-outcome resolution via provider status lookup.
      const existing = await db.select().from(transactions).where(eq(transactions.ref, input.reference)).limit(1);
      if (existing.length > 0) {
        const resolved = await resolveProviderTx({
          transaction: existing[0],
          client: mobileMoneyProviderClient(),
          commissionOnCompletion: input.amountNGN * CASH_OUT_COMMISSION,
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
      if (!agent.isActive || agent.floatLocked) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Agent not available" });
      const agentBalance = Number(agent.premiumReserve ?? 0);
      if (agentBalance < input.amountNGN + 5000) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Insufficient float. Available: ₦${(agentBalance - 5000).toLocaleString()}` });
      // Sprint 44 wiring (F-12): domain-level authz before any funds move.
      const allowed = await permifyCheck({
        subjectType: "user", subjectId: agent.agentId,
        entityType: "mobileMoney", entityId: input.provider,
        permission: "execute",
      });
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Agent is not authorized for mobile money operations" });
      const lockKey = `mm-cashout:${input.agentId}:${input.reference}`;
      const locked = await acquireLock(lockKey, 15_000);
      if (!locked) throw new TRPCError({ code: "CONFLICT", message: "Transaction in progress" });
      try {
        await tbEnsureAgentAccount(agent.agentId);
        // Commission is only earned once the provider confirms settlement;
        // it is not credited at initiation time.
        const commission = 0;
        const tbResult = await tbCreateTransfer({
          debitAccountId: `float-${agent.agentId}`, creditAccountId: "sys-bank-reserve",
          amount: Math.round(input.amountNGN * 100), ledger: 2000, code: 200,
          ref: input.reference, txType: "Mobile Money Cash-Out", agentId: agent.agentId,
        });
        const [tx] = await db.insert(transactions).values({
          ref: input.reference, agentId: input.agentId, type: "Cash Out",
          amount: String(input.amountNGN), fee: "0", commission: String(commission),
          customerPhone: input.customerPhone, customerName: input.customerName ?? null,
          // Never synchronous success: settlement is confirmed asynchronously
          // by the mobile-money provider.
          channel: "App", status: "pending", fraudScore: "0.00",
          metadata: { provider: input.provider, providerStatus: "pending_provider", tbTransferId: tbResult?.id ?? null, tbSyncStatus: tbResult ? "synced" : "pending" },
        }).returning();
        // Sprint 44 wiring (F-12): event fan-out + status cache, best-effort
        // AFTER the pending transaction row is durable.
        try {
        await publishEvent("pos.mobilemoney" as KafkaTopic, "system", {
          event: "mobilemoney.cashout.initiated", reference: input.reference,
          provider: input.provider, amountNGN: input.amountNGN, agentId: agent.agentId,
        });
        await fluvioProduce("pos.mobilemoney", {
          value: JSON.stringify({ event: "mobilemoney.cashout.initiated", reference: input.reference, provider: input.provider, amountNGN: input.amountNGN }),
        });
        await cacheSet(`tx:status:${input.reference}`, "pending_provider", 300);
        } catch (e) {
          logger.warn(`[MobileMoney] post-commit eventing degraded (tx is durable): ${e instanceof Error ? e.message : String(e)}`);
        }
        if (mobileMoneyProviderClient()) {
          let dispatched;
          try {
            dispatched = await dispatchMobileMoneyOp({
              db, tx, kind: "cashout",
            payload: { provider: input.provider, customerPhone: input.customerPhone, amountNGN: input.amountNGN },
          });
          return { idempotent: false, transaction: dispatched.transaction, status: dispatched.status, commission, tbTransferId: tbResult?.id ?? null };
          } catch (e) {
            // Fail-loud: the pending tx row is durable; retry with the same
            // reference resolves via the provider status lookup (idempotent).
            logger.error(`[MobileMoney] Cash-Out provider dispatch failed (fail-closed): ${e instanceof Error ? e.message : String(e)}`);
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Mobile money dispatch failed: ${e instanceof Error ? e.message : "unknown error"}` });
          }
        }
        logger.info(`[MobileMoney] Cash-Out ₦${input.amountNGN} via ${input.provider} | agent ${agent.agentId} | status pending_provider`);
        return { idempotent: false, transaction: tx, status: "pending_provider", commission, tbTransferId: tbResult?.id ?? null };
      } finally { await releaseLock(lockKey); }
    }),

  getProviders: protectedProcedure.query(() => ({
    providers: PROVIDERS.map(p => ({ name: p, cashInCommission: CASH_IN_COMMISSION, cashOutCommission: CASH_OUT_COMMISSION })),
    limits: { minAmountNGN: MIN_AMOUNT, maxAmountNGN: MAX_AMOUNT, dailyLimitNGN: DAILY_LIMIT },
  })),

  // F-12: the delivered client (MobileMoneyPage) calls providers/wallets/
  // transactions/analytics — these procedures were missing (genuine API
  // defect). All four are backed by real delivered data: the PROVIDERS
  // registry + provider configuration state, the customers wallet table,
  // and mobile-money transactions (metadata.provider discriminator).
  providers: protectedProcedure.query(() => ({
    providers: PROVIDERS.map((p, i) => ({
      id: `mm-provider-${i + 1}`,
      name: p,
      type: "mobile_money",
      currency: "NGN",
      // Honest status: a provider can only fulfil operations when the
      // provider integration is configured (see cashIn/cashOut fail-loud).
      status: isMobileMoneyProviderConfigured() ? "active" : "inactive",
      cashInCommission: CASH_IN_COMMISSION,
      cashOutCommission: CASH_OUT_COMMISSION,
    })),
    limits: { minAmountNGN: MIN_AMOUNT, maxAmountNGN: MAX_AMOUNT, dailyLimitNGN: DAILY_LIMIT },
  })),

  wallets: protectedProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          limit: z.number().min(1).max(100).default(20),
          offset: z.number().min(0).default(0),
        })
        .default({})
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { wallets: [], total: 0 };
      const conditions = [];
      if (input.search) {
        const like = `%${input.search}%`;
        conditions.push(
          sql`(${customers.phone} ILIKE ${like} OR ${customers.firstName} ILIKE ${like} OR ${customers.lastName} ILIKE ${like})`
        );
      }
      const where = conditions.length ? and(...conditions) : undefined;
      const rows = await db
        .select()
        .from(customers)
        .where(where)
        .orderBy(desc(customers.updatedAt))
        .limit(input.limit)
        .offset(input.offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(customers)
        .where(where);
      // Provider attribution from real usage: the most recent mobile-money
      // provider each phone transacted with (null when never used).
      const recentMm = await db
        .select({
          customerPhone: transactions.customerPhone,
          provider: sql<string>`${transactions.metadata}->>'provider'`,
        })
        .from(transactions)
        .where(sql`${transactions.metadata}->>'provider' IS NOT NULL`)
        .orderBy(desc(transactions.createdAt))
        .limit(500);
      const providerByPhone = new Map<string, string>();
      for (const r of recentMm) {
        if (r.customerPhone && !providerByPhone.has(r.customerPhone)) {
          providerByPhone.set(r.customerPhone, r.provider);
        }
      }
      const wallets = rows.map(c => ({
        id: `WLT-${c.id}`,
        provider: providerByPhone.get(c.phone) ?? null,
        phone: c.phone,
        holderName: `${c.firstName} ${c.lastName}`,
        balance: Number(c.walletBalance),
        status: c.status,
      }));
      return { wallets, total: Number(total) };
    }),

  transactions: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(100).default(20),
          offset: z.number().min(0).default(0),
        })
        .default({})
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { transactions: [], total: 0 };
      const mmFilter = sql`${transactions.metadata}->>'provider' IS NOT NULL`;
      const rows = await db
        .select()
        .from(transactions)
        .where(mmFilter)
        .orderBy(desc(transactions.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(transactions)
        .where(mmFilter);
      return {
        transactions: rows.map(t => ({
          id: t.ref,
          type: t.type,
          amount: Number(t.amount),
          provider:
            (t.metadata as { provider?: string } | null)?.provider ?? null,
          status: t.status,
          customerPhone: t.customerPhone ?? null,
          createdAt: t.createdAt,
        })),
        total: Number(total),
      };
    }),

  analytics: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return { totalTransactions: 0, totalVolume: 0, activeWallets: 0, totalFees: 0 };
    const [mmStats] = await db
      .select({
        total: count(),
        volume: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
        fees: sql<string>`COALESCE(SUM(CAST(fee AS NUMERIC)), 0)`,
      })
      .from(transactions)
      .where(sql`${transactions.metadata}->>'provider' IS NOT NULL`);
    const [{ walletCount }] = await db
      .select({ walletCount: count() })
      .from(customers)
      .where(sql`CAST(${customers.walletBalance} AS NUMERIC) > 0`);
    return {
      totalTransactions: Number(mmStats?.total ?? 0),
      totalVolume: Number(mmStats?.volume ?? 0),
      totalFees: Number(mmStats?.fees ?? 0),
      activeWallets: Number(walletCount ?? 0),
    };
  }),

  list: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20), offset: z.number().min(0).default(0) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { data: [], total: 0 };
      const results = await db.select().from(transactions)
        .where(sql`${transactions.metadata}->>'provider' IS NOT NULL`).orderBy(desc(transactions.createdAt)).limit(input.limit).offset(input.offset);
      const [{ total }] = await db.select({ total: count() }).from(transactions).where(sql`${transactions.metadata}->>'provider' IS NOT NULL`);
      return { data: results, total: Number(total) };
    }),

  getSummary: protectedProcedure
    .input(z.object({ periodDays: z.number().default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { total: 0, volumeNGN: 0 };
      const since = new Date(Date.now() - input.periodDays * 86400000);
      const [stats] = await db.select({ total: count(), volume: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)` })
        .from(transactions).where(and(sql`${transactions.metadata}->>'provider' IS NOT NULL`, gte(transactions.createdAt, since), eq(transactions.status, "success")));
      return { periodDays: input.periodDays, total: Number(stats?.total ?? 0), volumeNGN: Number(stats?.volume ?? 0) };
    }),
});
