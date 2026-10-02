/**
 * memberPayments.ts — R3 batch 2 member surface (2026-10-01, R3-b2)
 *
 * READ-ONLY member payments surface over the premiumTopUp domain
 * (server/routers/premiumTopUp.ts). Deliberately NO mutation proc:
 * premiumTopUp.topUp is a financialProcedure gated by role `premium_collect`,
 * and members (users.role "user") hold no ROLE_PERMISSIONS entry
 * (server/_core/permifyMiddleware.ts:51-83) — delegating to it still 403s
 * fail-closed. The member funds path (payPremium) is deferred to a dedicated
 * reviewed wave that also adds the caller→policy ownership check topUp lacks;
 * this router ships the honest read surface only. premiumTopUp.getHistory is
 * an IDOR (arbitrary policyId → full history) and is never exposed here.
 * recurringPayments is an agent-cookie tool — internal-skip, no member
 * variant.
 *
 * Procedures:
 *   - myPremiums:    the caller's premium ledger rows (premiums table,
 *                    drizzle/schema.additions.ts:303), EVERY status shown
 *                    verbatim (paid/due/failed — no cosmetic filtering).
 *                    Caller scoping is dual-identity (memberPolicies
 *                    callerPolicyScope precedent, 2026-10-01 R3): a premium
 *                    row is the caller's iff premiums.customerId IN
 *                    (ctx.user.id, resolved customers.id) OR premiums.policyId
 *                    is one of the caller's own policies (policies.customerId
 *                    under the same dual-space rule). Optional policyId filter
 *                    is ownership-checked first — foreign/nonexistent →
 *                    NOT_FOUND, non-enumerating.
 *   - myPremiumDue:  server-derived payable view, two honest sections:
 *                    (a) duePremiums — real premiums ledger rows with
 *                        status "due" (amount + dueDate are recorded columns);
 *                    (b) policies — the caller's bound/active/lapsed policies
 *                        with their recorded annualPremium + renewalDate as a
 *                        REFERENCE amount (never a computed "amount due":
 *                        no real column records a per-policy outstanding
 *                        balance, so none is invented). The `disclosure`
 *                        string states this verbatim for the UI.
 *
 *   - initiatePremiumPayment (W7-B6, 2026-10-03): member-initiated premium
 *                    payment. Ownership-gated (dual-identity + admin/
 *                    supervisor bypass), amount derived SERVER-SIDE from the
 *                    due ledger row (never client-trusted), mandatory
 *                    idempotency key with payload-hash binding (F-02 store),
 *                    derived reference PP-{policyNumber}-{key}, real
 *                    premium_payments row (pending) + REAL gateway initialize
 *                    (server/lib/premiumPaymentGateway.ts). Gateway
 *                    unconfigured → PRECONDITION_FAILED fail-closed; never a
 *                    simulated success.
 *   - verifyPremiumPayment (W7-B6): server-side gateway verify → atomic
 *                    credit (premium_payments success + premiums ledger paid)
 *                    in ONE drizzle transaction; replay-safe (already-credited
 *                    returns the existing result, never double-credits).
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR; ownership miss → NOT_FOUND.
 * Amounts are numeric columns — returned verbatim as strings (never rounded,
 * never fabricated).
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  customers,
  insuranceProducts,
  policies,
  premiumPayments,
} from "../../drizzle/schema";
import { premiums } from "../../drizzle/schema.additions";
import {
  checkIdempotency,
  failIdempotency,
  IdempotencyConflictError,
  IdempotencyInProgressError,
  recordIdempotency,
} from "../journey-activities";
import { assertPolicyOwnershipDual } from "../lib/memberGuards";
import {
  GatewayNotConfiguredError,
  GatewayRequestError,
  gatewayConfigured,
  initializeTransaction,
  verifyTransaction,
  type VerifyResult,
} from "../lib/premiumPaymentGateway";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import type { DrizzleDb } from "../lib/memberGuards";

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
 * customers.keycloakSub = String(ctx.user.id) (memberPolicies
 * resolveSessionCustomer pattern, 2026-10-01 R3 copy). NULL when no customer
 * profile exists — the caller's users.id identity remains valid for scoping.
 */
async function resolveSessionCustomer(d: DrizzleDb, userId: number | string) {
  const [customer] = await d
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.keycloakSub, String(userId)))
    .limit(1);
  return customer ?? null;
}

/**
 * Dual-identity caller scope on policies (memberPolicies callerPolicyScope,
 * 2026-10-01 R3 copy): policies.customerId is written in users.id space by
 * the portal journey and in customers.id space by customer-wallet-era rows;
 * both are the caller's OWN identities, so OR-ing them is fail-closed.
 */
function callerPolicyScope(userId: number, customer: { id: number } | null) {
  return or(
    eq(policies.customerId, userId),
    customer ? eq(policies.customerId, customer.id) : undefined
  );
}

// W7-B6 (2026-10-03): F-02 idempotency namespace for member premium payments.
const PREMIUM_PAY_IDEM_JOURNEY = "member-premium-pay";

/** Map F-02 idempotency signals onto tRPC codes (W10-B2 precedent). */
function asIdempotencyTrpcError(error: unknown): TRPCError | null {
  if (error instanceof IdempotencyConflictError) {
    return new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error instanceof IdempotencyInProgressError) {
    return new TRPCError({
      code: "CONFLICT",
      message:
        "A payment with this idempotency key is currently in progress; retry after backoff",
    });
  }
  return null;
}

/** Best-effort release of a reservation so an explicit retry can re-execute. */
async function releaseIdempotency(key: string, error: string): Promise<void> {
  try {
    await failIdempotency(key, PREMIUM_PAY_IDEM_JOURNEY, error);
  } catch {
    /* best-effort release; the stale-reservation takeover covers crashes */
  }
}

export const memberPaymentsRouter = router({  /**
   * The caller's premium payment history, newest first, every status shown
   * verbatim. Optional policyId filter (ownership-checked, NOT_FOUND on miss).
   */
  myPremiums: protectedProcedure
    .input(
      z
        .object({
          policyId: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const d = await db();
      const customer = await resolveSessionCustomer(d, ctx.user.id);
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;

      const policyScope = callerPolicyScope(ctx.user.id, customer);
      const callerPolicyIds = d
        .select({ id: policies.id })
        .from(policies)
        .where(policyScope);

      if (input?.policyId !== undefined) {
        // Ownership check, non-enumerating: the policy must exist AND be in
        // the caller's dual-space scope; a miss throws NOT_FOUND either way.
        const [owned] = await d
          .select({ id: policies.id })
          .from(policies)
          .where(and(eq(policies.id, input.policyId), policyScope))
          .limit(1);
        if (!owned) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Policy not found",
          });
        }
      }

      const scope = and(
        or(
          eq(premiums.customerId, ctx.user.id),
          customer ? eq(premiums.customerId, customer.id) : undefined,
          inArray(premiums.policyId, callerPolicyIds)
        ),
        input?.policyId !== undefined
          ? eq(premiums.policyId, input.policyId)
          : undefined
      );

      const rows = await d
        .select({
          id: premiums.id,
          policyId: premiums.policyId,
          premiumRef: premiums.premiumRef,
          amount: premiums.amount,
          currency: premiums.currency,
          dueDate: premiums.dueDate,
          paidDate: premiums.paidDate,
          status: premiums.status,
          paymentMethod: premiums.paymentMethod,
          paymentRef: premiums.paymentRef,
          createdAt: premiums.createdAt,
          policyNumber: policies.policyNumber,
        })
        .from(premiums)
        .leftJoin(policies, eq(policies.id, premiums.policyId))
        .where(scope)
        .orderBy(desc(premiums.id))
        .limit(limit)
        .offset(offset);

      const [countRow] = await d
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(premiums)
        .where(scope);

      return {
        premiums: rows.map(r => ({
          ...r,
          policyNumber: r.policyNumber ?? null,
        })),
        count: countRow?.count ?? 0,
      };
    }),

  /**
   * Server-derived payable view. duePremiums = real ledger rows with status
   * "due" (recorded amount + dueDate). policies = the caller's
   * bound/active/lapsed policies with their RECORDED annualPremium as a
   * reference amount only — no outstanding-balance column exists on policies,
   * so no due amount is synthesized. Never client-entered amounts.
   */
  myPremiumDue: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const customer = await resolveSessionCustomer(d, ctx.user.id);
    const policyScope = callerPolicyScope(ctx.user.id, customer);
    const callerPolicyIds = d
      .select({ id: policies.id })
      .from(policies)
      .where(policyScope);

    const premiumScope = or(
      eq(premiums.customerId, ctx.user.id),
      customer ? eq(premiums.customerId, customer.id) : undefined,
      inArray(premiums.policyId, callerPolicyIds)
    );

    const dueRows = await d
      .select({
        id: premiums.id,
        policyId: premiums.policyId,
        premiumRef: premiums.premiumRef,
        amount: premiums.amount,
        currency: premiums.currency,
        dueDate: premiums.dueDate,
        gracePeriodDays: premiums.gracePeriodDays,
        status: premiums.status,
        policyNumber: policies.policyNumber,
      })
      .from(premiums)
      .leftJoin(policies, eq(policies.id, premiums.policyId))
      .where(and(premiumScope, eq(premiums.status, "due")))
      .orderBy(desc(premiums.dueDate))
      .limit(100);

    const payablePolicies = await d
      .select({
        id: policies.id,
        policyNumber: policies.policyNumber,
        status: policies.status,
        annualPremium: policies.annualPremium,
        renewalDate: policies.renewalDate,
        productId: policies.productId,
        productName: insuranceProducts.name,
      })
      .from(policies)
      .leftJoin(insuranceProducts, eq(insuranceProducts.id, policies.productId))
      .where(
        and(policyScope, inArray(policies.status, ["bound", "active", "lapsed"]))
      )
      .orderBy(desc(policies.id))
      .limit(100);

    return {
      duePremiums: dueRows.map(r => ({
        ...r,
        policyNumber: r.policyNumber ?? null,
      })),
      policies: payablePolicies.map(r => ({
        ...r,
        productName: r.productName ?? null,
        // Platform settlement currency — same convention as memberPolicies.
        currency: "NGN",
      })),
      disclosure:
        "Annual premium figures are the recorded policy amounts. " +
        "Outstanding balances are shown only where a due premium entry " +
        "exists on the ledger; no other due amount is calculated.",
    };
  }),

  /**
   * W7-B6 (2026-10-03): member-initiated premium payment.
   *
   * - Ownership: admin/supervisor bypass, else the caller must own the policy
   *   in either identity space (assertPolicyOwnershipDual). Miss → NOT_FOUND,
   *   non-enumerating.
   * - Amount: derived SERVER-SIDE from the due ledger row (premiums.amount);
   *   the input carries NO amount field at all.
   * - Idempotency: key from input or Idempotency-Key/X-Idempotency-Key header
   *   (missing → BAD_REQUEST), payload-hash bound to {policyId, premiumId,
   *   amount} — key reuse with different funds terms is a CONFLICT (F-02).
   * - Reference: derived PP-{policyNumber}-{idempotencyKey} (never random) so
   *   a crash between the payment-row insert and the idempotency record is
   *   recoverable by adoption (merchantPayoutSettlement W10-B2 precedent).
   * - Gateway: REAL Paystack initialize via server/lib/premiumPaymentGateway.
   *   Unconfigured → PRECONDITION_FAILED (503-style honest error), the
   *   reservation is released and NOTHING is written.
   */
  initiatePremiumPayment: protectedProcedure
    .input(
      z.object({
        policyId: z.number().int().positive(),
        premiumId: z.number().int().positive(),
        idempotencyKey: z.string().min(8).max(64).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const headerKey =
        ((ctx.req?.headers?.["idempotency-key"] ??
          ctx.req?.headers?.["x-idempotency-key"]) as string | undefined) ||
        undefined;
      const idempotencyKey = input.idempotencyKey ?? headerKey;
      if (!idempotencyKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "An idempotency key is required to initiate a premium payment (idempotencyKey input or Idempotency-Key header)",
        });
      }

      // Ownership gate BEFORE the idempotency replay and BEFORE any side
      // effect — a foreign caller must not even replay-disclose the payment.
      const customer = await resolveSessionCustomer(d, ctx.user.id);
      const role = (ctx.user as { role?: string | null }).role;
      if (role !== "admin" && role !== "supervisor") {
        await assertPolicyOwnershipDual(
          d,
          input.policyId,
          ctx.user.id,
          customer?.id ?? null
        );
      }
      const [policy] = await d
        .select({ id: policies.id, policyNumber: policies.policyNumber })
        .from(policies)
        .where(eq(policies.id, input.policyId))
        .limit(1);
      if (!policy) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      }

      // Server-side amount: the due ledger row is the ONLY source of truth.
      const [duePremium] = await d
        .select()
        .from(premiums)
        .where(
          and(eq(premiums.id, input.premiumId), eq(premiums.policyId, input.policyId))
        )
        .limit(1);
      if (!duePremium) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Premium entry not found",
        });
      }
      if (duePremium.status !== "due") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Premium entry ${duePremium.premiumRef} is not payable (status: ${duePremium.status})`,
        });
      }
      const amount = Number(duePremium.amount);
      if (!(amount > 0)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Premium entry ${duePremium.premiumRef} has no positive recorded amount — payment refused; fix the ledger first`,
        });
      }

      const idemPayload = {
        policyId: input.policyId,
        premiumId: input.premiumId,
        amount: String(duePremium.amount),
      };
      try {
        const replay = await checkIdempotency(
          idempotencyKey,
          PREMIUM_PAY_IDEM_JOURNEY,
          idemPayload
        );
        if (replay !== null && replay !== undefined) {
          return {
            ...(replay as Record<string, unknown>),
            idempotent: true,
          } as never;
        }
      } catch (error) {
        const idemError = asIdempotencyTrpcError(error);
        if (idemError) throw idemError;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Idempotency store unavailable — payment refused (fail-closed): " +
            (error instanceof Error ? error.message : String(error)),
        });
      }

      // Fail closed BEFORE writing anything when the gateway is not
      // provisioned — no pending rows, no fake references.
      if (!gatewayConfigured()) {
        await releaseIdempotency(idempotencyKey, "gateway not configured");
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Payment gateway is not configured on this deployment — premium payment is unavailable and was NOT initiated",
        });
      }

      const reference = `PP-${policy.policyNumber}-${idempotencyKey}`.slice(0, 120);
      try {
        // Crash-recovery adoption: a prior attempt that died after the row
        // insert reuses it instead of colliding on the unique reference.
        let paymentRow = (
          await d
            .select()
            .from(premiumPayments)
            .where(eq(premiumPayments.paymentReference, reference))
            .limit(1)
        )[0];
        if (!paymentRow) {
          paymentRow = await d.transaction(async tx => {
            const [row] = await tx
              .insert(premiumPayments)
              .values({
                policyId: input.policyId,
                paymentReference: reference,
                amount: String(duePremium.amount),
                currency: duePremium.currency ?? "NGN",
                dueDate: duePremium.dueDate,
                paymentMethod: "card",
                channel: "member_portal",
                status: "pending",
              })
              .returning();
            // Link the due ledger row to this payment reference in the SAME
            // transaction; the status='due' guard claims it exactly once.
            const claimed = await tx
              .update(premiums)
              .set({ paymentRef: reference })
              .where(and(eq(premiums.id, input.premiumId), eq(premiums.status, "due")))
              .returning({ id: premiums.id });
            if (claimed.length === 0) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: "Premium entry is no longer payable",
              });
            }
            return row;
          });
        }
        if (paymentRow.status === "success") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This premium was already paid under this reference",
          });
        }

        const init = await initializeTransaction({
          email:
            (ctx.user as { email?: string | null }).email ??
            `member-${ctx.user.id}@portal.local`,
          amountKobo: Math.round(amount * 100),
          reference,
          metadata: {
            policyId: input.policyId,
            premiumId: input.premiumId,
            policyNumber: policy.policyNumber,
            premiumRef: duePremium.premiumRef,
          },
        });

        const result = {
          reference,
          authorizationUrl: init.authorizationUrl,
          accessCode: init.accessCode,
          amount: String(duePremium.amount),
          currency: duePremium.currency ?? "NGN",
          paymentId: paymentRow.id,
        };
        // Persist the result under the reserved key; a record failure is
        // fatal (fail-closed) so no unprotected payment initiation exists.
        await recordIdempotency(
          idempotencyKey,
          PREMIUM_PAY_IDEM_JOURNEY,
          result,
          idemPayload
        );
        return { ...result, idempotent: false };
      } catch (error) {
        // Mark the payment row failed when the gateway call itself failed
        // (best-effort; the row is only a tracking record at this point —
        // no funds moved).
        if (error instanceof GatewayRequestError || error instanceof GatewayNotConfiguredError) {
          await d
            .update(premiumPayments)
            .set({ status: "failed", updatedAt: new Date() })
            .where(
              and(
                eq(premiumPayments.paymentReference, reference),
                eq(premiumPayments.status, "pending")
              )
            )
            .catch(() => {});
        }
        await releaseIdempotency(
          idempotencyKey,
          error instanceof Error ? error.message : String(error)
        );
        const idemError = asIdempotencyTrpcError(error);
        if (idemError) throw idemError;
        if (error instanceof TRPCError) throw error;
        if (error instanceof GatewayNotConfiguredError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error.message,
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Premium payment initiation failed: " +
            (error instanceof Error ? error.message : String(error)),
        });
      }
    }),

  /**
   * W7-B6: server-side verification + atomic premium credit. Replay-safe:
   * an already-credited reference returns the existing result and NEVER
   * credits twice (conditional pending→success UPDATE is the claim).
   */
  verifyPremiumPayment: protectedProcedure
    .input(z.object({ reference: z.string().min(8).max(128) }))
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const [row] = await d
        .select()
        .from(premiumPayments)
        .where(eq(premiumPayments.paymentReference, input.reference))
        .limit(1);
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Payment not found",
        });
      }
      // Ownership gate: the payment's policy must be the caller's (or an
      // admin/supervisor) — a reference must never disclose foreign payments.
      const customer = await resolveSessionCustomer(d, ctx.user.id);
      const role = (ctx.user as { role?: string | null }).role;
      if (role !== "admin" && role !== "supervisor") {
        await assertPolicyOwnershipDual(
          d,
          row.policyId,
          ctx.user.id,
          customer?.id ?? null
        );
      }

      if (row.status === "success") {
        return {
          reference: row.paymentReference,
          status: "success",
          amount: row.amount,
          currency: row.currency,
          paymentId: row.id,
          idempotent: true,
        };
      }
      if (!gatewayConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Payment gateway is not configured on this deployment — payment status cannot be verified",
        });
      }

      let verified: VerifyResult;
      try {
        verified = await verifyTransaction(input.reference);
      } catch (error) {
        if (error instanceof GatewayNotConfiguredError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error.message,
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Payment verification failed: " +
            (error instanceof Error ? error.message : String(error)),
        });
      }

      // Honest unpaid surface: anything other than gateway "success" is NOT
      // a credit. A gateway "failed" is recorded verbatim.
      if (verified.status !== "success") {
        if (verified.status === "failed") {
          await d
            .update(premiumPayments)
            .set({ status: "failed", updatedAt: new Date() })
            .where(
              and(
                eq(premiumPayments.paymentReference, input.reference),
                eq(premiumPayments.status, "pending")
              )
            );
        }
        return {
          reference: row.paymentReference,
          status: verified.status || "pending",
          amount: row.amount,
          currency: row.currency,
          paymentId: row.id,
          idempotent: false,
        };
      }
      // Amount must match the recorded row exactly (kobo) — a paid gateway
      // transaction for a different amount is never credited.
      if (verified.amountKobo !== Math.round(Number(row.amount) * 100)) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Gateway amount (${verified.amountKobo} kobo) does not match the recorded premium (${row.amount}) — credit refused`,
        });
      }

      const credited = await creditPremiumPayment(d, input.reference, verified);
      return {
        reference: row.paymentReference,
        status: "success",
        amount: row.amount,
        currency: row.currency,
        paymentId: row.id,
        idempotent: credited.alreadyCredited,
      };
    }),
});

/**
 * W7-B6: atomically credit a gateway-confirmed premium payment. Shared by
 * verifyPremiumPayment and the Paystack webhook handler
 * (server/paystack/webhookHandler.ts). Replay-safe: the conditional
 * pending→success UPDATE is the claim; a concurrent/repeated credit attempt
 * gets zero rows, re-reads, and reports the existing success.
 */
export async function creditPremiumPayment(
  d: DrizzleDb,
  reference: string,
  verified: Pick<VerifyResult, "gatewayTransactionId" | "channel">
): Promise<{ alreadyCredited: boolean }> {
  return d.transaction(async tx => {
    const claimed = await tx
      .update(premiumPayments)
      .set({
        status: "success",
        paymentDate: new Date(),
        gatewayRef:
          verified.gatewayTransactionId != null
            ? String(verified.gatewayTransactionId)
            : null,
        paymentMethod: verified.channel ?? "card",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(premiumPayments.paymentReference, reference),
          eq(premiumPayments.status, "pending")
        )
      )
      .returning({ id: premiumPayments.id });
    if (claimed.length === 0) {
      const [current] = await tx
        .select({ status: premiumPayments.status })
        .from(premiumPayments)
        .where(eq(premiumPayments.paymentReference, reference))
        .limit(1);
      if (!current) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Payment not found",
        });
      }
      if (current.status === "success") return { alreadyCredited: true };
      throw new TRPCError({
        code: "CONFLICT",
        message: `Payment is not pending (current: ${current.status}) — credit refused`,
      });
    }
    // Post the premium credit on the ledger in the SAME transaction: the due
    // row linked at initiation becomes paid (never duplicated — the
    // status='due' guard consumes it exactly once).
    await tx
      .update(premiums)
      .set({ status: "paid", paidDate: new Date() })
      .where(and(eq(premiums.paymentRef, reference), eq(premiums.status, "due")));
    return { alreadyCredited: false };
  });
}
