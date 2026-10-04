/**
 * memberFunds.ts — W10-B2 (2026-10-03): shared MEMBER-SAFE funds rail for the
 * member surface (memberBillPayments.pay / memberAirtime.vend /
 * memberMobileMoney.cashIn+cashOut).
 *
 * WHY THIS MODULE EXISTS (design: /mnt/agents/output/w10-funds-design.md §6):
 * the quarantined agent routers (billPayments.pay, airtimeVending.vend,
 * mobileMoney.cashIn/cashOut) take a CLIENT-SUPPLIED agentId and move agent
 * float — they can never be mounted for members. The member funds source is
 * the member's OWN captured funds: a REAL Paystack charge of the caller
 * (server/lib/premiumPaymentGateway.ts, env-gated PAYSTACK_SECRET_KEY,
 * fail-closed) followed by fulfillment through the generic tri-state
 * provider dispatcher (server/lib/providerDispatch.ts) against a PENDING
 * row inserted FIRST. Cash-out has no capture leg (the platform cannot
 * charge the member to pay the member out); it is an honest PENDING request
 * + provider debit dispatch that FAILS CLOSED when MOBILE_MONEY_PROVIDER_URL
 * is absent (no Paystack /transfer client exists — none is invented here).
 *
 * Invariants (all fail-closed, never fabricated):
 *   - Identity: the member is resolved server-side ONLY
 *     (customers.keycloakSub = String(ctx.user.id)); no client-supplied
 *     customerId/agentId/phone-as-identity is ever trusted.
 *   - Idempotency (F-02): mandatory key (input or Idempotency-Key header),
 *     checkIdempotency/recordIdempotency/failIdempotency with payload-hash
 *     binding (mismatch → CONFLICT), CALLER-SCOPED store keys
 *     (`journey:m{customerId}:{key}`, 2026-10-03 W10-B2 r2) so a shared
 *     client key from another member is a DIFFERENT scope entirely (never a
 *     cross-member replay), DERIVED references
 *     (BP/AV/CI/CO-{customerId}-{key}) so a crash between row insert and
 *     idempotency record is recovered by adoption
 *     (merchantPayoutSettlement.ts W10-B2 precedent). A row failed BEFORE
 *     any gateway/provider commitment is reset on same-key retry (dated
 *     metadata.retryReset audit note); a committed row is NEVER voided.
 *   - Fulfillment rows are INSERT-first PENDING before ANY provider call;
 *     provider outcomes are tri-state (accepted → submitted, rejected →
 *     failed + refund pending, unknown → unknown_outcome held for
 *     resolveProviderTx status lookup). NEVER a synchronous success, NEVER
 *     a silent catch.
 *   - Refund honesty: a provider rejection AFTER a verified capture marks
 *     the row failed with metadata.refund.status = "failed_refund_pending"
 *     — no Paystack /refund client exists in-tree, so reversal is a loud
     ops dependency, never silently dropped (design §3.4).
 *   - transactions.agentId is NOT NULL in the schema (drizzle/schema.ts:399)
 *     and no MEMBER TigerBeetle/float accounts exist; member rows pin
 *     agentId = ctx.user.id (the caller's own user id as actor identity).
 *     Member reads never scope by it (phone / metadata.memberCustomerId
 *     scopes); it is NOT a funds source here — no float is touched.
 */
import { TRPCError } from "@trpc/server";
import { and, eq, gte, sql, type SQL } from "drizzle-orm";

import { customers, transactions, type Transaction } from "../../drizzle/schema";
import {
  checkIdempotency,
  failIdempotency,
  IdempotencyConflictError,
  IdempotencyInProgressError,
  recordIdempotency,
} from "../journey-activities";
import {
  GatewayNotConfiguredError,
  GatewayRequestError,
  gatewayConfigured,
  initializeTransaction,
  verifyTransaction,
} from "./premiumPaymentGateway";
import {
  dispatchProviderOperation,
  type ProviderClientConfig,
} from "./providerDispatch";
import { resolveProviderTx } from "./providerResolution";
import { logger } from "../_core/logger";
import type { DrizzleDb } from "./memberGuards";

/** Minimal caller context the rail needs (structural — works for tests). */
export interface MemberFundsCtx {
  user: { id: number; email?: string | null; role?: string | null };
  req?: { headers?: Record<string, unknown> };
}

/** The caller's own customer profile — session-derived identity only. */
export interface MemberCustomer {
  id: number;
  phone: string | null;
  kycLevel: number | null;
}

export async function resolveMemberCustomer(
  d: DrizzleDb,
  userId: number | string
): Promise<MemberCustomer | null> {
  const [row] = await d
    .select({
      id: customers.id,
      phone: customers.phone,
      kycLevel: customers.kycLevel,
    })
    .from(customers)
    .where(eq(customers.keycloakSub, String(userId)))
    .limit(1);
  return row ?? null;
}

/**
 * Mandatory idempotency key: input field or Idempotency-Key /
 * X-Idempotency-Key header (memberPayments.initiatePremiumPayment pattern).
 */
export function requireIdempotencyKey(
  inputKey: string | undefined,
  ctx: MemberFundsCtx
): string {
  const headerKey =
    ((ctx.req?.headers?.["idempotency-key"] ??
      ctx.req?.headers?.["x-idempotency-key"]) as string | undefined) ||
    undefined;
  const key = inputKey ?? headerKey;
  if (!key) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "An idempotency key is required for this funds operation (idempotencyKey input or Idempotency-Key header)",
    });
  }
  return key;
}

/** Map F-02 idempotency signals onto tRPC codes (W10-B2 precedent). */
export function asIdempotencyTrpcError(error: unknown): TRPCError | null {
  if (error instanceof IdempotencyConflictError) {
    return new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error instanceof IdempotencyInProgressError) {
    return new TRPCError({
      code: "CONFLICT",
      message:
        "An operation with this idempotency key is currently in progress; retry after backoff",
    });
  }
  return null;
}

/**
 * 2026-10-03 (W10-B2 r2, FUNDS-CRITICAL): the caller-bound idempotency scope
 * for every member funds operation. The F-02 store key becomes
 * `journey:m{customerId}:{key}`, so the same client key from a different
 * member is a DIFFERENT idempotency scope entirely — never a cross-member
 * replay of another member's reference/authorizationUrl/transactionId.
 */
export function memberIdemScope(customer: MemberCustomer): string {
  return `m${customer.id}`;
}

/** Best-effort release of a reservation so an explicit retry can re-execute. */
export async function releaseIdempotency(
  journey: string,
  key: string,
  error: string,
  callerScope?: string // 2026-10-03 (W10-B2 r2): must match the reserve scope
): Promise<void> {
  try {
    await failIdempotency(key, journey, error, callerScope);
  } catch {
    /* best-effort release; the stale-reservation takeover covers crashes */
  }
}

/**
 * Derived crash-adoptable reference. transactions.ref is varchar(32)
 * (drizzle/schema.ts:397): the router input bounds the key to ≤ 20 chars and
 * customerId is a serial int; anything longer is a defect, never truncated
 * (truncation would silently merge distinct keys).
 */
export function deriveMemberReference(
  prefix: "BP" | "AV" | "CI" | "CO",
  customerId: number,
  idempotencyKey: string
): string {
  const ref = `${prefix}${customerId}-${idempotencyKey}`;
  if (ref.length > 32) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Idempotency key too long for a derived transaction reference",
    });
  }
  return ref;
}

/** Postgres unique-violation detection without a driver-specific import. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && "code" in err && err.code === 23505
  ) || (
    typeof err === "object" && err !== null && "code" in err && err.code === "23505"
  );
}

/** Per-kind rail configuration supplied by each member router. */
export interface MemberFundsKind {
  /** F-02 idempotency namespace. */
  journey: string;
  refPrefix: "BP" | "AV" | "CI" | "CO";
  txType: "Bill Payment" | "Airtime" | "Cash In" | "Cash Out";
  /** Provider client (null when the fulfillment rail is not provisioned). */
  providerClient(): ProviderClientConfig | null;
  /** Provider dispatch path ("/pay" | "/vend" | "/cashin" | "/cashout"). */
  dispatchPath: string;
  /** Human label for honest error messages. */
  label: string;
}

type TxMetadata = Record<string, unknown>;

function metaOf(tx: Transaction): TxMetadata {
  return (tx.metadata as TxMetadata | null) ?? {};
}

/** Guarded expected-state UPDATE helper (F4): 0 rows → null (never overwrite). */
async function guardedUpdate(
  d: DrizzleDb,
  ref: string,
  set: Record<string, unknown>,
  expect: { status?: string; providerStatus?: string }
): Promise<Transaction | null> {
  const conds = [eq(transactions.ref, ref)];
  if (expect.status) conds.push(eq(transactions.status, expect.status));
  if (expect.providerStatus) {
    conds.push(
      sql`${transactions.metadata}->>'providerStatus' = ${expect.providerStatus}`
    );
  }
  const [row] = await d
    .update(transactions)
    .set({ ...set, updatedAt: new Date() })
    .where(and(...conds))
    .returning();
  return row ?? null;
}

async function rowByRef(d: DrizzleDb, ref: string): Promise<Transaction | null> {
  const [row] = await d
    .select()
    .from(transactions)
    .where(eq(transactions.ref, ref))
    .limit(1);
  return row ?? null;
}

/**
 * Caller-scoped daily-limit enforcement (server-side; the member-facing
 * limits are platform policy, not client input). Conservative: PENDING and
 * SUCCESS rows both count — a held/unknown outcome still consumes limit.
 */
export async function enforceMemberDailyLimit(opts: {
  d: DrizzleDb;
  scope: SQL | undefined;
  amountNGN: number;
  dailyLimitNGN: number;
  label: string;
}): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [row] = await opts.d
    .select({
      dailyTotal: sql<string>`COALESCE(SUM(CAST(${transactions.amount} AS NUMERIC)), 0)`,
    })
    .from(transactions)
    .where(
      and(
        opts.scope,
        gte(transactions.createdAt, today),
        sql`${transactions.status} IN ('pending','success')`
      )
    );
  if (Number(row?.dailyTotal ?? 0) + opts.amountNGN > opts.dailyLimitNGN) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Daily ${opts.label} limit of ₦${opts.dailyLimitNGN.toLocaleString()} exceeded`,
    });
  }
}

/** Result returned by a successful capture initiation. */
export interface MemberCaptureInitiation {
  reference: string;
  authorizationUrl: string;
  accessCode: string;
  amount: string;
  currency: string;
  transactionId: number;
  status: "awaiting_payment";
  idempotent: boolean;
}

/**
 * Phase 1 for pay / vend / cashIn: reserve idempotency → fail-closed rail
 * gate BEFORE any write → daily limit → INSERT-first PENDING row → REAL
 * Paystack initialize → recordIdempotency (fatal on failure). The member
 * completes checkout at the authorization URL; NOTHING is dispatched to the
 * fulfillment provider until confirmMemberCapture verifies the capture.
 */
export async function initiateMemberCapture(opts: {
  d: DrizzleDb;
  ctx: MemberFundsCtx;
  kind: MemberFundsKind;
  customer: MemberCustomer;
  idempotencyKey: string;
  amountNGN: number;
  /** Payload-hash binding terms (funds-relevant input only). */
  idemPayload: Record<string, unknown>;
  /** Caller-scoped daily-limit condition; undefined = no extra scope. */
  dailyScope?: SQL;
  dailyLimitNGN: number;
  /** transactions row columns beyond the shared set. */
  row: { customerPhone?: string | null; customerAccount?: string | null };
  /** Extra metadata (biller/network/provider, beneficiary, …). */
  metadata: TxMetadata;
  /** Exact payload re-sent to the provider at confirm time. */
  dispatchPayload: Record<string, unknown>;
}): Promise<MemberCaptureInitiation> {
  const { d, ctx, kind, customer, idempotencyKey, amountNGN } = opts;
  const idemScope = memberIdemScope(customer); // caller-bound scope (W10-B2 r2)
  let replay: unknown;
  try {
    replay = await checkIdempotency(idempotencyKey, kind.journey, opts.idemPayload, idemScope);
  } catch (error) {
    const idemError = asIdempotencyTrpcError(error);
    if (idemError) throw idemError;
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "Idempotency store unavailable — operation refused (fail-closed): " +
        (error instanceof Error ? error.message : String(error)),
    });
  }
  if (replay !== null && replay !== undefined) {
    return { ...(replay as MemberCaptureInitiation), idempotent: true };
  }

  // Fail closed BEFORE writing anything when either rail is unprovisioned:
  // no pending rows, no fake references (blocking precondition, design §6.1).
  if (!gatewayConfigured()) {
    await releaseIdempotency(kind.journey, idempotencyKey, "gateway not configured", idemScope);
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Payment gateway is not configured on this deployment — " +
        `${kind.label} is unavailable and was NOT initiated`,
    });
  }
  if (!kind.providerClient()) {
    await releaseIdempotency(kind.journey, idempotencyKey, "provider not configured", idemScope);
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        `${kind.label} fulfillment provider is not configured on this deployment ` +
        "— charging without a fulfillment rail would strand member funds, so nothing was initiated",
    });
  }

  try {
    await enforceMemberDailyLimit({
      d,
      scope: opts.dailyScope,
      amountNGN,
      dailyLimitNGN: opts.dailyLimitNGN,
      label: kind.label,
    });
  } catch (error) {
    await releaseIdempotency(
      kind.journey,
      idempotencyKey,
      error instanceof Error ? error.message : String(error),
      idemScope
    );
    throw error;
  }

  const reference = deriveMemberReference(kind.refPrefix, customer.id, idempotencyKey);
  const baseMetadata: TxMetadata = {
    // Member-bound identity (NEW metadata keys, design §6.1): the bill/tx
    // tables have no member column, so the caller's dual identity is pinned
    // here at write time.
    memberUserId: ctx.user.id,
    memberCustomerId: customer.id,
    ...opts.metadata,
    captureStatus: "awaiting_payment",
    providerStatus: "awaiting_payment",
    paystackReference: reference,
    dispatchPayload: opts.dispatchPayload,
  };

  try {
    // Crash-recovery adoption (merchantPayoutSettlement W10-B2 precedent):
    // a prior attempt that died after the row insert is adopted by its
    // derived reference instead of colliding on the unique constraint.
    let txRow = await rowByRef(d, reference);
    if (!txRow) {
      try {
        const [inserted] = await d
          .insert(transactions)
          .values({
            ref: reference,
            // DB-level dedup, namespaced per funds kind AND caller
            // (2026-10-03 W10-B2 r2) so a shared client key can never
            // collide across rails or members (column is global-unique).
            idempotencyKey: `${kind.journey}:${idemScope}:${idempotencyKey}`,
            agentId: ctx.user.id, // actor identity only — NOT a float source
            type: kind.txType,
            amount: String(amountNGN),
            fee: "0",
            commission: "0",
            customerPhone: opts.row.customerPhone ?? null,
            customerAccount: opts.row.customerAccount ?? null,
            channel: "App",
            // Never synchronous success: capture first, provider fulfillment
            // after verification.
            status: "pending",
            fraudScore: "0.00",
            metadata: baseMetadata,
          })
          .returning();
        txRow = inserted;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        txRow = await rowByRef(d, reference);
        if (!txRow) throw err;
      }
    } else if (metaOf(txRow).memberCustomerId !== customer.id) {
      // A derived reference belongs to exactly one member — never adopt a
      // foreign row (defense in depth; the idempotency store already binds).
      throw new TRPCError({ code: "CONFLICT", message: "Reference conflict" });
    }
    if (txRow.status !== "pending") {
      const m = metaOf(txRow);
      // 2026-10-03 (W10-B2 r2, defect 2): a row failed BEFORE any
      // gateway/provider commitment (e.g. Paystack initialize 500 — nothing
      // charged, nothing dispatched; the catch path below marks exactly this
      // state) must NOT brick same-key retry. Mirror the premium-payment
      // semantics (memberPayments.initiatePremiumPayment adopts its failed
      // pre-capture row and re-initializes): reset the row with a dated audit
      // note and re-run initiation. A row that DID reach a commitment
      // (capture verified, dispatch submitted/held, provider rejection after
      // capture) is terminal and still CONFLICTs — it is NEVER voided.
      const reachedCommitment =
        m.captureStatus === "captured" ||
        m.gatewayRef != null ||
        m.providerRef != null ||
        (m.providerStatus != null && m.providerStatus !== "awaiting_payment");
      if (txRow.status === "failed" && !reachedCommitment) {
        const reset = await guardedUpdate(
          d,
          reference,
          {
            status: "pending",
            failureReason: null,
            metadata: {
              ...m,
              retryReset: {
                at: new Date().toISOString(),
                reason:
                  "pre-commitment initiation failure (gateway error before any charge/dispatch) — same-key retry reuses this row",
                previousFailure: txRow.failureReason ?? null,
              },
            },
          },
          { status: "failed", providerStatus: "awaiting_payment" }
        );
        if (!reset) {
          // Lost a concurrent transition race — fail closed as terminal.
          throw new TRPCError({
            code: "CONFLICT",
            message: `This ${kind.label} already reached a terminal state (status: failed, providerStatus: unknown)`,
          });
        }
        txRow = reset;
      } else {
        throw new TRPCError({
          code: "CONFLICT",
          message: `This ${kind.label} already reached a terminal state (status: ${txRow.status}, providerStatus: ${String(m.providerStatus ?? "unknown")})`,
        });
      }
    }

    const init = await initializeTransaction({
      email: ctx.user.email ?? `member-${ctx.user.id}@portal.local`,
      amountKobo: Math.round(amountNGN * 100),
      reference,
      metadata: {
        kind: kind.refPrefix,
        memberCustomerId: customer.id,
        memberUserId: ctx.user.id,
        ...opts.metadata,
      },
    });

    const result: MemberCaptureInitiation = {
      reference,
      authorizationUrl: init.authorizationUrl,
      accessCode: init.accessCode,
      amount: String(amountNGN),
      currency: "NGN",
      transactionId: txRow.id,
      status: "awaiting_payment",
      idempotent: false,
    };
    // Persist under the reserved key; a record failure is FATAL (fail-closed)
    // so no unprotected funds initiation exists.
    await recordIdempotency(idempotencyKey, kind.journey, result, opts.idemPayload, idemScope);
    return result;
  } catch (error) {
    // Gateway call failed after the row insert: mark the tracking row failed
    // (best-effort; no funds moved — capture never happened).
    if (
      error instanceof GatewayRequestError ||
      error instanceof GatewayNotConfiguredError
    ) {
      await guardedUpdate(
        d,
        reference,
        { status: "failed", failureReason: error.message },
        { status: "pending", providerStatus: "awaiting_payment" }
      ).catch(() => {});
    }
    await releaseIdempotency(
      kind.journey,
      idempotencyKey,
      error instanceof Error ? error.message : String(error),
      idemScope
    );
    const idemError = asIdempotencyTrpcError(error);
    if (idemError) throw idemError;
    if (error instanceof TRPCError) throw error;
    if (error instanceof GatewayNotConfiguredError) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        `${kind.label} initiation failed: ` +
        (error instanceof Error ? error.message : String(error)),
    });
  }
}

/** Result of a capture confirmation + fulfillment dispatch. */
export interface MemberCaptureConfirmation {
  reference: string;
  status: string;
  providerStatus: string;
  captureStatus: string;
  amount: string;
  currency: string;
  transactionId: number;
  failureReason: string | null;
  refundStatus: string | null;
  resolution?: string;
  idempotent: boolean;
}

function confirmationOf(tx: Transaction, idempotent: boolean, resolution?: string): MemberCaptureConfirmation {
  const m = metaOf(tx);
  const refund = (m.refund as { status?: string } | null | undefined) ?? null;
  return {
    reference: tx.ref,
    status: tx.status,
    providerStatus: String(m.providerStatus ?? tx.status),
    captureStatus: String(m.captureStatus ?? "awaiting_payment"),
    amount: tx.amount,
    currency: tx.currency ?? "NGN",
    transactionId: tx.id,
    failureReason: tx.failureReason ?? null,
    refundStatus: refund?.status ?? null,
    ...(resolution ? { resolution } : {}),
    idempotent,
  };
}

/**
 * Phase 2 for pay / vend / cashIn: server-side Paystack verify (kobo-exact
 * amount match, "success" only) → guarded capture transition → provider
 * fulfillment dispatch (tri-state). Replay-safe: an already-dispatched row
 * is resolved via the provider STATUS LOOKUP (resolveProviderTx), never
 * re-dispatched; a terminal row is returned verbatim.
 *
 * Ownership: the row's metadata.memberUserId / memberCustomerId must match
 * the caller (dual identity); admin/supervisor bypass. Miss → NOT_FOUND
 * (non-enumerating — a reference never discloses a foreign payment).
 */
export async function confirmMemberCapture(opts: {
  d: DrizzleDb;
  ctx: MemberFundsCtx;
  kind: MemberFundsKind;
  reference: string;
}): Promise<MemberCaptureConfirmation> {
  const { d, ctx, kind, reference } = opts;
  const tx = await rowByRef(d, reference);
  if (!tx) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
  }
  const meta = metaOf(tx);
  const role = ctx.user.role;
  if (role !== "admin" && role !== "supervisor") {
    const customer = await resolveMemberCustomer(d, ctx.user.id);
    const owns =
      meta.memberUserId === ctx.user.id ||
      (customer != null && meta.memberCustomerId === customer.id);
    if (!owns) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
    }
  }

  // Terminal rows are returned verbatim — never re-credited, never re-dispatched.
  if (tx.status === "success" || tx.status === "failed") {
    return confirmationOf(tx, true);
  }

  const providerStatus = String(meta.providerStatus ?? "awaiting_payment");

  // ── Capture phase ────────────────────────────────────────────────────────
  if (providerStatus === "awaiting_payment") {
    if (!gatewayConfigured()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Payment gateway is not configured on this deployment — payment status cannot be verified",
      });
    }
    let verified;
    try {
      verified = await verifyTransaction(reference);
    } catch (error) {
      if (error instanceof GatewayNotConfiguredError) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
      }
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "Payment verification failed: " +
          (error instanceof Error ? error.message : String(error)),
      });
    }
    // Honest unpaid surface: anything other than gateway "success" is NOT a
    // capture. A gateway "failed" is recorded verbatim (guarded).
    if (verified.status !== "success") {
      if (verified.status === "failed") {
        const updated = await guardedUpdate(
          d,
          reference,
          {
            status: "failed",
            failureReason: "payment not completed (gateway status: failed)",
            metadata: { ...meta, captureStatus: "failed" },
          },
          { status: "pending", providerStatus: "awaiting_payment" }
        );
        return confirmationOf(updated ?? (await rowByRef(d, reference)) ?? tx, false);
      }
      return confirmationOf(tx, false);
    }
    // Amount must match the recorded row exactly (kobo) — a paid gateway
    // transaction for a different amount is never captured.
    if (verified.amountKobo !== Math.round(Number(tx.amount) * 100)) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Gateway amount (${verified.amountKobo} kobo) does not match the recorded ${kind.label} (${tx.amount}) — capture refused`,
      });
    }
    const captured = await guardedUpdate(
      d,
      reference,
      {
        metadata: {
          ...meta,
          captureStatus: "captured",
          capturedAt: new Date().toISOString(),
          gatewayRef:
            verified.gatewayTransactionId != null
              ? String(verified.gatewayTransactionId)
              : null,
          providerStatus: "pending_dispatch",
        },
      },
      { status: "pending", providerStatus: "awaiting_payment" }
    );
    if (!captured) {
      // Concurrent confirm won the capture race — re-read and continue from
      // the fresh state (idempotent).
      const fresh = await rowByRef(d, reference);
      if (!fresh) throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
      return confirmMemberCapture({ d, ctx, kind, reference });
    }
    return dispatchMemberFulfillment(d, kind, captured, false);
  }

  // ── Already captured: dispatch or resolve ────────────────────────────────
  if (providerStatus === "pending_dispatch") {
    return dispatchMemberFulfillment(d, kind, tx, false);
  }
  // submitted / unknown_outcome / completed-ish: resolve via the provider
  // STATUS LOOKUP — NEVER a blind re-dispatch (F-02 funds safety).
  const resolved = await resolveProviderTx({
    transaction: tx,
    client: kind.providerClient(),
  });
  return confirmationOf(resolved.transaction, true, resolved.resolution);
}

/**
 * Dispatch the fulfillment op for a captured row and persist the tri-state
 * outcome honestly (guarded expected-state updates; concurrent resolvers
 * match 0 rows and re-read instead of last-writer-wins).
 */
async function dispatchMemberFulfillment(
  d: DrizzleDb,
  kind: MemberFundsKind,
  tx: Transaction,
  idempotent: boolean
): Promise<MemberCaptureConfirmation> {
  const meta = metaOf(tx);
  const client = kind.providerClient();
  if (!client) {
    // Capture succeeded but the fulfillment rail vanished between initiate
    // and confirm — fail LOUD, hold the row pending_dispatch for retry.
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        `${kind.label} fulfillment provider is not configured — captured funds ` +
        `are held on reference ${tx.ref}; fulfillment NOT dispatched`,
    });
  }
  const dispatch = await dispatchProviderOperation({
    ...client,
    path: kind.dispatchPath,
    reference: tx.ref,
    payload: (meta.dispatchPayload as Record<string, unknown>) ?? {},
  });

  if (dispatch.outcome === "accepted") {
    const updated = await guardedUpdate(
      d,
      tx.ref,
      {
        metadata: {
          ...meta,
          providerStatus: "submitted",
          providerRef: dispatch.providerRef ?? null,
        },
      },
      { status: "pending", providerStatus: "pending_dispatch" }
    );
    if (!updated) {
      const fresh = await rowByRef(d, tx.ref);
      if (fresh) return confirmationOf(fresh, true);
      throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
    }
    logger.info(`[MemberFunds] ${tx.ref} ${kind.label} submitted to provider`);
    return confirmationOf(updated, idempotent);
  }

  if (dispatch.outcome === "rejected") {
    // Definitive rejection AFTER a verified capture: the row fails LOUDLY
    // and the captured funds are flagged for reversal. No Paystack /refund
    // client exists in-tree (2026-10-03) — refund is a manual ops credit;
    // the status is surfaced verbatim, never silently dropped.
    const updated = await guardedUpdate(
      d,
      tx.ref,
      {
        status: "failed",
        failureReason: dispatch.reason ?? "provider rejected operation",
        metadata: {
          ...meta,
          providerStatus: "rejected",
          providerError: dispatch.reason ?? null,
          refund: {
            status: "failed_refund_pending",
            reason:
              "Provider rejected fulfillment after capture; no automated refund rail is integrated — manual ops reversal required",
            capturedAmountNGN: tx.amount,
            flaggedAt: new Date().toISOString(),
          },
        },
      },
      { status: "pending", providerStatus: "pending_dispatch" }
    );
    if (!updated) {
      const fresh = await rowByRef(d, tx.ref);
      if (fresh) return confirmationOf(fresh, true);
      throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
    }
    logger.warn(`[MemberFunds] ${tx.ref} rejected by provider post-capture: ${dispatch.reason} — refund pending`);
    return confirmationOf(updated, idempotent);
  }

  // Unknown outcome: the provider may hold the op. Held pending and resolved
  // via status lookup on retry — NEVER re-sent blindly.
  const updated = await guardedUpdate(
    d,
    tx.ref,
    {
      metadata: {
        ...meta,
        providerStatus: "unknown_outcome",
        providerError: dispatch.reason ?? null,
      },
    },
    { status: "pending", providerStatus: "pending_dispatch" }
  );
  if (!updated) {
    const fresh = await rowByRef(d, tx.ref);
    if (fresh) return confirmationOf(fresh, true);
    throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
  }
  logger.error(
    `[MemberFunds] ${tx.ref} outcome UNKNOWN (${dispatch.reason}) — held pending for status lookup, NOT re-sent`
  );
  return confirmationOf(updated, idempotent);
}

/** Result of a cash-out request (no capture leg — provider-settled). */
export interface MemberCashOutResult {
  reference: string;
  status: string;
  providerStatus: string;
  amount: string;
  currency: string;
  transactionId: number;
  failureReason: string | null;
  resolution?: string;
  idempotent: boolean;
}

/**
 * memberMobileMoney.cashOut (W10-B2 honest v1, design §6.4): the platform
 * CANNOT charge the member first (a payout would require a Paystack
 * /transfer client that does not exist — none is invented). This is a
 * PENDING provider-debit request only: INSERT-first pending row → immediate
 * provider dispatch → tri-state outcome. With no MOBILE_MONEY_PROVIDER_URL
 * the proc FAILS CLOSED (PRECONDITION_FAILED) BEFORE any write — never a
 * recorded success, never a silent no-op.
 */
export async function requestMemberCashOut(opts: {
  d: DrizzleDb;
  ctx: MemberFundsCtx;
  kind: MemberFundsKind;
  customer: MemberCustomer;
  idempotencyKey: string;
  amountNGN: number;
  idemPayload: Record<string, unknown>;
  dailyScope?: SQL;
  dailyLimitNGN: number;
  metadata: TxMetadata;
  dispatchPayload: Record<string, unknown>;
}): Promise<MemberCashOutResult> {
  const { d, ctx, kind, customer, idempotencyKey, amountNGN } = opts;
  const idemScope = memberIdemScope(customer); // caller-bound scope (W10-B2 r2)
  let replay: unknown;
  try {
    replay = await checkIdempotency(idempotencyKey, kind.journey, opts.idemPayload, idemScope);
  } catch (error) {
    const idemError = asIdempotencyTrpcError(error);
    if (idemError) throw idemError;
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "Idempotency store unavailable — operation refused (fail-closed): " +
        (error instanceof Error ? error.message : String(error)),
    });
  }
  if (replay !== null && replay !== undefined) {
    return { ...(replay as MemberCashOutResult), idempotent: true };
  }

  const client = kind.providerClient();
  if (!client) {
    await releaseIdempotency(kind.journey, idempotencyKey, "provider not configured", idemScope);
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        `${kind.label} provider is not configured on this deployment — the cash-out ` +
        "request was NOT recorded and no funds movement was initiated",
    });
  }

  try {
    await enforceMemberDailyLimit({
      d,
      scope: opts.dailyScope,
      amountNGN,
      dailyLimitNGN: opts.dailyLimitNGN,
      label: kind.label,
    });
  } catch (error) {
    await releaseIdempotency(
      kind.journey,
      idempotencyKey,
      error instanceof Error ? error.message : String(error),
      idemScope
    );
    throw error;
  }

  const reference = deriveMemberReference(kind.refPrefix, customer.id, idempotencyKey);
  const baseMetadata: TxMetadata = {
    memberUserId: ctx.user.id,
    memberCustomerId: customer.id,
    ...opts.metadata,
    providerStatus: "pending_provider",
    dispatchPayload: opts.dispatchPayload,
    settlement: "provider_side", // no platform capture/payout leg exists
  };

  try {
    let txRow = await rowByRef(d, reference);
    let adopted = txRow != null;
    if (!txRow) {
      try {
        const [inserted] = await d
          .insert(transactions)
          .values({
            ref: reference,
            // 2026-10-03 (W10-B2 r2): namespaced per rail AND caller (was a
            // bare key — a cross-rail/cross-member shared key would 23505).
            idempotencyKey: `${kind.journey}:${idemScope}:${idempotencyKey}`,
            agentId: ctx.user.id, // actor identity only — NOT a float source
            type: kind.txType,
            amount: String(amountNGN),
            fee: "0",
            commission: "0",
            customerPhone: customer.phone,
            channel: "App",
            status: "pending", // NEVER synchronous success
            fraudScore: "0.00",
            metadata: baseMetadata,
          })
          .returning();
        txRow = inserted;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        txRow = await rowByRef(d, reference);
        if (!txRow) throw err;
        adopted = true;
      }
    } else if (metaOf(txRow).memberCustomerId !== customer.id) {
      throw new TRPCError({ code: "CONFLICT", message: "Reference conflict" });
    }

    if (txRow.status === "failed") {
      // Definitive prior rejection under this derived reference — replay the
      // recorded outcome honestly; a NEW attempt needs a NEW key/reference.
      const result: MemberCashOutResult = {
        reference,
        status: "failed",
        providerStatus: String(metaOf(txRow).providerStatus ?? "rejected"),
        amount: String(amountNGN),
        currency: "NGN",
        transactionId: txRow.id,
        failureReason: txRow.failureReason ?? null,
        idempotent: false,
      };
      await recordIdempotency(idempotencyKey, kind.journey, result, opts.idemPayload, idemScope);
      return result;
    }

    // Crash-adoption: a pending row may or may not have reached the provider.
    // Resolve via the provider STATUS LOOKUP first — never a blind
    // re-dispatch. If the lookup leaves the row still pending BEFORE any
    // recorded dispatch (providerStatus "pending_provider"), the dispatch
    // below is safe: the derived reference IS the provider idempotency key
    // (providerDispatch.ts:7-9), so a provider that already holds the op
    // dedupes it.
    if (adopted) {
      const resolved = await resolveProviderTx({ transaction: txRow, client });
      txRow = resolved.transaction;
      if (txRow.status !== "pending") {
        const result: MemberCashOutResult = {
          reference,
          status: txRow.status,
          providerStatus: String(metaOf(txRow).providerStatus ?? txRow.status),
          amount: String(amountNGN),
          currency: "NGN",
          transactionId: txRow.id,
          failureReason: txRow.failureReason ?? null,
          resolution: resolved.resolution,
          idempotent: false,
        };
        await recordIdempotency(idempotencyKey, kind.journey, result, opts.idemPayload, idemScope);
        return result;
      }
      if (metaOf(txRow).providerStatus !== "pending_provider") {
        // Already dispatched (submitted / unknown_outcome): hold for the
        // provider lookup — do NOT dispatch again.
        const result: MemberCashOutResult = {
          reference,
          status: txRow.status,
          providerStatus: String(metaOf(txRow).providerStatus ?? txRow.status),
          amount: String(amountNGN),
          currency: "NGN",
          transactionId: txRow.id,
          failureReason: txRow.failureReason ?? null,
          resolution: resolved.resolution,
          idempotent: false,
        };
        await recordIdempotency(idempotencyKey, kind.journey, result, opts.idemPayload, idemScope);
        return result;
      }
      // else: never dispatched (crash before dispatch) — fall through.
    }

    const dispatch = await dispatchProviderOperation({
      ...client,
      path: kind.dispatchPath,
      reference,
      payload: opts.dispatchPayload,
    });
    const meta = metaOf(txRow);

    if (dispatch.outcome === "accepted") {
      const updated = await guardedUpdate(
        d,
        reference,
        {
          metadata: {
            ...meta,
            providerStatus: "submitted",
            providerRef: dispatch.providerRef ?? null,
          },
        },
        { status: "pending", providerStatus: "pending_provider" }
      );
      const finalRow = updated ?? (await rowByRef(d, reference)) ?? txRow;
      const result: MemberCashOutResult = {
        reference,
        status: finalRow.status,
        providerStatus: String(metaOf(finalRow).providerStatus ?? "submitted"),
        amount: String(amountNGN),
        currency: "NGN",
        transactionId: finalRow.id,
        failureReason: finalRow.failureReason ?? null,
        idempotent: false,
      };
      await recordIdempotency(idempotencyKey, kind.journey, result, opts.idemPayload, idemScope);
      return result;
    }

    if (dispatch.outcome === "rejected") {
      // Definitive rejection BEFORE any funds moved: mark failed loudly and
      // RELEASE the key so a corrected retry (new key → new reference) can run.
      await guardedUpdate(
        d,
        reference,
        {
          status: "failed",
          failureReason: dispatch.reason ?? "provider rejected cash-out",
          metadata: {
            ...meta,
            providerStatus: "rejected",
            providerError: dispatch.reason ?? null,
          },
        },
        { status: "pending", providerStatus: "pending_provider" }
      );
      logger.warn(`[MemberFunds] cash-out ${reference} rejected by provider: ${dispatch.reason}`);
      await releaseIdempotency(
        kind.journey,
        idempotencyKey,
        dispatch.reason ?? "provider rejected cash-out",
        idemScope
      );
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Mobile money provider rejected the cash-out: ${dispatch.reason}`,
      });
    }

    // Unknown outcome: provider may hold the debit — hold pending, resolve
    // via status lookup on retry. NEVER re-sent blindly.
    const updated = await guardedUpdate(
      d,
      reference,
      {
        metadata: {
          ...meta,
          providerStatus: "unknown_outcome",
          providerError: dispatch.reason ?? null,
        },
      },
      { status: "pending", providerStatus: "pending_provider" }
    );
    logger.error(
      `[MemberFunds] cash-out ${reference} outcome UNKNOWN (${dispatch.reason}) — held pending for status lookup, NOT re-sent`
    );
    const finalRow = updated ?? (await rowByRef(d, reference)) ?? txRow;
    const result: MemberCashOutResult = {
      reference,
      status: finalRow.status,
      providerStatus: "unknown_outcome",
      amount: String(amountNGN),
      currency: "NGN",
      transactionId: finalRow.id,
      failureReason: finalRow.failureReason ?? null,
      idempotent: false,
    };
    await recordIdempotency(idempotencyKey, kind.journey, result, opts.idemPayload, idemScope);
    return result;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    await releaseIdempotency(
      kind.journey,
      idempotencyKey,
      error instanceof Error ? error.message : String(error),
      idemScope
    );
    const idemError = asIdempotencyTrpcError(error);
    if (idemError) throw idemError;
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        `${kind.label} failed: ` +
        (error instanceof Error ? error.message : String(error)),
    });
  }
}
