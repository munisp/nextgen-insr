/**
 * memberSavings.ts — R3 batch 2 member surface (2026-10-01, R3-b2)
 *
 * Member-scoped savings/accounts surface for the PWA
 * (customer-portal-full/client/src/services/savingsApi.ts → mounted as
 * `memberSavings`). The domain routers it replaces for members:
 *
 *   - savingsProducts (server/routers/savingsProducts.ts): `deposit`/`withdraw`
 *     write `status:"success"` money rows with a CALLER-CHOSEN agentId, no
 *     rail leg, no ledger, no idempotency key — a fabricated-funds path. They
 *     are deliberately NOT exposed to members (fail-closed funds rule), and
 *     its `listAccounts` is an UNSCOPED transactions select (IDOR). This
 *     router therefore exposes READ-ONLY member views only; NO
 *     deposit/withdraw/transfer member proc exists in batch 2 — funding goes
 *     through `/wallet` (batch 1, rail-verified).
 *   - accountOpening (server/routers/accountOpening.ts): `listAccounts` is an
 *     UNSCOPED customers select (PII incl. encrypted bvn/nin — IDOR), and
 *     `openAccount` creates a customers row for an ARBITRARY caller-supplied
 *     identity with no binding to the session user. `openMyAccount` below is
 *     the member-safe variant: identity (names, keycloakSub) is taken from
 *     the session, never from input; the fail-closed KYC-enforcement call is
 *     REUSED (copied, per worklist — the router is not imported).
 *
 * Identity rule: resolve the session customer via
 * `customers.keycloakSub = String(ctx.user.id)` (memberPolicies
 * resolveSessionCustomer pattern); transactions are scoped
 * `transactions.agentId = customer.id` (wallet party convention,
 * customerWalletSystem.ts:57-99).
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR; no customer profile → NOT_FOUND
 * on the savings views (non-enumerating — nothing about other members is
 * reachable); `myAccount` instead returns `{ account: null }` so the PWA can
 * offer account opening. No fabricated balances anywhere: mySummary sums only
 * settled (`status = "success"`) rows.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql, sum } from "drizzle-orm";
import { z } from "zod";

import { auditLog, customers, transactions } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { encryptPii, piiDedupeHash } from "../lib/piiCrypto";

type DrizzleDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function db(): Promise<DrizzleDb> {
  const d = await getDb();
  if (!d)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable",
    });
  return d;
}

/**
 * Resolve the session customer: customers.keycloakSub = String(ctx.user.id)
 * (memberPolicies.resolveSessionCustomer pattern, 2026-10-01 R3-b2 copy).
 */
async function resolveSessionCustomer(d: DrizzleDb, userId: number) {
  const [customer] = await d
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.keycloakSub, String(userId)))
    .limit(1);
  return customer ?? null;
}

/**
 * Savings views require a customer profile: transactions.agentId lives in
 * customers.id space, so without a profile there is no caller scope at all.
 * NOT_FOUND keeps the surface non-enumerating.
 */
async function requireSessionCustomer(d: DrizzleDb, userId: number) {
  const customer = await resolveSessionCustomer(d, userId);
  if (!customer) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Customer profile not found for session user",
    });
  }
  return customer;
}

/**
 * 2026-10-01 (R3-b2): fail-closed KYC enforcement — copied from
 * accountOpening.openAccount (lines ~93-142) per the R3-b2 worklist (copy,
 * don't import the router). For Tier 2+ openings (bvn/nin supplied) the KYC
 * enforcement gateway must be reachable BEFORE the record is created; an
 * unreachable gateway BLOCKS the operation (fail-closed) with
 * PRECONDITION_FAILED.
 */
async function enforceKycGate(input: {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  bvn?: string;
  nin?: string;
}): Promise<void> {
  const KYC_ENFORCEMENT_URL =
    process.env.KYC_ENFORCEMENT_URL || "http://localhost:8211";
  const requiresKYC = !!(input.bvn || input.nin); // Tier 2+ requires BVN/NIN
  if (!requiresKYC) return;
  try {
    const kycResp = await fetch(
      `${KYC_ENFORCEMENT_URL}/api/v1/enforce/account-opening`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id:
            `${input.firstName}-${input.lastName}-${input.phone}`
              .toLowerCase()
              .replace(/\s/g, "-"),
          tier: input.nin ? 3 : 2,
          product_type: "current",
          first_name: input.firstName,
          last_name: input.lastName,
          phone: input.phone,
          bvn: input.bvn || "",
          nin: input.nin || "",
          email: input.email || "",
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (kycResp.status === 503) {
      // KYC gateway unreachable — FAIL CLOSED
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "KYC verification service unreachable — account opening BLOCKED (fail-closed). Retry when service is available.",
      });
    }
  } catch (kycError) {
    if (kycError instanceof TRPCError) throw kycError;
    // Network error reaching KYC gateway — FAIL CLOSED
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "KYC enforcement gateway unreachable — account opening BLOCKED (fail-closed design prevents unverified account creation)",
    });
  }
}

export const memberSavingsRouter = router({
  /**
   * Caller's savings summary. Settled-only: sums are over
   * `status = "success"` rows ONLY (customerWalletSystem.ts:59/70 precedent)
   * — pending/failed/reversed rows never enter the balance. Balance =
   * settled Cash In − settled Cash Out. Never fabricated.
   */
  mySummary: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const customer = await requireSessionCustomer(d, ctx.user.id);
    const [credits] = await d
      .select({ total: sum(transactions.amount), count: sql<number>`COUNT(*)::int` })
      .from(transactions)
      .where(
        and(
          eq(transactions.agentId, customer.id),
          eq(transactions.type, "Cash In"),
          eq(transactions.status, "success")
        )
      )
      .limit(1);
    const [debits] = await d
      .select({ total: sum(transactions.amount), count: sql<number>`COUNT(*)::int` })
      .from(transactions)
      .where(
        and(
          eq(transactions.agentId, customer.id),
          eq(transactions.type, "Cash Out"),
          eq(transactions.status, "success")
        )
      )
      .limit(1);
    const totalIn = Number(credits?.total ?? 0);
    const totalOut = Number(debits?.total ?? 0);
    return {
      customerId: customer.id,
      balance: totalIn - totalOut,
      totalIn,
      totalOut,
      settledTransactions: (credits?.count ?? 0) + (debits?.count ?? 0),
      // Platform settlement currency (NGN) — same convention as the Q1/Q6 and
      // batch-1 member surfaces.
      currency: "NGN",
    };
  }),

  /**
   * Caller's savings transactions, newest first, paginated. Scoped
   * `transactions.agentId = customer.id`; ALL statuses are returned (a
   * history that hides failed rows would be dishonest — wallet precedent).
   */
  myTransactions: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(20),
          offset: z.number().int().min(0).default(0),
          type: z.enum(["Cash In", "Cash Out"]).optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const d = await db();
      const customer = await requireSessionCustomer(d, ctx.user.id);
      const scope = and(
        eq(transactions.agentId, customer.id),
        input?.type ? eq(transactions.type, input.type) : undefined
      );
      const rows = await d
        .select({
          id: transactions.id,
          ref: transactions.ref,
          type: transactions.type,
          amount: transactions.amount,
          currency: transactions.currency,
          channel: transactions.channel,
          status: transactions.status,
          failureReason: transactions.failureReason,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        .where(scope)
        .orderBy(desc(transactions.id))
        .limit(input?.limit ?? 20)
        .offset(input?.offset ?? 0);
      const [countRow] = await d
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(transactions)
        .where(scope);
      return { transactions: rows, count: countRow?.count ?? 0 };
    }),

  /**
   * The caller's own customers row, resolved by keycloakSub. Projects ONLY
   * id/firstName/lastName/status/kycLevel/createdAt — NEVER bvn/nin/hashes,
   * walletBalance or limits. Returns `{ account: null }` when no profile
   * exists (caller-scoped, so nothing is enumerated) so the PWA can render
   * the account-opening form instead of an error.
   */
  myAccount: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const [account] = await d
      .select({
        id: customers.id,
        firstName: customers.firstName,
        lastName: customers.lastName,
        status: customers.status,
        kycLevel: customers.kycLevel,
        createdAt: customers.createdAt,
      })
      .from(customers)
      .where(eq(customers.keycloakSub, String(ctx.user.id)))
      .limit(1);
    return { account: account ?? null };
  }),

  /**
   * Open the caller's OWN savings account (member-safe variant of
   * accountOpening.openAccount):
   *   - CONFLICT if a customers row already exists for this keycloakSub;
   *   - `keycloakSub` is FORCED to String(ctx.user.id) and names come from
   *     the session user record — identity is never taken from input
   *     (identity-spoofing prevention; smuggled input identity is ignored);
   *   - status pinned "pending_kyc" (never client-selectable);
   *   - fail-closed KYC gate reused when bvn/nin supplied (enforceKycGate);
   *   - bvn/nin encrypted at rest (encryptPii) with blind indexes
   *     (piiDedupeHash) so duplicate-identity detection still works; a bvn/nin
   *     or phone already registered to ANOTHER account → CONFLICT;
   *   - auditLog entry (no PII in metadata).
   */
  openMyAccount: protectedProcedure
    .input(
      z.object({
        phone: z.string().min(7).max(20),
        email: z.string().email().optional(),
        bvn: z.string().length(11).optional(),
        nin: z.string().length(11).optional(),
        address: z.string().max(512).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();

      const existing = await resolveSessionCustomer(d, ctx.user.id);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account already exists for this signed-in member",
        });
      }

      // Names from the SESSION user record, never from input.
      const sessionName = (ctx.user.name ?? "").trim();
      if (!sessionName) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Your signed-in profile has no name on record — account opening is blocked. Contact support to correct your profile first.",
        });
      }
      const parts = sessionName.split(/\s+/);
      const firstName = parts[0].slice(0, 64);
      const lastName = (parts.slice(1).join(" ") || parts[0]).slice(0, 64);

      // Fail-closed KYC gate (copied from accountOpening.openAccount) BEFORE
      // any record is created when Tier 2+ identity fields are supplied.
      await enforceKycGate({
        firstName,
        lastName,
        phone: input.phone,
        email: input.email ?? ctx.user.email ?? undefined,
        bvn: input.bvn,
        nin: input.nin,
      });

      // Duplicate-identity / duplicate-phone checks via the deterministic
      // blind indexes (encrypted columns use random IVs and can never be
      // unique-indexed; the keyed hashes can — schema.ts bvnHash/ninHash).
      const bvnHash = piiDedupeHash(input.bvn);
      const ninHash = piiDedupeHash(input.nin);
      if (bvnHash) {
        const [dup] = await d
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.bvnHash, bvnHash))
          .limit(1);
        if (dup)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This BVN is already registered to an account",
          });
      }
      if (ninHash) {
        const [dup] = await d
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.ninHash, ninHash))
          .limit(1);
        if (dup)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This NIN is already registered to an account",
          });
      }
      const [phoneDup] = await d
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.phone, input.phone))
        .limit(1);
      if (phoneDup)
        throw new TRPCError({
          code: "CONFLICT",
          message: "This phone number is already registered to an account",
        });

      const [customer] = await d
        .insert(customers)
        .values({
          firstName,
          lastName,
          phone: input.phone,
          email: input.email ?? ctx.user.email ?? null,
          bvn: encryptPii(input.bvn),
          nin: encryptPii(input.nin),
          bvnHash,
          ninHash,
          address: input.address ?? null,
          status: "pending_kyc",
          keycloakSub: String(ctx.user.id),
        })
        .returning({
          id: customers.id,
          firstName: customers.firstName,
          lastName: customers.lastName,
          status: customers.status,
          kycLevel: customers.kycLevel,
          createdAt: customers.createdAt,
        });

      await d.insert(auditLog).values({
        agentId: ctx.user.id,
        action: "member_account_opened",
        resource: "customers",
        resourceId: String(customer.id),
        status: "success",
        // No PII in audit metadata (names are already on the customer row).
        metadata: { source: "memberSavings.openMyAccount", userId: ctx.user.id },
      });

      return { success: true, account: customer };
    }),
});
