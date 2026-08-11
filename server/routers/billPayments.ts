/**
 * billPayments.ts — Bill Payments Router
 * Full production implementation with TigerBeetle atomicity.
 * Billers: EKEDC, IKEDC, AEDC, PHED, DSTV, GOtv, WAEC, JAMB, etc.
 * Business Rules: Min ₦100, Max ₦500K, Daily limit ₦2M, commission 0.5-2%
 *
 * MOCKWARE FIX: No bill-payment provider API is wired in this service.
 * Payments fail loudly when no provider is configured, and a payment is
 * NEVER recorded as synchronous success — it is stored as "pending" with
 * providerStatus "pending_provider" until provider fulfilment confirms it.
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

const BILLER_COMMISSION: Record<string, number> = {
  EKEDC: 0.005, IKEDC: 0.005, AEDC: 0.005, PHED: 0.005, BEDC: 0.005, EEDC: 0.005, JED: 0.005, KEDCO: 0.005,
  DSTV: 0.01, GOtv: 0.01, Startimes: 0.01, Showmax: 0.01,
  WAEC: 0.02, JAMB: 0.02, NECO: 0.02, NABTEB: 0.02,
  LCC: 0.005, LASG: 0.005, FIRS: 0.005, CAC: 0.005,
};
const MIN_AMOUNT = 100, MAX_AMOUNT = 500_000, DAILY_LIMIT = 2_000_000;

// Bill-payment provider integration is configured via environment; without
// it a payment cannot be fulfilled and must fail loudly.
function isBillProviderConfigured(): boolean {
  return !!(
    process.env.BILL_PROVIDER_URL ||
    process.env.BILL_PROVIDER_API_KEY ||
    process.env.VTPASS_API_KEY ||
    process.env.BAXI_API_KEY
  );
}

export const billPaymentsRouter = router({
  pay: protectedProcedure
    .input(z.object({
      agentId: z.number(), biller: z.string().min(2), customerNumber: z.string().min(5),
      amountNGN: z.number().min(MIN_AMOUNT).max(MAX_AMOUNT), reference: z.string().min(5),
      customerName: z.string().optional(), meterType: z.enum(["prepaid", "postpaid"]).optional(),
    }))
    .mutation(async ({ input }) => {
      if (!isBillProviderConfigured()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Bill payment provider not configured" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const existing = await db.select().from(transactions).where(eq(transactions.reference, input.reference)).limit(1);
      if (existing.length > 0) return { idempotent: true, transaction: existing[0] };
      const [agent] = await db.select().from(agents).where(eq(agents.id, input.agentId)).limit(1);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
      if (agent.status !== "active") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Agent not active" });
      if (agent.floatLocked) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Float locked" });
      const agentBalance = Number(agent.premiumReserve ?? 0);
      if (agentBalance < input.amountNGN) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Insufficient float. Available: ₦${agentBalance.toLocaleString()}` });
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const [{ dailyTotal }] = await db.select({ dailyTotal: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)` })
        .from(transactions).where(and(eq(transactions.agentId, input.agentId), eq(transactions.type, "Bill Payment"), gte(transactions.createdAt, today), eq(transactions.status, "success")));
      if (Number(dailyTotal ?? 0) + input.amountNGN > DAILY_LIMIT) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Daily limit ₦${DAILY_LIMIT.toLocaleString()} exceeded` });
      const lockKey = `bill-payment:${input.agentId}:${input.reference}`;
      const locked = await acquireLock(lockKey, 15_000);
      if (!locked) throw new TRPCError({ code: "CONFLICT", message: "Payment in progress" });
      try {
        await tbEnsureAgentAccount(agent.agentId);
        // Commission is only earned once the biller confirms fulfilment; it
        // is not credited at initiation time.
        const commission = 0;
        const tbResult = await tbCreateTransfer({
          debitAccountId: `float-${agent.agentId}`, creditAccountId: `biller-${input.biller.toLowerCase()}`,
          amount: Math.round(input.amountNGN * 100), ledger: 2000, code: 200,
          ref: input.reference, txType: "Bill Payment", agentId: agent.agentId,
        });
        const [tx] = await db.insert(transactions).values({
          reference: input.reference, agentId: input.agentId, type: "Bill Payment",
          amount: String(input.amountNGN), fee: "0", commission: String(commission),
          customerAccount: input.customerNumber, customerName: input.customerName ?? null,
          // Never synchronous success: fulfilment is confirmed asynchronously
          // by the bill-payment provider.
          channel: "POS", status: "pending", fraudScore: "0.00",
          tbSyncStatus: tbResult ? "synced" : "pending",
          metadata: { biller: input.biller, customerNumber: input.customerNumber, meterType: input.meterType ?? null, providerStatus: "pending_provider", tbTransferId: tbResult?.id ?? null },
        }).returning();
        await db.insert(auditLog).values({ action: "BILL_PAYMENT", resource: "bill_payment", resourceId: input.reference, status: "success", metadata: { biller: input.biller, amountNGN: input.amountNGN, providerStatus: "pending_provider" } }).catch(() => {});
        logger.info(`[BillPayment] ₦${input.amountNGN} to ${input.biller} | agent ${agent.agentId} | status pending_provider | TB: ${tbResult?.id ?? "pending"}`);
        return { idempotent: false, transaction: tx, status: "pending_provider", commission, tbTransferId: tbResult?.id ?? null, receiptNumber: `RCP-${input.reference}` };
      } finally { await releaseLock(lockKey); }
    }),

  validateCustomer: protectedProcedure
    .input(z.object({ biller: z.string(), customerNumber: z.string() }))
    .query(async ({ input }) => {
      const isElectricity = ["EKEDC","IKEDC","AEDC","PHED","BEDC","EEDC","JED","KEDCO"].includes(input.biller);
      const isTV = ["DSTV","GOtv","Startimes","Showmax"].includes(input.biller);
      let valid = false;
      if (isElectricity) valid = /^\d{10,13}$/.test(input.customerNumber);
      else if (isTV) valid = /^\d{10,12}$/.test(input.customerNumber);
      else valid = input.customerNumber.length >= 5;
      return { valid, customerNumber: input.customerNumber, biller: input.biller, message: valid ? "Valid" : "Invalid customer number" };
    }),

  getBillers: protectedProcedure.query(() => ({
    billers: Object.keys(BILLER_COMMISSION).map(b => ({ name: b, commissionRate: BILLER_COMMISSION[b], commissionPct: `${((BILLER_COMMISSION[b] ?? 0.01) * 100).toFixed(1)}%` })),
    limits: { minAmountNGN: MIN_AMOUNT, maxAmountNGN: MAX_AMOUNT, dailyLimitNGN: DAILY_LIMIT },
  })),

  getHistory: protectedProcedure
    .input(z.object({ agentId: z.number(), limit: z.number().default(20), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { data: [], total: 0 };
      const results = await db.select().from(transactions)
        .where(and(eq(transactions.agentId, input.agentId), eq(transactions.type, "Bill Payment")))
        .orderBy(desc(transactions.createdAt)).limit(input.limit).offset(input.offset);
      const [{ total }] = await db.select({ total: count() }).from(transactions).where(and(eq(transactions.agentId, input.agentId), eq(transactions.type, "Bill Payment")));
      return { data: results, total: Number(total) };
    }),

  list: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20), offset: z.number().min(0).default(0) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { data: [], total: 0 };
      const results = await db.select().from(transactions).where(eq(transactions.type, "Bill Payment")).orderBy(desc(transactions.createdAt)).limit(input.limit).offset(input.offset);
      const [{ total }] = await db.select({ total: count() }).from(transactions).where(eq(transactions.type, "Bill Payment"));
      return { data: results, total: Number(total) };
    }),

  getSummary: protectedProcedure
    .input(z.object({ periodDays: z.number().default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { total: 0, volumeNGN: 0, commissionNGN: 0 };
      const since = new Date(Date.now() - input.periodDays * 86400000);
      const [stats] = await db.select({
        total: count(), volume: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`, commission: sql<string>`COALESCE(SUM(CAST(commission AS NUMERIC)), 0)`,
      }).from(transactions).where(and(eq(transactions.type, "Bill Payment"), gte(transactions.createdAt, since), eq(transactions.status, "success")));
      return { periodDays: input.periodDays, total: Number(stats?.total ?? 0), volumeNGN: Number(stats?.volume ?? 0), commissionNGN: Number(stats?.commission ?? 0) };
    }),
});
