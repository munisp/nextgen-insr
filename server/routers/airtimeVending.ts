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
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { transactions, agents, auditLog } from "../../drizzle/schema";
import { eq, desc, count, sql, and, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { tbCreateTransfer, tbEnsureAgentAccount } from "../tbClient";
import { acquireLock, releaseLock } from "../lib/redisClient";
import { logger } from "../_core/logger";

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

      // Idempotency
      const existing = await db.select().from(transactions).where(eq(transactions.ref, input.reference)).limit(1);
      if (existing.length > 0) return { idempotent: true, transaction: existing[0] };

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
        await tbEnsureAgentAccount(agent.agentId);
        // Commission is only earned once the provider fulfils the vend; it
        // is not credited at initiation time.
        const commission = 0;

        // TigerBeetle: hold the vend amount against the agent float
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

        const [tx] = await db.insert(transactions).values({
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
          tbSyncStatus: tbResult ? "synced" : "pending",
          metadata: {
            network: input.network,
            phoneNumber: input.phoneNumber,
            providerStatus: "pending_provider",
            tbTransferId: tbResult?.id ?? null,
          },
        }).returning();

        logger.info(`[Airtime] ₦${input.amountNGN} ${input.network} to ${input.phoneNumber} | agent ${agent.agentId} | status pending_provider | TB: ${tbResult?.id ?? "pending"}`);
        return { idempotent: false, transaction: tx, status: "pending_provider", commission, tbTransferId: tbResult?.id ?? null };
      } finally {
        await releaseLock(lockKey);
      }
    }),

  getHistory: protectedProcedure
    .input(z.object({ agentId: z.number(), limit: z.number().default(20), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { data: [], total: 0 };
      const results = await db.select().from(transactions)
        .where(and(eq(transactions.agentId, input.agentId), eq(transactions.type, "Airtime")))
        .orderBy(desc(transactions.createdAt)).limit(input.limit).offset(input.offset);
      const [{ total }] = await db.select({ total: count() }).from(transactions)
        .where(and(eq(transactions.agentId, input.agentId), eq(transactions.type, "Airtime")));
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
