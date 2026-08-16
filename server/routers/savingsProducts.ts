import { TRPCError } from "@trpc/server";
import { eq, desc, sql, count, sum, and } from "drizzle-orm";
import { z } from "zod";

import { transactions, auditLog } from "../../drizzle/schema";
import { permifyCheck } from "../_core/permify";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


// ── Middleware Integration (Sprint 44) ──────────────────────────────
import { fluvioProduce } from "../fluvio";
import { publishEvent, type KafkaTopic } from "../kafkaClient";
import { cacheSet, cacheGet } from "../redisClient";
import { tbCreateTransfer } from "../tbClient";

export const savingsProductsRouter = router({
  listAccounts: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(200).default(50),
          agentId: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const conditions = [];
        if (input?.agentId)
          conditions.push(eq(transactions.agentId, input.agentId));
        const rows = await db
          .select()
          .from(transactions)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(transactions.createdAt))
          .limit(input?.limit ?? 50);
        return { accounts: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  deposit: protectedProcedure
    .input(
      z.object({
        accountId: z.number(),
        amount: z.number().positive().max(10_000_000),
        agentId: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const ref = "SAV-" + crypto.randomUUID().slice(0, 12).toUpperCase();
        const [tx] = await db
          .insert(transactions)
          .values({
            agentId: input.agentId ?? input.accountId,
            amount: String(input.amount),
            type: "Cash In",
            status: "success",
            channel: "Cash",
            ref,
          })
          .returning();
        await db.insert(auditLog).values({
          action: "savings_deposit",
          resource: "savings_transactions",
          resourceId: String(tx.id),
          status: "success",
          metadata: {
            accountId: input.accountId,
            amount: input.amount,
            type: "deposit",
          },
        });
        return {
          id: tx.id,
          accountId: input.accountId,
          amount: input.amount,
          type: "deposit",
          ref,
          status: "success",
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
  withdraw: protectedProcedure
    .input(
      z.object({
        accountId: z.number(),
        amount: z.number().positive().max(5_000_000),
        agentId: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const ref = "SAV-W-" + crypto.randomUUID().slice(0, 12).toUpperCase();
        const [tx] = await db
          .insert(transactions)
          .values({
            agentId: input.agentId ?? input.accountId,
            amount: String(input.amount),
            type: "Cash Out",
            status: "success",
            channel: "Cash",
            ref,
          })
          .returning();
        await db.insert(auditLog).values({
          action: "savings_withdrawal",
          resource: "savings_transactions",
          resourceId: String(tx.id),
          status: "success",
          metadata: {
            accountId: input.accountId,
            amount: input.amount,
            type: "withdrawal",
          },
        });
        return {
          id: tx.id,
          accountId: input.accountId,
          amount: input.amount,
          type: "withdrawal",
          ref,
          status: "success",
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
  getStats: protectedProcedure.query(async () => {
    try {
      const db = (await getDb())!;
      const [totals] = await db
        .select({ total: count(), volume: sum(transactions.amount) })
        .from(transactions)
        .limit(100);
      return {
        totalAccounts: 0,
        totalDeposits: Number(totals.total),
        totalVolume: Number(totals.volume ?? 0),
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),

  // ── Sprint 28 domain procedures ──
  products: protectedProcedure.query(async () => {
    return {
      products: [
        {
          id: "SP-001",
          name: "Agent Savings",
          interestRate: 8,
          minBalance: 10000,
          status: "active",
        },
      ],
    };
  }),
  list: protectedProcedure.query(async () => {
    return {
      accounts: [
        {
          id: "SA-001",
          productId: "SP-001",
          agentId: "AGT-001",
          balance: 250000,
          status: "active",
        },
      ],
      total: 1,
    };
  }),
  analytics: protectedProcedure.query(async () => {
    return {
      totalAccounts: 200,
      activeAccounts: 180,
      totalBalance: 50000000,
      avgBalance: 250000,
      interestPaid: 4000000,
      totalDeposits: 750000000,
      totalInterestPaid: 4000000,
    };
  }),
});
