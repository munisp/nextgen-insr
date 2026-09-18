import { TRPCError } from "@trpc/server";
import { eq, desc, and, count, sum } from "drizzle-orm";
import { z } from "zod";

import { customers, transactions, auditLog } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


/**
 * customerWalletSystem — session-scoped customer wallet (F14-4, DD-TSSTATE).
 *
 * Identity: the wallet owner is ALWAYS the session user, resolved server-side
 * via customers.keycloakSub — a client-supplied customerId is never trusted
 * (previously any authenticated user could read/top-up ANY wallet).
 *
 * Party key: wallet ledger rows live in `transactions` keyed by the owning
 * party's id in `agentId` (the schema's only integer party column; the wallet
 * model shares it with savingsProducts). The owner id now comes from the
 * resolved customer record, so agent/customer ids can no longer be
 * substituted by the caller.
 *
 * Balance: only settled money counts — Cash In / Cash Out rows with
 * status 'success'. Pending/failed/reversed rows never enter the balance.
 */
async function resolveSessionCustomer(userId: number | string) {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable",
    });
  }
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.keycloakSub, String(userId)))
    .limit(1);
  if (!customer) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Customer profile not found for session user",
    });
  }
  return { db, customer };
}

export const customerWalletSystemRouter = router({
  getBalance: protectedProcedure.query(async ({ ctx }) => {
    try {
      const { db, customer } = await resolveSessionCustomer(ctx.user.id);
      const [credits] = await db
        .select({ total: sum(transactions.amount) })
        .from(transactions)
        .where(
          and(
            eq(transactions.agentId, customer.id),
            eq(transactions.type, "Cash In"),
            eq(transactions.status, "success")
          )
        )
        .limit(1);
      const [debits] = await db
        .select({ total: sum(transactions.amount) })
        .from(transactions)
        .where(
          and(
            eq(transactions.agentId, customer.id),
            eq(transactions.type, "Cash Out"),
            eq(transactions.status, "success")
          )
        )
        .limit(1);
      return {
        customerId: customer.id,
        balance: Number(credits?.total ?? 0) - Number(debits?.total ?? 0),
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
    .input(z.object({ limit: z.number().int().positive().max(200).default(50) }).optional())
    .query(async ({ input, ctx }) => {
      try {
        const { db, customer } = await resolveSessionCustomer(ctx.user.id);
        // Full history for the SESSION customer only — every status is shown
        // (a history that hides failed rows would be dishonest), but no other
        // party's rows are reachable.
        const rows = await db
          .select()
          .from(transactions)
          .where(eq(transactions.agentId, customer.id))
          .orderBy(desc(transactions.createdAt))
          .limit(input?.limit ?? 50);
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
  /**
   * PAY-4: wallet top-up MUST NOT mint credit without a verified rail leg.
   * Previously every call inserted a random-ref "Cash In"/success row — every
   * retry or double-click double-credited the wallet with no payment behind
   * it. Now:
   *   - `idempotencyKey` binds one durable credit to one logical request
   *     (transactions.idempotencyKey is UNIQUE; replay returns the winner,
   *     key reuse with a different payload is a CONFLICT).
   *   - `railReference` must point at an ALREADY-SETTLED inbound rail record
   *     in `transactions` (status 'success', matching amount) written by the
   *     payment-rail webhook/reconciliation path. No verified rail leg →
   *     PRECONDITION_FAILED (fail-closed). A rail reference can be consumed
   *     exactly once (DB unique index wallet_rail_reference_unique, 0061).
   */
  topUp: protectedProcedure
    .input(
      z.object({
        amount: z.number().positive(),
        source: z.string().min(1),
        railReference: z.string().min(8).max(64),
        idempotencyKey: z.string().min(8).max(64),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const { db, customer } = await resolveSessionCustomer(ctx.user.id);

        // Idempotent replay / conflict on the client key.
        const [prior] = await db
          .select()
          .from(transactions)
          .where(eq(transactions.idempotencyKey, input.idempotencyKey))
          .limit(1);
        if (prior) {
          const prevMeta = (prior.metadata ?? {}) as { railReference?: string };
          if (Number(prior.amount) !== input.amount || prevMeta.railReference !== input.railReference) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Idempotency key was already used with a different amount or rail reference. Refusing to re-execute.",
            });
          }
          return { success: true, idempotent: true, transactionId: prior.id, amount: input.amount };
        }

        // Verify the rail leg: a settled inbound record with this reference
        // and the SAME amount must already exist (written by the rail's own
        // webhook/settlement path — never by this wallet router).
        const [rail] = await db
          .select()
          .from(transactions)
          .where(eq(transactions.ref, input.railReference))
          .limit(1);
        if (!rail || rail.status !== "success") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Rail reference '${input.railReference}' is not a verified settled payment. Wallet credit refused (fail-closed).`,
          });
        }
        if (Number(rail.amount) !== input.amount) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Rail reference amount (₦${rail.amount}) does not match requested top-up (₦${input.amount}). Refused.`,
          });
        }

        const [tx] = await db
          .insert(transactions)
          .values({
            ref: `WTOP-${crypto.randomUUID().replace(/-/g, "").slice(0, 26)}`,
            idempotencyKey: input.idempotencyKey,
            agentId: customer.id,
            customerName: `${customer.firstName} ${customer.lastName}`.trim() || null,
            amount: String(input.amount),
            type: "Cash In",
            status: "success",
            channel: "App",
            metadata: { railReference: input.railReference, source: input.source },
          })
          .returning();
        await db.insert(auditLog).values({
          action: "wallet_topup",
          resource: "transactions",
          resourceId: String(tx.id),
          status: "success",
          metadata: {
            customerId: customer.id,
            amount: input.amount,
            source: input.source,
          },
        });
        return { success: true, idempotent: false, transactionId: tx.id, amount: input.amount };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        // DB-enforced single-consumption of a rail reference / idempotency
        // key (unique indexes) — a 23505 here means a concurrent or repeated
        // attempt to credit from the same rail leg.
        let e: unknown = error;
        while (typeof e === "object" && e !== null) {
          if ((e as { code?: string }).code === "23505") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Rail reference or idempotency key already consumed by a prior wallet top-up. Refusing duplicate credit.",
            });
          }
          e = (e as { cause?: unknown }).cause;
        }
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
