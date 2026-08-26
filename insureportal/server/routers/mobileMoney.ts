/**
 * Mobile Money Integration — Mojaloop connector for P2P transfers,
 * premium collection/claim payout via agents, wallet management, and provider interop.
 *
 * Middleware: Mojaloop (ILP connector), Kafka (transfer events), Redis (session cache),
 * PostgreSQL (wallet persistence), TigerBeetle (double-entry ledger),
 * Go Mojaloop connector (port 8143)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, writeAuditLog } from "../db";
import { transactions, agents } from "@schema";
import { eq, desc, and, sql, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getAgentFromCookie } from "../middleware/agentAuth";

// ── Middleware Integration (Sprint 44) ──────────────────────────────
import { publishEvent, type KafkaTopic } from "../kafkaClient";
import { cacheSet, cacheGet } from "../redisClient";
import { tbCreateTransfer } from "../tbClient";
import { fluvioProduce } from "../fluvio";
import { permifyCheck } from "../_core/permify";

const MM_PROVIDERS = [
  { code: "OPAY", name: "OPay", active: true },
  { code: "PALMPAY", name: "PalmPay", active: true },
  { code: "MONIEPOINT", name: "Moniepoint", active: true },
  { code: "KUDA", name: "Kuda", active: true },
  { code: "PAGA", name: "Paga", active: true },
];

const FEE_TIERS = [
  { min: 0, max: 5000, fee: 10 },
  { min: 5001, max: 50000, fee: 25 },
  { min: 50001, max: 500000, fee: 50 },
  { min: 500001, max: 5000000, fee: 100 },
];

function calculateFee(amount: number): number {
  const tier = FEE_TIERS.find(t => amount >= t.min && amount <= t.max);
  return tier?.fee ?? 100;
}

export const mobileMoneyRouter = router({
  sendMoney: protectedProcedure
    .input(
      z.object({
        senderPhone: z.string().min(11).max(14),
        recipientPhone: z.string().min(11).max(14),
        amount: z.number().positive().max(5_000_000),
        currency: z.string().default("NGN"),
        narration: z.string().max(256).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });

        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [agent] = await db
          .select({ premiumReserve: agents.premiumReserve })
          .from(agents)
          .where(eq(agents.id, session.id))
          .limit(1);
        if (!agent || Number(agent.premiumReserve) < input.amount)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Insufficient premium reserve",
          });

        const fee = calculateFee(input.amount);
        const commission = Math.round(fee * 0.3);
        const ref = `MOM-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;

        const [tx] = await db
          .insert(transactions)
          .values({
            ref,
            agentId: session.id,
            type: "Transfer",
            amount: String(input.amount),
            fee: String(fee),
            commission: String(commission),
            customerPhone: input.recipientPhone,
            status: "success",
            channel: "App",
            currency: input.currency,
            metadata: {
              senderPhone: input.senderPhone,
              narration: input.narration,
              channel: "mobile_money",
            },
          })
          .returning();

        await db
          .update(agents)
          .set({
            premiumReserve: sql`CAST(${agents.premiumReserve} AS numeric) - ${String(input.amount + fee)}`,
            // commission: sql`CAST(${agents.commissionBalance} AS numeric) + ${String(commission)}`, // removed: not in schema
          })
          .where(eq(agents.id, session.id));

        await writeAuditLog({
          agentId: session.id,
          action: "MOBILE_MONEY_SENT",
          resource: "mobile_money",
          resourceId: ref,
          status: "success",
          metadata: {
            amount: input.amount,
            fee,
            senderPhone: input.senderPhone,
            recipientPhone: input.recipientPhone,
          },
        });

        return {
          ref,
          amount: input.amount,
          fee,
          commission,
          status: "success",
          transactionId: tx.id,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  withdrawCash: protectedProcedure
    .input(
      z.object({
        phone: z.string().min(11).max(14),
        amount: z.number().positive().max(500_000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [agent] = await db
          .select({ premiumReserve: agents.premiumReserve })
          .from(agents)
          .where(eq(agents.id, session.id))
          .limit(1);
        if (!agent || Number(agent.premiumReserve) < input.amount)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Insufficient float to dispense cash",
          });

        const fee = calculateFee(input.amount);
        const commission = Math.round(fee * 0.4);
        const ref = `MCO-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;

        const [tx] = await db
          .insert(transactions)
          .values({
            ref,
            agentId: session.id,
            type: "Claim Payout",
            amount: String(input.amount),
            fee: String(fee),
            commission: String(commission),
            customerPhone: input.phone,
            status: "success",
            channel: "App",
            metadata: { channel: "mobile_money_claimPayout" },
          })
          .returning();

        await db
          .update(agents)
          .set({
            premiumReserve: sql`CAST(${agents.premiumReserve} AS numeric) - ${String(input.amount)}`,
            // commission: sql`CAST(${agents.commissionBalance} AS numeric) + ${String(commission)}`, // removed: not in schema
          })
          .where(eq(agents.id, session.id));

        await writeAuditLog({
          agentId: session.id,
          action: "MOBILE_MONEY_CASHOUT",
          resource: "mobile_money",
          resourceId: ref,
          status: "success",
          metadata: { amount: input.amount, fee, phone: input.phone },
        });

        return {
          ref,
          amount: input.amount,
          fee,
          commission,
          status: "success",
          transactionId: tx.id,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  depositCash: protectedProcedure
    .input(
      z.object({
        phone: z.string().min(11).max(14),
        amount: z.number().positive().max(5_000_000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const commission = Math.round(input.amount * 0.005);
        const ref = `MCI-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;

        const [tx] = await db
          .insert(transactions)
          .values({
            ref,
            agentId: session.id,
            type: "Premium Payment",
            amount: String(input.amount),
            fee: "0",
            commission: String(commission),
            customerPhone: input.phone,
            status: "success",
            channel: "App",
            metadata: { channel: "mobile_money_cashin" },
          })
          .returning();

        await db
          .update(agents)
          .set({
            premiumReserve: sql`CAST(${agents.premiumReserve} AS numeric) + ${String(input.amount)}`,
            // commission: sql`CAST(${agents.commissionBalance} AS numeric) + ${String(commission)}`, // removed: not in schema
          })
          .where(eq(agents.id, session.id));

        await writeAuditLog({
          agentId: session.id,
          action: "MOBILE_MONEY_CASHIN",
          resource: "mobile_money",
          resourceId: ref,
          status: "success",
          metadata: { amount: input.amount, phone: input.phone },
        });

        return {
          ref,
          amount: input.amount,
          fee: 0,
          commission,
          status: "success",
          transactionId: tx.id,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  checkBalance: protectedProcedure
    .input(z.object({ phone: z.string() }))
    .query(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

        const db = (await getDb())!;
        if (!db) return { phone: input.phone, balance: 0, currency: "NGN" };

        const [agent] = await db
          .select({ premiumReserve: agents.premiumReserve })
          .from(agents)
          .where(eq(agents.id, session.id))
          .limit(1);

        return {
          phone: input.phone,
          agentFloat: Number(agent?.premiumReserve ?? 0),
          currency: "NGN",
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  getTransactionHistory: protectedProcedure
    .input(
      z.object({ phone: z.string().optional(), limit: z.number().default(20) })
    )
    .query(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

        const db = (await getDb())!;
        if (!db) return { transactions: [], total: 0 };

        const conditions = [
          eq(transactions.agentId, session.id),
          sql`${transactions.metadata}->>'channel' LIKE 'mobile_money%'`,
        ];
        if (input.phone)
          conditions.push(eq(transactions.customerPhone, input.phone));

        const items = await db
          .select()
          .from(transactions)
          .where(and(...conditions))
          .orderBy(desc(transactions.createdAt))
          .limit(input.limit);

        return { transactions: items, total: items.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // DD-LEGACY: the read endpoints below previously returned hardcoded demo
  // records (fake wallets with ₦500,000 balances, fake completed
  // transactions, fabricated analytics). No provider/wallet registry exists
  // behind them, so they fail loud instead of fabricating.
  providers: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message:
        "mobileMoney.providers is not implemented: no mobile-money provider registry is integrated in this service.",
    });
  }),
  wallets: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message:
        "mobileMoney.wallets is not implemented: no wallet store is integrated in this service. Previously returned fabricated demo wallets.",
    });
  }),
  transactions: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message:
        "mobileMoney.transactions is not implemented: use getTransactionHistory, which queries real transaction records. Previously returned fabricated demo transactions.",
    });
  }),
  analytics: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message:
        "mobileMoney.analytics is not implemented: no analytics pipeline exists in this service. Previously returned fabricated figures.",
    });
  }),
});
