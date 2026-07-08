// @ts-check

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { eq, desc, and, sql, count, sum } from "drizzle-orm";
import { customers, transactions, auditLog } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

// ── Middleware Integration (Sprint 44) ──────────────────────────────
import { publishEvent, type KafkaTopic } from "../kafkaClient";
import { cacheSet, cacheGet } from "../redisClient";
import { tbCreateTransfer } from "../tbClient";
import { fluvioProduce } from "../fluvio";
import { permifyCheck } from "../_core/permify";

export const customerWalletSystemRouter = router({
  getBalance: protectedProcedure
    .input(z.object({ customerId: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [customer] = await db
          .select()
          .from(customers)
          .where(eq(customers.id, input.customerId))
          .limit(1);
        if (!customer) return null;
        const [credits] = await db
          .select({ total: sum(transactions.amount) })
          .from(transactions)
          .where(
            and(
              eq(transactions.agentId, input.customerId),
              eq(transactions.type, "Cash In")
            )
          )
          .limit(100);
        const [debits] = await db
          .select({ total: sum(transactions.amount) })
          .from(transactions)
          .where(
            and(
              eq(transactions.agentId, input.customerId),
              eq(transactions.type, "Cash Out")
            )
          )
          .limit(100);
        return {
          customerId: input.customerId,
          balance: Number(credits.total ?? 0) - Number(debits.total ?? 0),
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
  getTransactions: protectedProcedure
    .input(z.object({ customerId: z.number(), limit: z.number().default(50) }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(transactions)
          .where(eq(transactions.agentId, input.customerId))
          .orderBy(desc(transactions.createdAt))
          .limit(input.limit);
        return { transactions: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  topUp: protectedProcedure
    .input(
      z.object({
        customerId: z.number(),
        amount: z.number().positive(),
        source: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [tx] = await db
          .insert(transactions)
          .values({
            customerId: input.customerId,
            amount: String(input.amount),
            type: "Cash In",
            status: "success",
            channel: "App",
            reference: "TOP-" + crypto.randomUUID(),
          } as any)
          .returning();
        await db.insert(auditLog).values({
          action: "wallet_topup",
          resource: "transactions",
          resourceId: String(tx.id),
          status: "success",
          metadata: {
            customerId: input.customerId,
            amount: input.amount,
            source: input.source,
          },
        } as any);
        return { success: true, transactionId: tx.id, amount: input.amount };
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
      const [totalCustomers] = await db
        .select({ value: count() })
        .from(customers)
        .limit(100);
      const [totalVolume] = await db
        .select({ value: sum(transactions.amount) })
        .from(transactions)
        .limit(100);
      return {
        totalWallets: Number(totalCustomers.value),
        totalVolume: Number(totalVolume.value ?? 0),
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),
});
