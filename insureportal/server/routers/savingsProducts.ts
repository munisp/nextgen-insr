import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { eq, desc, sql, count, sum, and, asc } from "drizzle-orm";
import {
  transactions,
  auditLog,
  savingsProducts,
  savingsAccounts,
  savingsLedger,
} from "@schema";
import { TRPCError } from "@trpc/server";

// ── Middleware Integration (Sprint 44) ──────────────────────────────
import { publishEvent, type KafkaTopic } from "../kafkaClient";
import { cacheSet, cacheGet } from "../redisClient";
import { tbCreateTransfer } from "../tbClient";
import { fluvioProduce } from "../fluvio";
import { permifyCheck } from "../_core/permify";

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
            type: "Premium Payment",
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
            type: "Claim Payout",
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
  // DD-LEGACY: previously returned a fabricated savings product, a fake
  // account with a ₦250,000 balance, and invented ₦50M/₦750M analytics.
  // Money-path reads must be real or loud.
  //
  // 2026-11-27 (W30): products + analytics are now REAL reads over the W30
  // savings domain (drizzle/schema.ts: savings_products, savings_accounts,
  // savings_ledger — migration 0047). Contract: client/src/pages/
  // SavingsProductsPage.tsx. Fail-closed PRECONDITION_FAILED when the DB is
  // unavailable (W29 taxCollection.analytics pattern) — a portal showing an
  // empty catalog because the DB is down is a silent-failure mode.
  // `list` stays fail-loud: it serves the accounts/transactions tabs and is
  // W31 scope.
  products: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "savingsProducts.products requires the database; DATABASE_URL is not configured.",
      });
    }
    const rows = await database
      .select()
      .from(savingsProducts)
      .where(eq(savingsProducts.isActive, true))
      .orderBy(asc(savingsProducts.name));
    return {
      products: rows.map(r => ({
        id: r.id,
        name: r.name,
        type: r.type, // enum already display-cased
        description: r.description ?? "",
        minDeposit: Number(r.minDeposit), // pg returns numeric as string
        interestRate: r.interestRateBps / 100, // bps → percent p.a.
        lockPeriod:
          r.lockPeriodDays === 0 ? "None" : `${r.lockPeriodDays} days`,
        frequency: r.frequency,
      })),
    };
  }),
  list: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message:
        "savingsProducts.list is not implemented: no savings account store exists in this service. Previously returned a fabricated account balance.",
    });
  }),
  analytics: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "savingsProducts.analytics requires the database; DATABASE_URL is not configured.",
      });
    }
    // Ledger and accounts are independent axes — two aggregate round-trips,
    // no join. totalDeposits counts deposit postings only (withdrawals never
    // enter it); totalInterestPaid counts every interest_credit posting,
    // including those on since-closed accounts (a historical fact).
    const [money] = await database
      .select({
        totalDeposits: sql<string>`coalesce(sum(${savingsLedger.amount}) filter (where ${savingsLedger.entryType} = 'deposit'), 0)`,
        totalInterestPaid: sql<string>`coalesce(sum(${savingsLedger.amount}) filter (where ${savingsLedger.entryType} = 'interest_credit'), 0)`,
      })
      .from(savingsLedger);
    const [accts] = await database
      .select({
        activeAccounts: sql<number>`count(*) filter (where ${savingsAccounts.status} = 'active')::int`,
      })
      .from(savingsAccounts);
    return {
      totalDeposits: Number(money?.totalDeposits ?? 0),
      activeAccounts: Number(accts?.activeAccounts ?? 0),
      totalInterestPaid: Number(money?.totalInterestPaid ?? 0),
    };
  }),
});
