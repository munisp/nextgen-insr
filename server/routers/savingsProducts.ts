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
  customers,
  agents,
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
      // Fail-closed (W29 pattern): no DB → PRECONDITION_FAILED, never a
      // silent success on a money path.
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "savingsProducts.deposit requires the database; DATABASE_URL is not configured.",
        });
      }
      try {
        const ref = "SAV-" + crypto.randomUUID().slice(0, 12).toUpperCase();
        // 2026-11-27 (W31-B) dual-write cutover (design w30-design.md §6 Q2):
        // savings_ledger is now the SYSTEM OF RECORD for the savings domain
        // (honest entryType 'deposit'; savingsProducts.list/analytics read it
        // exclusively). The legacy transactions row is KEPT as a
        // float-continuity mirror inside the SAME DB transaction: the agent
        // float pipeline keys on transaction rows — transactions.ts:98
        // FLOAT_CREDIT_TYPES {"Premium Payment"}, the reversal handlers
        // (transactions.ts:1155/:1302), and agentFloatForecasting.ts:74
        // CASH_IN_TYPE — so dropping the mirror would silently remove
        // savings flows from agent float math (a funds-behavior change).
        // txTypeEnum has no honest "Savings Deposit" value (schema.ts:26-38)
        // and schema changes are out of scope, so the mirror keeps the
        // legacy float vocabulary; the honest savings record is the ledger.
        // One ref per money event, shared by both stores (traceability).
        const [entry] = await db.transaction(async tx => {
          const [posted] = await tx
            .insert(savingsLedger)
            .values({
              entryRef: ref,
              accountId: input.accountId,
              entryType: "deposit",
              amount: String(input.amount),
              // Ledger agentId is nullable and means "collecting agent" —
              // absent input → NULL (honest), unlike the legacy mirror's
              // accountId fallback below (preserved verbatim for float
              // continuity).
              agentId: input.agentId ?? null,
            })
            .returning();
          await tx.insert(transactions).values({
            agentId: input.agentId ?? input.accountId,
            amount: String(input.amount),
            // 2026-11-28 (C3 port rewrite): ip's tx_type "Premium Payment" doesn't exist
            // in root's txTypeEnum; deposit mirror uses root "Cash In" (C2
            // D1/D4 reversal precedent in agentFloatForecasting.ts:62-73).
            type: "Cash In",
            status: "success",
            channel: "Cash",
            ref,
          });
          await tx.insert(auditLog).values({
            action: "savings_deposit",
            resource: "savings_ledger",
            resourceId: String(posted.id),
            status: "success",
            metadata: {
              accountId: input.accountId,
              amount: input.amount,
              type: "deposit",
              entryRef: ref,
              floatMirror: "transactions",
            },
          });
          return [posted];
        });
        return {
          id: entry.id, // ledger entry id — the system-of-record posting
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
      // Fail-closed (W29 pattern): no DB → PRECONDITION_FAILED, never a
      // silent success on a money path.
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "savingsProducts.withdraw requires the database; DATABASE_URL is not configured.",
        });
      }
      try {
        const ref = "SAV-W-" + crypto.randomUUID().slice(0, 12).toUpperCase();
        // 2026-11-27 (W31-B) dual-write cutover — mirror image of `deposit`
        // above (same design §6 Q2 rationale): savings_ledger 'withdrawal'
        // posting is the system of record; the transactions row is kept as
        // the float-continuity mirror (FLOAT_DEBIT_TYPES {"Claim Payout",
        // "Transfer"}, transactions.ts:97) inside the same DB transaction.
        // NOTE (pre-existing, unchanged): no overdraft check — a withdrawal
        // larger than the ledger-derived balance is permitted today; adding
        // one is a product/funds-policy decision beyond this cutover.
        const [entry] = await db.transaction(async tx => {
          const [posted] = await tx
            .insert(savingsLedger)
            .values({
              entryRef: ref,
              accountId: input.accountId,
              entryType: "withdrawal",
              amount: String(input.amount),
              agentId: input.agentId ?? null,
            })
            .returning();
          await tx.insert(transactions).values({
            agentId: input.agentId ?? input.accountId,
            amount: String(input.amount),
            // 2026-11-28 (C3 port rewrite): ip's tx_type "Claim Payout" doesn't exist
            // in root's txTypeEnum; withdrawal mirror uses root "Cash Out".
            type: "Cash Out",
            status: "success",
            channel: "Cash",
            ref,
          });
          await tx.insert(auditLog).values({
            action: "savings_withdrawal",
            resource: "savings_ledger",
            resourceId: String(posted.id),
            status: "success",
            metadata: {
              accountId: input.accountId,
              amount: input.amount,
              type: "withdrawal",
              entryRef: ref,
              floatMirror: "transactions",
            },
          });
          return [posted];
        });
        return {
          id: entry.id, // ledger entry id — the system-of-record posting
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
  // 2026-11-27 (W31-B): `list` is now also a REAL read (below), and
  // deposit/withdraw dual-write to savings_ledger (see their bodies).
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
  // 2026-11-27 (W31-B): list is now a REAL read over the W30 savings domain —
  // one row per savings account, productName via the productId join,
  // customerName via the nullable customers link (walk-in thrift savers may
  // predate full KYC → LEFT JOIN), agentName via the nullable agents link.
  // balance is DERIVED from the append-only savings_ledger by design (no
  // balance column exists): deposits + interest credits − withdrawals.
  // Contract: client/src/pages/SavingsProductsPage.tsx accounts tab
  // (L171-191). The page also reuses this payload for its transactions tab
  // (L218-237), which expects per-posting fields (type, amount) that have no
  // per-account source — those keys are deliberately omitted and the page
  // renders them defensively (secondary badge, blank amount). targetAmount
  // (accounts tab) has no schema source either (no column anywhere in
  // drizzle/schema.ts) and is likewise omitted; the page guards with
  // `a.targetAmount?.toLocaleString()`.
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(200).default(50),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "savingsProducts.list requires the database; DATABASE_URL is not configured.",
        });
      }
      const rows = await database
        .select({
          id: savingsAccounts.id,
          accountNo: savingsAccounts.accountNo,
          status: savingsAccounts.status,
          createdAt: savingsAccounts.createdAt,
          productName: savingsProducts.name,
          customerFirstName: customers.firstName,
          customerLastName: customers.lastName,
          agentName: agents.name,
          balance: sql<string>`coalesce(sum(case when ${savingsLedger.entryType} = 'withdrawal' then -1 * ${savingsLedger.amount}::numeric else ${savingsLedger.amount}::numeric end), 0)`,
        })
        .from(savingsAccounts)
        .innerJoin(
          savingsProducts,
          eq(savingsProducts.id, savingsAccounts.productId)
        )
        .leftJoin(customers, eq(customers.id, savingsAccounts.customerId))
        .leftJoin(agents, eq(agents.id, savingsAccounts.agentId))
        .leftJoin(savingsLedger, eq(savingsLedger.accountId, savingsAccounts.id))
        .groupBy(
          savingsAccounts.id,
          savingsProducts.name,
          customers.firstName,
          customers.lastName,
          agents.name
        )
        .orderBy(asc(savingsAccounts.id))
        .limit(input?.limit ?? 50);
      return {
        accounts: rows.map(r => ({
          id: r.id,
          accountNo: r.accountNo,
          customerName:
            r.customerFirstName != null
              ? `${r.customerFirstName} ${r.customerLastName ?? ""}`.trim()
              : null,
          productName: r.productName,
          balance: Number(r.balance), // pg returns numeric aggregates as string
          status: r.status,
          agentName: r.agentName ?? null,
          createdAt: r.createdAt,
        })),
      };
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
