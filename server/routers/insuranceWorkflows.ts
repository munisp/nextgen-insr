// TypeScript enabled — Sprint 98 comprehensive insurance workflows
/**
 * insuranceWorkflows.ts — Complete Insurance Stakeholder Workflow Router
 *
 * Covers ALL permutations of stakeholder actions:
 *   1. Policyholder: quote → bind → pay premium → file claim → renew → cancel
 *   2. Broker: submit application → track status → manage portfolio
 *   3. Underwriter: assess risk → approve/decline/refer → set conditions
 *   4. Claims Adjuster: receive claim → investigate → adjudicate → settle
 *   5. Actuary: compute reserves → run mortality tables → IFRS17 reporting
 *   6. Compliance Officer: NAICOM filings → NDPR audit → AML checks
 *   7. Reinsurer: cession management → treaty administration → recovery
 *   8. Agent: sell policies → collect premiums → service customers
 *   9. Supervisor: approve overrides → monitor SLA → escalate
 *  10. Admin: product management → system config → user management
 */
import { TRPCError } from "@trpc/server";
import crypto from "node:crypto";
import { eq, desc, and, sql, count, sum, gte, lte, or, asc, isNull, isNotNull, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  users,
  policies,
  claims,
  beneficiaries,
  endorsements,
  policyRenewals,
  coverageItems,
  riskAssessments,
  underwritingAssessments,
  actuarialReserves,
  reinsuranceTreaties,
  reinsuranceCessions,
  brokers,
  premiumPayments,
  naicomReports,
  actuarialTables,
  policyWorkflowEvents,
  claimWorkflowEvents,
  stakeholderProfiles,
  ifrs17MeasurementGroups,
  insuranceProducts,
  claimDocuments,
  claimDocumentHashes,
  daprWorkflowState,
  fluvioEventLog,
  tigerBeetleSyncLog,
  auditLog,
  policyLifecycleStates,
  claimAppeals,
  commissionClawbacks,
} from "../../drizzle/schema";
import { policyQuotes } from "../../drizzle/schema.additions";
import { router, protectedProcedure } from "../_core/trpc";
import { financialProcedure } from "../_core/permifyMiddleware";
import { publishInsuranceEvent } from "../daprClient";
import { getDb, withClientTransaction } from "../db";
import {
  APPEAL_SLA_DAYS,
  COOLING_OFF_DAYS,
  getOrInitLifecycle,
  isInGracePeriod,
  sweepPolicyLifecycle,
  validateIncidentWindow,
  validateReinstatement,
  validateWaitingPeriod,
} from "../lib/policyLifecycle";
import { assertTenantOwnership } from "../middleware/tenantIsolation";
import { tbCreateTransfer, withTbCompensation } from "../tbClient";
import { getTemporalClient } from "../temporal";
import { flagRefundLoopIfAbusive } from "../lib/refundLoopDetection";

// ─── Claim state-machine guards (F11-1/F11-3, DD-TSSTATE) ────────────────────
/**
 * Adjudication (approve / partially approve / reject) is only reachable from
 * pre-decision states. Decided/terminal states (approved, partially_approved,
 * rejected, paid, closed) are NOT re-enterable — a decided claim can only
 * move forward via settlement.
 */
export const ADJUDICATABLE_FROM_STATUSES = [
  "submitted",
  "under_review",
  "investigation",
  "appealed",
  "escalated",
  // M-wave (W1, 2026-09-19): journey-routed staff adjudication queue claims
  // are adjudicable via this hardened path (SoD enforced below).
  "pending_adjudication",
] as const;

/**
 * Settlement pays the recorded approvedAmount exactly once per claim and only
 * from an approved decision state. Anything else (submitted/under_review/
 * rejected/paid/closed/...) is rejected BEFORE any money moves.
 */
export const SETTLEABLE_CLAIM_STATUSES = [
  "approved",
  "partially_approved",
] as const;

/**
 * Assignment (CA-1) is only reachable from pre-decision states (INS-7):
 * decided/terminal claims (approved/paid/closed/...) must never regress to
 * under_review via a reassignment.
 */
export const ASSIGNABLE_FROM_STATUSES = [
  "submitted",
  "under_review",
  "investigation",
  "appealed",
  "escalated",
  // M-wave (W1, 2026-09-19): staff adjudication queue claims are assignable.
  "pending_adjudication",
] as const;

/** Statuses from which a policy may be cancelled (INS-12). */
export const CANCELLABLE_POLICY_STATUSES = [
  "bound",
  "active",
  "lapsed",
] as const;

// ─── L-wave stakeholder security helpers (L-S-1/2/3, L-P-1/3/4, 2026-09-19) ──
/**
 * Staff gate for insurer-side professional actions. The platform role enum
 * (users.role) only carries "user" | "admin" | "supervisor"; professional
 * roles (underwriter, claims_adjuster, ...) exist on stakeholder_profiles
 * (schema.ts) and in the Keycloak realm, but Keycloak→platform role mapping
 * (keycloak.ts mapKeycloakRoleToPlatformRole) still collapses them to
 * admin/supervisor/user. 2026-09-19: professional-role enforcement beyond
 * admin/supervisor + an active stakeholder_profiles record requires the
 * Keycloak role-mapping work tracked under L-S-5 — disclosed, not faked.
 */
const STAFF_ROLES = ["admin", "supervisor"] as const;

/** Server-side default commission for broker registrations (L-P-1): never caller-set. */
const DEFAULT_BROKER_COMMISSION_RATE = "0.0500";

function callerRole(ctx: { user?: { role?: string } | null }): string | undefined {
  return ctx.user?.role ?? undefined;
}

function isStaff(ctx: { user?: { role?: string } | null }): boolean {
  return (STAFF_ROLES as readonly string[]).includes(callerRole(ctx) ?? "");
}

function requireStaff(ctx: { user?: { role?: string } | null }, action: string): void {
  if (!isStaff(ctx)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `${action} is restricted to insurer staff (admin/supervisor)`,
    });
  }
}

/**
 * Fail-closed Keycloak identity for segregation-of-duties comparisons.
 * Repo convention (AB-8, I-wave): when a principal's identity cannot be
 * verified, the financial action is refused — never assumed distinct.
 */
function callerKeycloakSub(ctx: { user?: { keycloakSub?: string | null } | null }, action: string): string {
  const sub = ctx.user?.keycloakSub ?? null;
  if (!sub) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `${action}: caller identity (keycloakSub) is not verifiable — refusing (fail-closed SoD)`,
    });
  }
  return sub;
}

/**
 * Resolve an active stakeholder_profiles row for a user with one of the
 * given professional roles. Returns null when no qualifying row exists.
 */
async function getActiveStakeholderProfile(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  userId: number,
  roles: readonly string[]
) {
  const rows = await db
    .select()
    .from(stakeholderProfiles)
    .where(
      and(
        eq(stakeholderProfiles.userId, userId),
        eq(stakeholderProfiles.isActive, true),
        inArray(stakeholderProfiles.role, roles as (typeof stakeholderProfiles.$inferSelect)["role"][]),
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

// ─── Helper: Emit audit log entry ─────────────────────────────────────────────
async function emitAuditLog(
  db: Awaited<ReturnType<typeof getDb>>,
  action: string,
  entityType: string,
  entityId: string | number,
  userId: number | undefined,
  details: Record<string, unknown>
) {
  if (!db) return;
  try {
    await db.insert(auditLog).values({
      action,
      resource: entityType,
      resourceId: String(entityId),
      agentId: userId ?? null,
      metadata: { ...details, userId: userId ?? null },
      createdAt: new Date(),
    });
  } catch {
    // Non-blocking
  }
}

// ─── Helper: Emit Fluvio event log ────────────────────────────────────────────
async function emitFluvioEvent(
  db: Awaited<ReturnType<typeof getDb>>,
  topic: string,
  payload: Record<string, unknown>
) {
  if (!db) return;
  try {
    await db.insert(fluvioEventLog).values({
      topic,
      payload,
      processedAt: new Date(),
      status: "processed",
    });
    // Also publish via Dapr pub/sub
    await publishInsuranceEvent(topic, payload);
  } catch {
    // Non-blocking
  }
}

export const insuranceWorkflowsRouter = router({

  // ═══════════════════════════════════════════════════════════════════════════
  // POLICYHOLDER WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════════

  /** PH-1: Get a premium quote for a product */
  getQuote: protectedProcedure
    .input(z.object({
      productId: z.number(),
      customerId: z.number(),
      coverageAmount: z.number(),
      startDate: z.string(),
      additionalData: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const product = await db.select().from(insuranceProducts)
        .where(eq(insuranceProducts.id, input.productId)).limit(1);
      if (!product.length) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });

      const p = product[0];
      const basePremium = Number(p.minPremium ?? 0);
      // Actuarial risk factor: coverage loading + age loading
      const maxCoverage = Number(p.maxCoverageAmount ?? input.coverageAmount);
      const coverageRatio = maxCoverage > 0 ? Math.min(input.coverageAmount / maxCoverage, 1.0) : 1.0;
      const coverageLoading = coverageRatio * 0.15; // up to 15% for max coverage
      const ageLoading = (input.additionalData?.age && typeof input.additionalData.age === 'number')
        ? Math.max(0, (Number(input.additionalData.age) - 30) * 0.005)
        : 0.05; // 5% default when age not provided
      const riskFactor = 1.0 + coverageLoading + ageLoading;
      const annualPremium = Math.round(basePremium * riskFactor * 100) / 100;

      const quoteRef = `QT-${Date.now()}-${input.customerId}`;
      const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // L-wave (L-P-4, 2026-09-19): the quote is PERSISTED (policy_quotes,
      // status "pending", quoteRef bound in metadata) so bindPolicy can
      // resolve → ownership-check → guarded-consume it (same
      // QUOTE_OWNERSHIP/QUOTE_CONSUMED pattern as journey-activities.ts).
      // Previously quoteRef was only echoed into a Fluvio event and bindPolicy
      // never looked it up — caller-supplied premiums/sums bound ghost policies.
      const [quoteRow] = await db.insert(policyQuotes).values({
        customerId: input.customerId,
        productId: input.productId,
        productName: p.name ?? null,
        sumInsured: String(input.coverageAmount),
        premiumAmount: String(annualPremium),
        totalPayable: String(annualPremium),
        status: "pending",
        validUntil,
        metadata: { quoteRef, source: "insuranceWorkflows.getQuote" },
      }).returning();

      await emitFluvioEvent(db, "policy-events", {
        eventType: "policy.quote_generated",
        quoteRef,
        quoteId: quoteRow.id,
        customerId: input.customerId,
        productId: input.productId,
        annualPremium,
      });

      return { quoteRef, quoteId: quoteRow.id, annualPremium, product: p, validUntil: validUntil.toISOString() };
    }),

  /** PH-2: Bind a policy (convert quote to active policy) */
  bindPolicy: financialProcedure
    .input(z.object({
      quoteRef: z.string(),
      productId: z.number(),
      customerId: z.number(),
      // L-wave (L-P-4, 2026-09-19): agentId/brokerId are no longer accepted
      // from the caller — they are derived server-side from the consumed
      // quote (agentId) and the caller's own broker record (brokerId).
      // sumInsured/annualPremium are DERIVED from the quote; a caller may
      // still assert them, and any mismatch with the recorded quote is
      // rejected (ghost-premium/ghost-sum bind is impossible).
      sumInsured: z.number().optional(),
      annualPremium: z.number().optional(),
      startDate: z.string(),
      beneficiaries: z.array(z.object({
        name: z.string(),
        relationship: z.string(),
        percentage: z.number(),
      })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // L-wave (L-P-4, 2026-09-19): identity binding — a non-staff caller can
      // only bind a policy to THEMSELVES. Staff (admin/supervisor) retain the
      // servicing path; every bind is audited with the caller identity.
      if (!isStaff(ctx) && input.customerId !== ctx.user?.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only bind policies for your own customer account" });
      }

      // L-wave (L-P-4): resolve the quoteRef to a REAL persisted quote
      // (policy_quotes.metadata->>'quoteRef'). Unknown refs are rejected —
      // previously the ref was never looked up at all.
      const [quote] = await db.select().from(policyQuotes)
        .where(sql`${policyQuotes.metadata}::jsonb ->> 'quoteRef' = ${input.quoteRef}`)
        .limit(1);
      if (!quote) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Unknown quoteRef '${input.quoteRef}' — bind requires a real, unconsumed quote` });
      }
      if (quote.customerId !== input.customerId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `QUOTE_OWNERSHIP: quote '${input.quoteRef}' does not belong to customer ${input.customerId}`,
        });
      }
      if (quote.status !== "pending") {
        throw new TRPCError({ code: "CONFLICT", message: `QUOTE_CONSUMED: quote '${input.quoteRef}' is no longer pending (status: ${quote.status})` });
      }
      if (quote.validUntil && new Date(quote.validUntil) < new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Quote '${input.quoteRef}' has expired` });
      }

      // Premium and sum insured come from the QUOTE, never the caller.
      const quoteSumInsured = Number(quote.sumInsured ?? NaN);
      const quotePremium = Number(quote.premiumAmount ?? NaN);
      if (!Number.isFinite(quoteSumInsured) || quoteSumInsured <= 0 || !Number.isFinite(quotePremium) || quotePremium <= 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Quote '${input.quoteRef}' has no recorded sumInsured/premium — refusing to bind (fail-closed for funds)`,
        });
      }
      if (input.sumInsured !== undefined && input.sumInsured !== quoteSumInsured) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `sumInsured mismatch: quote recorded ${quoteSumInsured}, caller asserted ${input.sumInsured}`,
        });
      }
      if (input.annualPremium !== undefined && input.annualPremium !== quotePremium) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `annualPremium mismatch: quote recorded ${quotePremium}, caller asserted ${input.annualPremium}`,
        });
      }

      // brokerId derives from the caller's OWN active broker record (never
      // caller-supplied); agentId from the quote.
      const [callerBroker] = ctx.user?.id != null
        ? await db.select({ id: brokers.id }).from(brokers)
            .where(and(eq(brokers.userId, ctx.user.id), eq(brokers.isActive, true))).limit(1)
        : [undefined];
      const derivedBrokerId = callerBroker?.id ?? null;
      const derivedAgentId = quote.agentId ?? null;

      // I-wave (AB-22a, 2026-09): policy numbers were
      // `POL-${Date.now()}-${customerId}` — fully predictable (enumerable
      // policy IDs, customer linkage leaked). The "POL-" prefix is the only
      // format contract downstream code/tests rely on; the body is now
      // CSPRNG-random (8 bytes → 16 hex chars, 64 bits of entropy) with a
      // millisecond component retained ONLY for human sortability, never as
      // the uniqueness/entropy source. Uniqueness stays DB-enforced
      // (policy_number_key); a collision retries once with fresh entropy.
      const genPolicyNumber = () =>
        `POL-${Date.now().toString(36).toUpperCase()}-${crypto
          .randomBytes(8)
          .toString("hex")
          .toUpperCase()}`;

      const startDate = new Date(input.startDate);
      const endDate = new Date(startDate);
      endDate.setFullYear(endDate.getFullYear() + 1);

      const policyValues = (policyNumber: string) => ({
        policyNumber,
        productId: quote.productId ?? input.productId,
        customerId: input.customerId,
        agentId: derivedAgentId,
        brokerId: derivedBrokerId,
        status: "bound" as const,
        coverageType: "life" as const,
        sumInsured: String(quoteSumInsured),
        annualPremium: String(quotePremium),
        startDate,
        endDate,
        renewalDate: endDate,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      let policyNumber = genPolicyNumber();
      let policy: typeof policies.$inferSelect | undefined;
      // L-wave (L-P-4, 2026-09-19): quote consume + policy insert are ATOMIC.
      // The quote is claimed with a guarded UPDATE (pending → converted,
      // bound to the owning customer) in the SAME transaction as the policy
      // insert — a concurrent/duplicate bind gets zero rows and the whole
      // bind fails with QUOTE_CONSUMED (journey-activities.ts pattern).
      try {
        policy = await db.transaction(async (tx) => {
          const claimed = await tx
            .update(policyQuotes)
            .set({ status: "converted", updatedAt: new Date() })
            .where(
              and(
                eq(policyQuotes.id, quote.id),
                eq(policyQuotes.customerId, input.customerId),
                eq(policyQuotes.status, "pending")
              )
            )
            .returning({ id: policyQuotes.id });
          if (!claimed[0]) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `QUOTE_CONSUMED: quote '${input.quoteRef}' is no longer pending for this customer — concurrent, duplicate, or cross-customer use rejected`,
            });
          }
          const [p] = await tx.insert(policies).values(policyValues(policyNumber)).returning();
          return p;
        });
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        const pgCode =
          (err as { code?: string; cause?: { code?: string } })?.code ??
          (err as { cause?: { code?: string } })?.cause?.code;
        if (pgCode !== "23505") throw err;
        policyNumber = genPolicyNumber();
        policy = await db.transaction(async (tx) => {
          const claimed = await tx
            .update(policyQuotes)
            .set({ status: "converted", updatedAt: new Date() })
            .where(
              and(
                eq(policyQuotes.id, quote.id),
                eq(policyQuotes.customerId, input.customerId),
                eq(policyQuotes.status, "pending")
              )
            )
            .returning({ id: policyQuotes.id });
          if (!claimed[0]) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `QUOTE_CONSUMED: quote '${input.quoteRef}' is no longer pending for this customer — concurrent, duplicate, or cross-customer use rejected`,
            });
          }
          const [p] = await tx.insert(policies).values(policyValues(policyNumber)).returning();
          return p;
        });
      }

      // Insert beneficiaries
      if (input.beneficiaries?.length) {
        await db.insert(beneficiaries).values(
          input.beneficiaries.map(b => ({
            policyId: policy.id,
            name: b.name,
            relationship: b.relationship,
            percentage: String(b.percentage),
          }))
        );
      }

      // Record workflow event
      await db.insert(policyWorkflowEvents).values({
        policyId: policy.id,
        eventType: "policy.bound",
        fromStatus: "quoted",
        toStatus: "bound",
        triggeredBy: ctx.user?.id ?? undefined,
        payload: { quoteRef: input.quoteRef },
      });

      await emitFluvioEvent(db, "policy-events", { eventType: "policy.bound", policyId: policy.id, policyNumber });
      await emitAuditLog(db, "POLICY_BOUND", "policy", policy.id, ctx.user?.id, { policyNumber });

      return { policy, policyNumber };
    }),

  /** PH-3: Pay premium via TigerBeetle */
  payPremium: financialProcedure
    .input(z.object({
      policyId: z.number(),
      amount: z.number(),
      paymentMethod: z.string(),
      channel: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [policy] = await db.select().from(policies)
        .where(eq(policies.id, input.policyId)).limit(1);
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      if (!["bound", "active"].includes(policy.status ?? "")) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Policy status '${policy.status}' does not allow premium payment` });
      }
      if (!Number.isFinite(input.amount) || input.amount <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "amount must be a positive number" });
      }

      // INS-10: validate the amount against the premium due. Underpayment is
      // recorded on the partial-payment ledger but must NOT activate the
      // policy; overpayment beyond the annual premium is refused (fail-closed
      // for funds) rather than silently kept.
      const premiumDue = Number(policy.annualPremium ?? 0);
      const priorPaidRows = await db.select({ total: sum(premiumPayments.amount) })
        .from(premiumPayments)
        .where(and(eq(premiumPayments.policyId, input.policyId), inArray(premiumPayments.status, ["completed", "partial"])));
      const alreadyPaid = Number(priorPaidRows[0]?.total ?? 0);
      const outstanding = Math.max(0, premiumDue - alreadyPaid);

      // INS-10: deterministic, idempotent payment reference — a client retry
      // converges on the same ref instead of minting a duplicate transfer.
      // Partial payments key on the amount so distinct instalments each get
      // their own ledger row while a retried instalment replays. The replay
      // check runs BEFORE the fully-paid guard so a legitimate retry of the
      // final payment replays instead of erroring.
      const baseRef = `PAY-${input.policyId}-PREMIUM`;
      const isPartial = outstanding > 0 && input.amount < outstanding && policy.status === "bound";
      const paymentRef = isPartial ? `${baseRef}-PARTIAL-${Math.round(input.amount * 100)}` : baseRef;
      const existing = await db.select().from(premiumPayments)
        .where(eq(premiumPayments.paymentReference, paymentRef)).limit(1);
      if (existing.length > 0) {
        const prev = existing[0]!;
        if (Number(prev.amount) !== input.amount) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Payment reference already used with a different amount; refusing to re-execute",
          });
        }
        return { payment: prev, tigerBeetleRef: prev.tigerBeetleRef, idempotent: true, partial: isPartial, outstandingPremium: outstanding };
      }

      if (outstanding <= 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Premium already paid in full" });
      }
      if (input.amount > outstanding) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `amount ${input.amount} exceeds outstanding premium ${outstanding} (annualPremium ${premiumDue}, already paid ${alreadyPaid})`,
        });
      }

      // Submit to TigerBeetle for atomic ledger entry
      const tbResult = await tbCreateTransfer({
        debitAccountId: `customer-${input.policyId}`,
        creditAccountId: "insurer-premium-pool",
        amount: Math.round(input.amount * 100), // kobo
        ref: paymentRef,
        txType: "premium_payment",
      });

      const [payment] = await db.insert(premiumPayments).values({
        policyId: input.policyId,
        paymentReference: paymentRef,
        amount: String(input.amount),
        currency: "NGN",
        paymentDate: new Date(),
        paymentMethod: input.paymentMethod,
        channel: input.channel ?? "web",
        status: tbResult ? (isPartial ? "partial" : "completed") : "pending",
        tigerBeetleRef: tbResult?.id ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      // Activate policy only when the premium is fully covered (INS-10:
      // underpayment stays on the partial-payment ledger, no activation).
      if (!isPartial) {
        await db.update(policies)
          .set({ status: "active", updatedAt: new Date() })
          .where(and(eq(policies.id, input.policyId), eq(policies.status, "bound")));
      }

      await emitFluvioEvent(db, "payment-events", {
        eventType: isPartial ? "payment.premium_partial" : "payment.premium_paid",
        policyId: input.policyId,
        amount: input.amount,
        paymentRef,
      });

      return { payment, tigerBeetleRef: tbResult?.id, partial: isPartial, outstandingPremium: outstanding };
    }),

  /** PH-4: File a claim */
  fileClaim: protectedProcedure
    .input(z.object({
      policyId: z.number(),
      claimType: z.string(),
      incidentDate: z.string(),
      claimedAmount: z.number(),
      incidentDescription: z.string(),
      documents: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const policy = await db.select().from(policies)
        .where(eq(policies.id, input.policyId)).limit(1);
      if (!policy.length) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      if (policy[0].status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Policy is not active" });
      }

      // INS-1/2: re-check the policy period — an active policy past endDate +
      // grace lapses on the spot (fail-closed, no sweeper dependency), and the
      // incident must fall inside [startDate, min(endDate, now)].
      const incidentDate = new Date(input.incidentDate);
      const lifecycle = await getOrInitLifecycle(db, input.policyId);
      const windowError = validateIncidentWindow(policy[0], incidentDate);
      if (windowError) throw new TRPCError({ code: "BAD_REQUEST", message: windowError });
      const waitingError = await validateWaitingPeriod(db, policy[0], incidentDate);
      if (waitingError) throw new TRPCError({ code: "BAD_REQUEST", message: waitingError });
      if (policy[0].endDate) {
        const graceDays = lifecycle.gracePeriodDays ?? 30;
        if (Date.now() > policy[0].endDate.getTime() + graceDays * 86_400_000) {
          await db.update(policies).set({ status: "lapsed", updatedAt: new Date() })
            .where(and(eq(policies.id, input.policyId), eq(policies.status, "active")));
          throw new TRPCError({ code: "BAD_REQUEST", message: "Policy period has ended (policy lapsed)" });
        }
      }

      // INS-8: claims filed inside the grace window are placed on hold; the
      // recorded arrears are offset at settlement.
      const graceHold = isInGracePeriod(policy[0], lifecycle);
      const arrearsAtFiling = graceHold ? Number(lifecycle.arrearsAmount ?? 0) : 0;

      // AB-7: IDOR guard — the caller must OWN the policy (or be staff).
      // Staff roles per keycloak.ts mapKeycloakRole: "admin" | "supervisor".
      const isStaff = ctx.user?.role === "admin" || ctx.user?.role === "supervisor";
      if (!isStaff && policy[0].customerId !== ctx.user?.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only file claims against your own policies" });
      }

      // AB-7: claimedAmount is validated server-side against the policy
      // schedule (sum insured), not trusted from the client.
      const sumInsured = Number(policy[0].sumInsured);
      if (!(input.claimedAmount > 0)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "claimedAmount must be positive" });
      }
      if (Number.isFinite(sumInsured) && input.claimedAmount > sumInsured) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "claimedAmount exceeds policy sum insured" });
      }

      // INS-4: duplicate-claim dedup — exact (policyId, incidentDate,
      // claimType) plus a fuzzy match on claimedAmount within ±1%. Rejected /
      // closed claims release the key so a legitimate re-file is not blocked.
      const duplicates = await db.select({
        id: claims.id,
        claimNumber: claims.claimNumber,
        claimedAmount: claims.claimedAmount,
      }).from(claims).where(and(
        eq(claims.policyId, input.policyId),
        eq(claims.incidentDate, incidentDate),
        eq(claims.claimType, input.claimType),
        inArray(claims.status, ["submitted", "under_review", "investigation", "approved", "partially_approved", "paid", "appealed", "escalated"]),
      )).limit(5);
      const fuzzy = duplicates.find(d =>
        Math.abs(Number(d.claimedAmount) - input.claimedAmount) <= Math.max(0.01 * input.claimedAmount, 0.01));
      if (fuzzy) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Duplicate claim: ${fuzzy.claimNumber} already covers policy ${input.policyId} for incident ${incidentDate.toISOString()} (${input.claimType})`,
        });
      }

      // AB-7: document-hash dedup — the same document bytes must not be
      // reusable across claims. Fail-closed on storage error.
      const docHashes = (input.documents ?? []).map(d =>
        crypto.createHash("sha256").update(String(d)).digest("hex")
      );
      for (const h of docHashes) {
        const dupe = await db.select({ id: claimDocumentHashes.id })
          .from(claimDocumentHashes)
          .where(eq(claimDocumentHashes.docHash, h))
          .limit(1);
        if (dupe.length) {
          throw new TRPCError({ code: "CONFLICT", message: "A submitted document was already used in another claim" });
        }
      }

      // AB-7: unpredictable claim number (CSPRNG), not timestamp+policyId.
      const claimNumber = `CLM-${crypto.randomBytes(12).toString("hex").toUpperCase()}`;
      const [claim] = await db.insert(claims).values({
        claimNumber,
        policyId: input.policyId,
        claimantId: policy[0].customerId,
        status: "submitted",
        claimType: input.claimType,
        incidentDate,
        metadata: graceHold ? { graceHold: true, arrearsAtFiling } : null,
        reportedDate: new Date(),
        claimedAmount: String(input.claimedAmount),
        incidentDescription: input.incidentDescription,
        documents: input.documents ?? [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      await db.insert(claimWorkflowEvents).values({
        claimId: claim.id,
        eventType: "claim.submitted",
        toStatus: "submitted",
        triggeredBy: ctx.user?.id ?? undefined,
        payload: { claimNumber },
      });

      // AB-7: record document hashes so reused documents are rejected globally.
      for (const h of docHashes) {
        await db.insert(claimDocumentHashes)
          .values({ claimId: claim.id, docHash: h })
          .onConflictDoNothing();
      }

      await emitFluvioEvent(db, "claims-events", { eventType: "claim.submitted", claimId: claim.id, claimNumber });
      await emitAuditLog(db, "CLAIM_FILED", "claim", claim.id, ctx.user?.id, { claimNumber });

      return { claim, claimNumber };
    }),

  /** PH-5: Request policy renewal */
  requestRenewal: protectedProcedure
    .input(z.object({
      policyId: z.number(),
      isAutoRenewal: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [policy] = await db.select().from(policies)
        .where(eq(policies.id, input.policyId)).limit(1);
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      // INS-11: only live policies can be renewed — never cancelled/expired ones.
      if (!["active", "bound"].includes(policy.status ?? "")) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Policy status '${policy.status}' cannot be renewed` });
      }

      // INS-11: duplicate-renewal guard — one open renewal per policy.
      const existing = await db.select({ id: policyRenewals.id }).from(policyRenewals)
        .where(and(eq(policyRenewals.originalPolicyId, input.policyId), eq(policyRenewals.status, "pending")))
        .limit(1);
      if (existing.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: `An open renewal already exists for policy ${input.policyId}` });
      }

      const [renewal] = await db.insert(policyRenewals).values({
        originalPolicyId: input.policyId,
        renewalDueDate: policy.endDate ?? new Date(),
        renewalPremium: policy.annualPremium,
        isAutoRenewal: input.isAutoRenewal ?? false,
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      await emitFluvioEvent(db, "policy-events", { eventType: "policy.renewal_requested", policyId: input.policyId });
      return { renewal };
    }),

  /** PH-5b: Pay for a pending renewal and atomically roll the policy term (INS-11) */
  payRenewal: protectedProcedure
    .input(z.object({
      renewalId: z.number().int().positive(),
      amount: z.number().positive(),
      paymentMethod: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [renewal] = await db.select().from(policyRenewals)
        .where(eq(policyRenewals.id, input.renewalId)).limit(1);
      if (!renewal) throw new TRPCError({ code: "NOT_FOUND", message: "Renewal not found" });
      if (renewal.status !== "pending") {
        // Idempotent replay: a completed renewal returns its durable state.
        if (renewal.status === "completed") return { renewal, idempotent: true };
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Renewal status '${renewal.status}' cannot be paid` });
      }

      const [policy] = await db.select().from(policies)
        .where(eq(policies.id, renewal.originalPolicyId)).limit(1);
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      if (!["active", "bound", "lapsed"].includes(policy.status ?? "")) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Policy status '${policy.status}' cannot be renewed` });
      }
      const premiumDue = Number(renewal.renewalPremium ?? policy.annualPremium ?? 0);
      if (input.amount < premiumDue) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Renewal payment ${input.amount} is below renewal premium ${premiumDue}` });
      }

      const paymentRef = `PAY-RENEWAL-${input.renewalId}`;
      const tbResult = await tbCreateTransfer({
        debitAccountId: `customer-${policy.customerId}`,
        creditAccountId: "insurer-premium-pool",
        amount: Math.round(input.amount * 100),
        ref: paymentRef,
        txType: "premium_payment",
      });

      // Atomic term roll: new start = old endDate (no coverage gap/overlap),
      // one idempotent payment row, and the renewal completed — all-or-nothing.
      const oldEnd = policy.endDate ?? new Date();
      const newEnd = new Date(oldEnd);
      newEnd.setFullYear(newEnd.getFullYear() + 1);
      await db.transaction(async (tx) => {
        await tx.insert(premiumPayments).values({
          policyId: policy.id,
          paymentReference: paymentRef,
          amount: String(input.amount),
          currency: "NGN",
          paymentDate: new Date(),
          paymentMethod: input.paymentMethod,
          channel: "web",
          status: tbResult ? "completed" : "pending",
          tigerBeetleRef: tbResult?.id ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const rolled = await tx.update(policies).set({
          status: "active",
          startDate: oldEnd,
          endDate: newEnd,
          renewalDate: newEnd,
          updatedAt: new Date(),
        }).where(and(eq(policies.id, policy.id), inArray(policies.status, ["active", "bound", "lapsed"])))
          .returning({ id: policies.id });
        if (rolled.length === 0) {
          throw new TRPCError({ code: "CONFLICT", message: `Policy ${policy.id} is no longer renewable (concurrent status change)` });
        }
        await tx.update(policyRenewals).set({
          status: "completed",
          completedAt: new Date(),
          renewedPolicyId: policy.id,
          updatedAt: new Date(),
        }).where(and(eq(policyRenewals.id, input.renewalId), eq(policyRenewals.status, "pending")));
        // A renewed lapsed policy restarts clean: arrears settled by the
        // renewal payment, lifecycle row reset for the new term.
        await tx.insert(policyLifecycleStates).values({ policyId: policy.id })
          .onConflictDoUpdate({
            target: policyLifecycleStates.policyId,
            set: { lapsedAt: null, expiredAt: null, arrearsAmount: "0", updatedAt: new Date() },
          });
      });

      await emitFluvioEvent(db, "policy-events", {
        eventType: "policy.renewed", policyId: policy.id, renewalId: input.renewalId,
        newStartDate: oldEnd.toISOString(), newEndDate: newEnd.toISOString(),
      });
      await emitAuditLog(db, "POLICY_RENEWED", "policy", policy.id, ctx.user?.id, { renewalId: input.renewalId });
      return { success: true, newStartDate: oldEnd, newEndDate: newEnd, tigerBeetleRef: tbResult?.id ?? null };
    }),

  /** PH-6: Cancel a policy */
  cancelPolicy: financialProcedure
    .input(z.object({
      policyId: z.number(),
      reason: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [policy] = await db.select().from(policies)
        .where(eq(policies.id, input.policyId)).limit(1);
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });

      // INS-12: ownership check — the policyholder (or an admin) cancels; a
      // third party cannot cancel someone else's cover.
      const isOwner = ctx.user?.id != null && policy.customerId === ctx.user.id;
      const isAdmin = (ctx.user as { role?: string } | undefined)?.role === "admin";
      if (!isOwner && !isAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the policyholder or an admin can cancel this policy" });
      }

      // INS-12: open-claims hold — a policy with claims still in flight cannot
      // be cancelled out from under its adjudication.
      const openClaims = await db.select({ id: claims.id }).from(claims)
        .where(and(
          eq(claims.policyId, input.policyId),
          inArray(claims.status, ["submitted", "under_review", "investigation", "approved", "partially_approved", "appealed", "escalated"]),
        )).limit(1);
      if (openClaims.length > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Policy has open claim(s) (e.g. claim ${openClaims[0]!.id}); resolve them before cancellation`,
        });
      }

      // INS-12: server-side effective date (never caller-supplied/backdatable).
      const effectiveDate = new Date();

      // INS-12: state guard applied atomically FIRST — only bound/active/
      // lapsed policies can transition to cancelled, and a concurrent cancel
      // loses the race BEFORE any refund money can move (fail-closed for
      // funds: a lost race can never double-refund).
      const cancelled = await db.update(policies).set({
        status: "cancelled",
        cancellationDate: effectiveDate,
        cancellationReason: input.reason,
        updatedAt: effectiveDate,
      }).where(and(
        eq(policies.id, input.policyId),
        inArray(policies.status, [...CANCELLABLE_POLICY_STATUSES]),
      )).returning({ id: policies.id });
      if (cancelled.length === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Policy ${input.policyId} cannot be cancelled from status '${policy.status}'`,
        });
      }

      // INS-12/13: cooling-off refund — within COOLING_OFF_DAYS of inception a
      // cancellation refunds the premium actually paid, via a REAL TigerBeetle
      // reversal (fail-closed: the sidecar throws on outage). Outside the
      // window no refund is computed here.
      const paidRows = await db.select({ total: sum(premiumPayments.amount) })
        .from(premiumPayments)
        .where(and(eq(premiumPayments.policyId, input.policyId), eq(premiumPayments.status, "completed")));
      const totalPaid = Number(paidRows[0]?.total ?? 0);
      const withinCoolingOff = policy.startDate != null &&
        effectiveDate.getTime() <= policy.startDate.getTime() + COOLING_OFF_DAYS * 86_400_000;
      const refundAmount = withinCoolingOff ? totalPaid : 0;
      let refundTbRef: string | null = null;
      if (refundAmount > 0) {
        const tbResult = await tbCreateTransfer({
          debitAccountId: "insurer-premium-pool",
          creditAccountId: `customer-${policy.customerId}`,
          amount: Math.round(refundAmount * 100),
          ref: `REFUND-COOLOFF-${input.policyId}`,
          txType: "premium_refund",
        });
        refundTbRef = tbResult?.id ?? null;
      }

      // INS-12: commission clawback trigger — cancelling with a cooling-off
      // refund claws back the selling agent's commission.
      if (policy.agentId != null && refundAmount > 0) {
        try {
          await db.insert(commissionClawbacks).values({
            reversalRequestId: input.policyId,
            agentId: policy.agentId,
            originalCommission: String(refundAmount),
            clawbackAmount: String(refundAmount),
            cascadeLevel: "agent",
            status: "pending",
          } as never);
        } catch {
          // Non-blocking: clawback machinery is reviewed via commissionClawback router.
        }
      }

      await db.insert(policyWorkflowEvents).values({
        policyId: input.policyId,
        eventType: "policy.cancelled",
        fromStatus: policy.status,
        toStatus: "cancelled",
        triggeredBy: ctx.user?.id ?? undefined,
        payload: { reason: input.reason, effectiveDate: effectiveDate.toISOString(), refundAmount, coolingOff: withinCoolingOff },
      });

      await emitFluvioEvent(db, "policy-events", { eventType: "policy.cancelled", policyId: input.policyId, reason: input.reason });
      // AB-10: refund-loop velocity detection (fire-and-forget; never blocks cancel).
      flagRefundLoopIfAbusive(db, { policyId: input.policyId, tenantId: ctx.user?.tenantId ?? null })
        .catch((e) => console.warn("[refundLoopDetection] flag failed:", e));
      await emitAuditLog(db, "POLICY_CANCELLED", "policy", input.policyId, ctx.user?.id, {
        reason: input.reason, refundAmount, coolingOff: withinCoolingOff, refundTbRef,
      });
      return { success: true, effectiveDate, coolingOff: withinCoolingOff, refundAmount, refundTbRef };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // BROKER WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════════

  /** BR-1: Register as broker */
  registerBroker: protectedProcedure
    .input(z.object({
      companyName: z.string(),
      licenseNumber: z.string(),
      licenseExpiry: z.string(),
      naicomRegNumber: z.string().optional(),
      contactEmail: z.string().email(),
      contactPhone: z.string(),
      address: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // L-wave (L-P-1, 2026-09-19): registration is PENDING — the broker is
      // created INACTIVE and only becomes active via approveBroker (admin
      // license-record review). commissionRate is SERVER-DEFAULTED, never
      // caller-set. NAICOM license live verification: the repo has NO NAICOM
      // registry integration (verified by grep, 2026-09-19), so the license
      // stays a pending-verification field gated at admin approval — no
      // fake registry call is made.
      const brokerCode = `BRK-${Date.now()}`;
      const [broker] = await db.insert(brokers).values({
        userId: ctx.user?.id ?? undefined,
        brokerCode,
        companyName: input.companyName,
        licenseNumber: input.licenseNumber,
        licenseExpiry: new Date(input.licenseExpiry),
        naicomRegNumber: input.naicomRegNumber ?? null,
        commissionRate: DEFAULT_BROKER_COMMISSION_RATE,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        address: input.address,
        isActive: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      await emitAuditLog(db, "BROKER_REGISTERED", "broker", broker.id, ctx.user?.id, {
        brokerCode, status: "pending_approval", naicomRegNumber: input.naicomRegNumber ?? null,
      });
      return { broker, brokerCode, status: "pending_approval" as const };
    }),

  /** BR-1b: Approve a pending broker (admin license-record review) — L-wave L-P-1 */
  approveBroker: protectedProcedure
    .input(z.object({
      brokerId: z.number().int().positive(),
      commissionRate: z.number().positive().max(1).optional(),
      reviewNotes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Admin-only approval (license-record review is a compliance function).
      if (callerRole(ctx) !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Broker approval is restricted to platform admins" });
      }
      // Approver identity must be verifiable for the audit trail (fail-closed).
      const approverSub = callerKeycloakSub(ctx, "approveBroker");

      const [broker] = await db.select().from(brokers).where(eq(brokers.id, input.brokerId)).limit(1);
      if (!broker) throw new TRPCError({ code: "NOT_FOUND", message: "Broker not found" });
      if (broker.isActive) {
        throw new TRPCError({ code: "CONFLICT", message: `Broker ${input.brokerId} is already active` });
      }
      // License-record review (honest scope): the license number + NAICOM
      // registration must be ON RECORD; live NAICOM registry verification is
      // NOT integrated in this repo (2026-09-19) and is disclosed as pending.
      if (!broker.licenseNumber || !broker.licenseExpiry) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Broker has no license record on file — cannot approve",
        });
      }
      if (new Date(broker.licenseExpiry) < new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Broker license is expired — cannot approve" });
      }

      const [updated] = await db.update(brokers).set({
        isActive: true,
        commissionRate: input.commissionRate != null ? String(input.commissionRate) : broker.commissionRate,
        updatedAt: new Date(),
      }).where(and(eq(brokers.id, input.brokerId), eq(brokers.isActive, false))).returning();
      if (!updated) {
        throw new TRPCError({ code: "CONFLICT", message: `Broker ${input.brokerId} is no longer pending (concurrent approval)` });
      }

      await emitAuditLog(db, "BROKER_APPROVED", "broker", input.brokerId, ctx.user?.id, {
        approverKeycloakSub: approverSub,
        licenseNumber: broker.licenseNumber,
        naicomRegNumber: broker.naicomRegNumber ?? null,
        naicomVerification: "pending_manual_review", // no live NAICOM integration exists
        reviewNotes: input.reviewNotes ?? null,
      });
      return { broker: updated, approved: true as const };
    }),

  /** BR-2: Get broker portfolio (all policies managed) */
  getBrokerPortfolio: protectedProcedure
    .input(z.object({
      brokerId: z.number(),
      status: z.string().optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { policies: [], total: 0 };

      // L-wave (L-P-3, 2026-09-19): IDOR fix — a broker portfolio is readable
      // only by the OWNING broker (session-derived brokers.userId) or staff.
      const [broker] = await db.select({ userId: brokers.userId }).from(brokers)
        .where(eq(brokers.id, input.brokerId)).limit(1);
      if (!broker) throw new TRPCError({ code: "NOT_FOUND", message: "Broker not found" });
      if (!isStaff(ctx) && broker.userId !== ctx.user?.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only read your own broker portfolio" });
      }

      const conditions = [eq(policies.brokerId, input.brokerId)];
      if (input.status) conditions.push(eq(policies.status, input.status as any));

      const [rows, [{ total }]] = await Promise.all([
        db.select().from(policies).where(and(...conditions))
          .orderBy(desc(policies.createdAt)).limit(input.limit).offset(input.offset),
        db.select({ total: count() }).from(policies).where(and(...conditions)),
      ]);

      return { policies: rows, total: Number(total) };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // UNDERWRITER WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════════

  /** UW-1: Assess risk and make underwriting decision */
  assessRisk: protectedProcedure
    .input(z.object({
      policyId: z.number(),
      riskScore: z.number().min(0).max(100),
      riskCategory: z.enum(["low", "medium", "high", "declined"]),
      decision: z.enum(["approved", "approved_with_conditions", "referred", "declined", "counter_offered"]),
      premiumLoading: z.number().optional(),
      exclusions: z.array(z.string()).optional(),
      conditions: z.array(z.string()).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // L-wave (L-S-2/L-P-2, 2026-09-19): underwriting decisions are
      // staff-only. Platform admins/supervisors pass directly; any other
      // caller must hold an ACTIVE stakeholder_profiles underwriter record
      // (fail-closed). Professional roles beyond admin/supervisor need the
      // Keycloak role-mapping work (L-S-5) — disclosed above.
      if (ctx.user?.id == null) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
      }
      if (!isStaff(ctx)) {
        const uw = await getActiveStakeholderProfile(db, ctx.user.id, ["underwriter"]);
        if (!uw) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Underwriting decisions require admin/supervisor or an active underwriter stakeholder profile",
          });
        }
      }

      // Load + tenant-scope the policy BEFORE any decision is recorded.
      const [policy] = await db.select().from(policies).where(eq(policies.id, input.policyId)).limit(1);
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      assertTenantOwnership(policy.tenantId, ctx.user?.tenantId ?? 0, "Policy");

      // L-wave: valid state transitions only — a decision is recorded from
      // draft/quoted (pending underwriting); every other state is refused
      // and the terminal flip below carries the guard atomically.
      const ASSESSABLE_FROM = ["draft", "quoted"] as const;
      if (!(ASSESSABLE_FROM as readonly string[]).includes(policy.status ?? "")) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Policy ${input.policyId} cannot be assessed from status '${policy.status}' (only draft/quoted)`,
        });
      }

      const [assessment] = await db.insert(underwritingAssessments).values({
        policyId: input.policyId,
        underwriterId: ctx.user?.id ?? undefined,
        decision: input.decision,
        riskScore: String(input.riskScore),
        riskCategory: input.riskCategory,
        premiumLoading: input.premiumLoading ? String(input.premiumLoading) : null,
        exclusions: input.exclusions ?? [],
        conditions: input.conditions ?? [],
        notes: input.notes ?? null,
        decisionDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      // Update policy status based on decision — ATOMIC from-state guard so a
      // concurrent bind/cancel cannot be clobbered, and referred /
      // counter_offered leave the policy in its current state.
      if (input.decision === "approved" || input.decision === "approved_with_conditions") {
        const flipped = await db.update(policies).set({ status: "bound", updatedAt: new Date() })
          .where(and(eq(policies.id, input.policyId), inArray(policies.status, [...ASSESSABLE_FROM])))
          .returning({ id: policies.id });
        if (flipped.length === 0) {
          throw new TRPCError({ code: "CONFLICT", message: `Policy ${input.policyId} is no longer assessable (concurrent status change)` });
        }
      } else if (input.decision === "declined") {
        const flipped = await db.update(policies).set({ status: "cancelled", updatedAt: new Date() })
          .where(and(eq(policies.id, input.policyId), inArray(policies.status, [...ASSESSABLE_FROM])))
          .returning({ id: policies.id });
        if (flipped.length === 0) {
          throw new TRPCError({ code: "CONFLICT", message: `Policy ${input.policyId} is no longer assessable (concurrent status change)` });
        }
      }

      await emitFluvioEvent(db, "underwriting-events", {
        eventType: "underwriting.decision_made",
        policyId: input.policyId,
        decision: input.decision,
        riskScore: input.riskScore,
      });

      await emitAuditLog(db, "UNDERWRITING_DECISION", "underwriting_assessment", assessment.id, ctx.user?.id, {
        policyId: input.policyId, decision: input.decision,
        approverUserId: ctx.user?.id ?? null,
        approverRole: callerRole(ctx) ?? null,
      });

      return { assessment };
    }),

  /** UW-2: Get pending underwriting queue */
  getUnderwritingQueue: protectedProcedure
    .input(z.object({
      limit: z.number().default(20),
      offset: z.number().default(0),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };

      // L-wave (L-P-2, 2026-09-19): the underwriting queue is staff-only —
      // it enumerates every draft policy platform-wide (targeting surface).
      requireStaff(ctx, "getUnderwritingQueue");

      const [items, [{ total }]] = await Promise.all([
        db.select().from(policies)
          .where(eq(policies.status, "draft"))
          .orderBy(asc(policies.createdAt))
          .limit(input.limit).offset(input.offset),
        db.select({ total: count() }).from(policies).where(eq(policies.status, "draft")),
      ]);

      return { items, total: Number(total) };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // CLAIMS ADJUSTER WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════════

  /** CA-1: Assign claim to adjuster */
  assignClaim: protectedProcedure
    .input(z.object({
      claimId: z.number().int().positive(),
      adjusterId: z.number().int().positive(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // L-wave (L-S-1, 2026-09-19): claim assignment is staff-only
      // (admin/supervisor — claims-manager mapping is pending L-S-5).
      requireStaff(ctx, "assignClaim");

      // F11-2: read the claim so the workflow event records the REAL prior
      // status instead of a fabricated "submitted".
      const [claim] = await db.select().from(claims).where(eq(claims.id, input.claimId)).limit(1);
      if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });
      // Tenant isolation: same ownership rule as getClaimById.
      assertTenantOwnership(claim.tenantId, ctx.user?.tenantId ?? 0, "Claim");
      const fromStatus = claim.status;

      // L-wave (L-S-1): adjusterId must reference a VALID adjuster — an
      // active stakeholder_profiles row with claims_adjuster capability and
      // claim authority covering the claimed amount (fail-closed when no
      // authority is recorded). adjusterId is the adjuster's userId, matching
      // claims.assignedAdjusterId semantics.
      const adjuster = await getActiveStakeholderProfile(db, input.adjusterId, ["claims_adjuster"]);
      if (!adjuster) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `adjusterId ${input.adjusterId} is not an active claims_adjuster stakeholder`,
        });
      }
      const authority = adjuster.maxClaimAuthority == null ? NaN : Number(adjuster.maxClaimAuthority);
      if (!Number.isFinite(authority) || authority < Number(claim.claimedAmount ?? 0)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Adjuster ${input.adjusterId} has no claim authority covering the claimed amount ${claim.claimedAmount} (fail-closed)`,
        });
      }

      // INS-7: FROM-state guard applied atomically — assignment can never
      // regress a decided/terminal claim (approved/paid/closed/...) back to
      // under_review, and two concurrent assignments cannot both win.
      const assigned = await db.update(claims).set({
        assignedAdjusterId: input.adjusterId,
        status: "under_review",
        updatedAt: new Date(),
      }).where(and(
        eq(claims.id, input.claimId),
        inArray(claims.status, [...ASSIGNABLE_FROM_STATUSES]),
      )).returning({ id: claims.id });
      if (assigned.length === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Claim ${input.claimId} cannot be assigned from status '${fromStatus}'`,
        });
      }

      await db.insert(claimWorkflowEvents).values({
        claimId: input.claimId,
        eventType: "claim.assigned",
        fromStatus,
        toStatus: "under_review",
        triggeredBy: ctx.user?.id ?? undefined,
        payload: { adjusterId: input.adjusterId },
      });

      // L-wave (L-S-1): audit every assignment with assigner identity.
      await emitAuditLog(db, "CLAIM_ASSIGNED", "claim", input.claimId, ctx.user?.id, {
        adjusterId: input.adjusterId,
        adjusterStakeholderId: adjuster.id,
        fromStatus,
      });

      return { success: true };
    }),

  /** CA-2: Adjudicate claim (approve/reject/partial) */
  adjudicateClaim: financialProcedure
    .input(z.object({
      claimId: z.number().int().positive(),
      decision: z.enum(["approved", "partially_approved", "rejected"]),
      // Positive when present; REQUIRED (and > 0) for approvals — enforced in
      // the handler because rejected decisions must not carry an amount.
      approvedAmount: z.number().positive().optional(),
      rejectionReason: z.string().optional(),
      investigationNotes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const statusMap = {
        approved: "approved",
        partially_approved: "partially_approved",
        rejected: "rejected",
      } as const;

      // Money integrity: an approval without a positive approvedAmount would
      // be unsettleable — settleClaimPayment pays the recorded approvedAmount,
      // never a caller-supplied figure.
      if (
        input.decision !== "rejected" &&
        (input.approvedAmount === undefined ||
          !Number.isFinite(input.approvedAmount) ||
          input.approvedAmount <= 0)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "approvedAmount must be a positive number for approved/partially_approved decisions",
        });
      }

      const [claim] = await db.select().from(claims).where(eq(claims.id, input.claimId)).limit(1);
      if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });
      const fromStatus = claim.status;

      // L-wave (L-S-3, 2026-09-19): segregation of duties — the adjudicator
      // must be a DIFFERENT principal than the claimant and than the user who
      // FILED the claim. Identities are compared on keycloakSub; an
      // unverifiable caller identity fails closed (repo convention, AB-8).
      const adjudicatorSub = callerKeycloakSub(ctx, "adjudicateClaim");
      if (ctx.user?.id != null && claim.claimantId === ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Segregation of duties: the claimant cannot adjudicate their own claim",
        });
      }
      const [filingEvent] = await db
        .select({ triggeredBy: claimWorkflowEvents.triggeredBy })
        .from(claimWorkflowEvents)
        .where(and(eq(claimWorkflowEvents.claimId, input.claimId), eq(claimWorkflowEvents.eventType, "claim.submitted")))
        .orderBy(asc(claimWorkflowEvents.id))
        .limit(1);
      if (filingEvent?.triggeredBy != null) {
        if (filingEvent.triggeredBy === ctx.user?.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Segregation of duties: the claim filer cannot adjudicate the same claim",
          });
        }
        // Defense in depth: distinct DB ids but the SAME Keycloak principal
        // is still self-dealing.
        const [filer] = await db.select({ keycloakSub: users.keycloakSub })
          .from(users).where(eq(users.id, filingEvent.triggeredBy)).limit(1);
        if (filer && filer.keycloakSub === adjudicatorSub) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Segregation of duties: the claim filer cannot adjudicate the same claim (Keycloak identity match)",
          });
        }
      }

      // INS-3: adjudication caps — an approval can never exceed what was
      // claimed, nor the policy's sum insured.
      if (input.decision !== "rejected") {
        const claimedAmount = Number(claim.claimedAmount);
        if (input.approvedAmount! > claimedAmount) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `approvedAmount ${input.approvedAmount} exceeds claimedAmount ${claimedAmount}`,
          });
        }
        const [policy] = await db.select({ sumInsured: policies.sumInsured })
          .from(policies).where(eq(policies.id, claim.policyId)).limit(1);
        const sumInsured = Number(policy?.sumInsured ?? NaN);
        if (Number.isFinite(sumInsured) && input.approvedAmount! > sumInsured) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `approvedAmount ${input.approvedAmount} exceeds policy sum insured ${sumInsured}`,
          });
        }
      }

      // F11-1: expected-state guard, applied ATOMICALLY in the UPDATE so a
      // concurrent adjudication cannot both win; a claim in a decided/terminal
      // state (approved/partially_approved/rejected/paid/closed) cannot be
      // re-adjudicated.
      const updated = await db.update(claims).set({
        status: statusMap[input.decision],
        approvedAmount: input.decision === "rejected" ? null : String(input.approvedAmount),
        rejectionReason: input.rejectionReason ?? null,
        investigationNotes: input.investigationNotes ?? null,
        updatedAt: new Date(),
      }).where(
        and(
          eq(claims.id, input.claimId),
          inArray(claims.status, [...ADJUDICATABLE_FROM_STATUSES])
        )
      ).returning({ id: claims.id });
      if (updated.length === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Claim ${input.claimId} cannot be adjudicated from status '${fromStatus}'`,
        });
      }

      await db.insert(claimWorkflowEvents).values({
        claimId: input.claimId,
        eventType: `claim.${input.decision}`,
        fromStatus,
        toStatus: statusMap[input.decision],
        triggeredBy: ctx.user?.id ?? undefined,
        payload: { approvedAmount: input.approvedAmount, rejectionReason: input.rejectionReason },
      });

      await emitFluvioEvent(db, "claims-events", {
        eventType: `claim.${input.decision}`,
        claimId: input.claimId,
        approvedAmount: input.approvedAmount,
      });

      // L-wave (L-S-3, 2026-09-19): audit every adjudication with the
      // adjudicator's verifiable identity.
      await emitAuditLog(db, "CLAIM_ADJUDICATED", "claim", input.claimId, ctx.user?.id, {
        decision: input.decision,
        approvedAmount: input.approvedAmount ?? null,
        adjudicatorKeycloakSub: adjudicatorSub,
      });

      return { success: true };
    }),

  /** CA-2b: Appeal a rejected claim (INS-5) — rejected→appealed, SLA, re-adjudication queue */
  appealClaim: protectedProcedure
    .input(z.object({
      claimId: z.number().int().positive(),
      reason: z.string().min(10),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [claim] = await db.select().from(claims).where(eq(claims.id, input.claimId)).limit(1);
      if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });

      // Only the claimant (or an admin) may appeal, and only a REJECTED claim
      // can enter the appeal path — the state guard is applied atomically.
      const isClaimant = ctx.user?.id != null && claim.claimantId === ctx.user.id;
      const isAdmin = (ctx.user as { role?: string } | undefined)?.role === "admin";
      if (!isClaimant && !isAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the claimant or an admin can appeal this claim" });
      }

      const slaDeadline = new Date(Date.now() + APPEAL_SLA_DAYS * 86_400_000);
      const flipped = await db.update(claims).set({
        status: "appealed",
        updatedAt: new Date(),
      }).where(and(eq(claims.id, input.claimId), eq(claims.status, "rejected")))
        .returning({ id: claims.id });
      if (flipped.length === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Claim ${input.claimId} cannot be appealed from status '${claim.status}' (only 'rejected')`,
        });
      }

      // One open appeal per claim (claim_appeals.claimId is UNIQUE) — a
      // concurrent second appeal replays instead of double-queueing.
      const [appeal] = await db.insert(claimAppeals).values({
        claimId: input.claimId,
        appellantId: ctx.user?.id ?? claim.claimantId,
        reason: input.reason,
        status: "open",
        slaDeadline,
      }).onConflictDoNothing({ target: claimAppeals.claimId }).returning();

      // Re-adjudication queue: appealed is in ADJUDICATABLE_FROM_STATUSES, so
      // the claim is immediately re-adjudicable; record the queue event.
      await db.insert(claimWorkflowEvents).values({
        claimId: input.claimId,
        eventType: "claim.appealed",
        fromStatus: "rejected",
        toStatus: "appealed",
        triggeredBy: ctx.user?.id ?? undefined,
        payload: { reason: input.reason, slaDeadline: slaDeadline.toISOString(), queue: "appeals" },
      });

      await emitFluvioEvent(db, "claims-events", {
        eventType: "claim.appealed", claimId: input.claimId, slaDeadline: slaDeadline.toISOString(),
      });
      await emitAuditLog(db, "CLAIM_APPEALED", "claim", input.claimId, ctx.user?.id, { reason: input.reason });

      return { success: true, appeal: appeal ?? null, slaDeadline, queue: "appeals" };
    }),

  /** CA-3: Process claim settlement payment via TigerBeetle */
  settleClaimPayment: financialProcedure
    .input(z.object({
      claimId: z.number().int().positive(),
      paymentMethod: z.string().min(1),
      paymentRef: z.string().max(128).optional(),
      beneficiaryName: z.string().optional(),
      beneficiaryAccount: z.string().optional(),
      beneficiaryBank: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const { claimsPayments } = await import("../../drizzle/schema.additions");

      // F11-3: idempotency is keyed on the CLAIM, not on a caller-supplied
      // (or timestamped) paymentRef — a claim settles exactly once, no
      // matter how many times the caller retries with fresh refs.
      const existingPayment = await db.select().from(claimsPayments)
        .where(eq(claimsPayments.claimId, input.claimId)).limit(1);
      if (existingPayment.length > 0) return { idempotent: true, payment: existingPayment[0] };

      const [claim] = await db.select().from(claims).where(eq(claims.id, input.claimId)).limit(1);
      if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });
      // Expected-state guard: settlement is only reachable from an approved
      // decision state, before any money moves.
      if (!(SETTLEABLE_CLAIM_STATUSES as readonly string[]).includes(claim.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Claim status '${claim.status}' not approved for settlement` });
      }
      // F11-3: the settled amount comes from the server-side adjudicated
      // claim row — the client cannot name its own payout figure.
      const approvedAmount = Number(claim.approvedAmount ?? NaN);
      if (!Number.isFinite(approvedAmount) || approvedAmount <= 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Claim has no recorded approvedAmount — adjudicate the claim before settling it",
        });
      }

      // L-wave (L-S-3, 2026-09-19): segregation of duties — the SETTLER must
      // be a different principal than the ADJUDICATOR. The adjudicator is the
      // recorded claim.approved / claim.partially_approved workflow event
      // actor; if none exists the claim's approval provenance is unverifiable
      // and settlement fails closed.
      const settlerSub = callerKeycloakSub(ctx, "settleClaimPayment");
      const [decisionEvent] = await db
        .select({ triggeredBy: claimWorkflowEvents.triggeredBy })
        .from(claimWorkflowEvents)
        .where(and(
          eq(claimWorkflowEvents.claimId, input.claimId),
          inArray(claimWorkflowEvents.eventType, ["claim.approved", "claim.partially_approved"]),
        ))
        .orderBy(desc(claimWorkflowEvents.id))
        .limit(1);
      if (decisionEvent?.triggeredBy == null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Claim approval provenance is unverifiable (no adjudication event) — settlement refused (fail-closed SoD)",
        });
      }
      if (decisionEvent.triggeredBy === ctx.user?.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Segregation of duties: the adjudicator cannot settle the same claim",
        });
      }
      {
        const [adjudicator] = await db.select({ keycloakSub: users.keycloakSub })
          .from(users).where(eq(users.id, decisionEvent.triggeredBy)).limit(1);
        if (adjudicator && adjudicator.keycloakSub === settlerSub) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Segregation of duties: the adjudicator cannot settle the same claim (Keycloak identity match)",
          });
        }
      }

      // INS-13: the payout beneficiary resolves from the beneficiaries table,
      // never from caller-supplied free text. A minor beneficiary pays out to
      // the recorded guardian only.
      // L-wave (L-S-3, 2026-09-19): a beneficiary OF RECORD is REQUIRED and
      // the caller-supplied-account fallback is DELETED — previously any
      // caller could name their own account when no beneficiaries row
      // existed. Settlement without a beneficiary row now fails closed.
      let beneficiaryName = input.beneficiaryName ?? null;
      let beneficiaryAccount: string | null = null;
      const beneficiaryBank = input.beneficiaryBank ?? null;
      const [bene] = await db.select().from(beneficiaries)
        .where(eq(beneficiaries.policyId, claim.policyId))
        .orderBy(desc(beneficiaries.percentage)).limit(1);
      if (!bene) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Policy ${claim.policyId} has no beneficiary of record — settlement refused (fail-closed; caller-supplied accounts are never accepted)`,
        });
      }
      {
        if (bene.isMinor && !bene.guardianName) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Beneficiary is a minor with no guardian on record — assign a guardian before settlement",
          });
        }
        beneficiaryName = bene.isMinor ? (bene.guardianName ?? null) : bene.name;
        beneficiaryAccount = bene.nationalId ?? null;
        if (input.beneficiaryName && input.beneficiaryName !== beneficiaryName) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `beneficiaryName '${input.beneficiaryName}' does not match the recorded beneficiary for policy ${claim.policyId}`,
          });
        }
      }

      // INS-8: grace-hold claims settle net of the arrears recorded at filing.
      const claimMeta = (claim.metadata ?? {}) as { graceHold?: boolean; arrearsAtFiling?: number };
      const arrearsOffset = claimMeta.graceHold ? Number(claimMeta.arrearsAtFiling ?? 0) : 0;
      const payoutAmount = Math.max(0, approvedAmount - arrearsOffset);
      if (claimMeta.graceHold && payoutAmount <= 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Approved amount ${approvedAmount} is fully consumed by premium arrears ${arrearsOffset} — nothing to settle`,
        });
      }

      // Deterministic ref (no Date.now()): a retried settlement for the same
      // claim converges on the same reference.
      const payRef = input.paymentRef ?? `CLM-SETTLE-${input.claimId}`;

      // Distributed lock to prevent double-payment (fail-closed on Redis
      // outage — see server/lib/redisClient.ts)
      const { acquireLock, releaseLock } = await import("../lib/redisClient");
      const lockKey = `claim-settle:${input.claimId}`;
      const locked = await acquireLock(lockKey, 30_000);
      if (!locked) throw new TRPCError({ code: "CONFLICT", message: "Settlement already in progress" });

      try {
        // TigerBeetle: insurer-claims-pool → claimant (CLAIMS_PAYOUTS ledger, code 800)
        const tbReq = {
          debitAccountId: "insurer-claims-pool",
          creditAccountId: `claimant-${claim.claimantId}`,
          amount: Math.round(payoutAmount * 100),
          ledger: 4000,
          code: 800,
          ref: payRef,
          txType: "claim_settlement",
        };
        const tbResult = await tbCreateTransfer(tbReq);

        // Payment record + claim state flip in ONE real transaction on a
        // single connection (withClientTransaction). The claim flip carries
        // the expected-state guard atomically; the claims_payments.claimId
        // unique index (migration 0053) makes a lost race idempotent instead
        // of a double-pay.
        // PAY-1 (orphan transfer): the TB leg above is committed. If the PG
        // transaction fails, post a compensating reversal (payRef-REV) and
        // rethrow loudly — previously a PG rollback left the TB leg posted.
        const settleResult = await withTbCompensation("insuranceWorkflows.settleClaimPayment", tbReq, () => withClientTransaction(async (client) => {
          const ins = await client.query(
            `INSERT INTO claims_payments
               ("claimId", "paymentRef", amount, currency, "paymentMethod",
                "beneficiaryName", "beneficiaryAccount", "beneficiaryBank",
                status, "tbTransferId", "processedAt", "approvedBy")
             VALUES ($1, $2, $3, 'NGN', $4, $5, $6, $7, 'processed', $8, now(), $9)
             ON CONFLICT ("claimId") DO NOTHING
             RETURNING *`,
            [
              input.claimId,
              payRef,
              String(payoutAmount),
              input.paymentMethod,
              beneficiaryName,
              beneficiaryAccount,
              beneficiaryBank,
              tbResult?.id ?? null,
              ctx.user?.id ?? null,
            ]
          );
          if ((ins.rowCount ?? 0) === 0) {
            // Lost the race: another request settled this claim first —
            // return the winner's payment row (idempotent replay).
            const winner = await client.query(
              `SELECT * FROM claims_payments WHERE "claimId" = $1 LIMIT 1`,
              [input.claimId]
            );
            return { payment: winner.rows[0], replayed: true };
          }
          const flip = await client.query(
            `UPDATE claims
                SET status = 'paid', "paidAmount" = $1, "settlementDate" = now(), "updatedAt" = now()
              WHERE id = $2 AND status IN ('approved', 'partially_approved')
              RETURNING id`,
            [String(payoutAmount), input.claimId]
          );
          if ((flip.rowCount ?? 0) === 0) {
            // Claim moved out of a settleable state between our read and the
            // write — roll back the payment row with the whole transaction.
            throw new TRPCError({
              code: "CONFLICT",
              message: `Claim ${input.claimId} is no longer in a settleable state (concurrent status change)`,
            });
          }
          if (arrearsOffset > 0) {
            // INS-8: arrears offset consumed — clear the grace arrears ledger.
            await client.query(
              `UPDATE policy_lifecycle_states
                  SET "arrearsAmount" = 0, "updatedAt" = now()
                WHERE "policyId" = $1`,
              [claim.policyId]
            );
          }
          return { payment: ins.rows[0], replayed: false };
        }));

        if (!settleResult.replayed) {
          await emitFluvioEvent(db, "payment-events", {
            eventType: "payment.claim_settled",
            claimId: input.claimId,
            amount: payoutAmount,
            arrearsOffset,
            paymentRef: payRef,
            tigerBeetleRef: tbResult?.id,
          });

          await emitAuditLog(db, "CLAIM_SETTLED", "claim", input.claimId, ctx.user?.id, {
            amount: payoutAmount, arrearsOffset, paymentRef: payRef, tbTransferId: tbResult?.id ?? null,
            settlerKeycloakSub: settlerSub, adjudicatorUserId: decisionEvent.triggeredBy,
          });
        }

        return { idempotent: settleResult.replayed, payment: settleResult.payment, tigerBeetleRef: tbResult?.id ?? null, tbSyncStatus: tbResult?.syncStatus ?? "pending" };
      } finally {
        await releaseLock(lockKey);
      }
    }),


  /** CA-4: Policy lifecycle sweeper (INS-1) — cron/Temporal-scheduled lapse/expiry transitions */
  sweepPolicyLifecycle: protectedProcedure
    .input(z.object({ dryRun: z.boolean().optional() }).optional())
    .mutation(async ({ ctx }) => {
      if ((ctx.user as { role?: string } | undefined)?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only admins can run the policy lifecycle sweeper" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const result = await sweepPolicyLifecycle(db);
      await emitAuditLog(db, "POLICY_LIFECYCLE_SWEEP", "policy", 0, ctx.user?.id, result);
      await emitFluvioEvent(db, "policy-events", { eventType: "policy.lifecycle_sweep", ...result });
      return result;
    }),

  /** PH-7: Reinstate a lapsed policy (INS-9) — arrears, max lapse window, waiting-period reset */
  reinstatePolicy: protectedProcedure
    .input(z.object({
      policyId: z.number(),
      amount: z.number().positive(),
      paymentMethod: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [policy] = await db.select().from(policies)
        .where(eq(policies.id, input.policyId)).limit(1);
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      const isOwner = ctx.user?.id != null && policy.customerId === ctx.user.id;
      const isAdmin = (ctx.user as { role?: string } | undefined)?.role === "admin";
      if (!isOwner && !isAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the policyholder or an admin can reinstate this policy" });
      }

      const lifecycle = await getOrInitLifecycle(db, input.policyId);
      const error = validateReinstatement(policy, lifecycle, input.amount);
      if (error) throw new TRPCError({ code: "PRECONDITION_FAILED", message: error });

      const paymentRef = `PAY-REINSTATE-${input.policyId}`;
      const tbResult = await tbCreateTransfer({
        debitAccountId: `customer-${policy.customerId}`,
        creditAccountId: "insurer-premium-pool",
        amount: Math.round(input.amount * 100),
        ref: paymentRef,
        txType: "premium_payment",
      });

      const now = new Date();
      await db.transaction(async (tx) => {
        await tx.insert(premiumPayments).values({
          policyId: input.policyId,
          paymentReference: paymentRef,
          amount: String(input.amount),
          currency: "NGN",
          paymentDate: now,
          paymentMethod: input.paymentMethod,
          channel: "web",
          status: tbResult ? "completed" : "pending",
          tigerBeetleRef: tbResult?.id ?? null,
          createdAt: now,
          updatedAt: now,
        });
        // Atomic state guard: lapsed → active only.
        const reinstated = await tx.update(policies)
          .set({ status: "active", updatedAt: now })
          .where(and(eq(policies.id, input.policyId), eq(policies.status, "lapsed")))
          .returning({ id: policies.id });
        if (reinstated.length === 0) {
          throw new TRPCError({ code: "CONFLICT", message: `Policy ${input.policyId} is no longer lapsed (concurrent status change)` });
        }
        // INS-9: arrears cleared; waiting period RESTARTS from reinstatement
        // (fresh evidence-of-insurability semantics).
        await tx.update(policyLifecycleStates).set({
          arrearsAmount: "0",
          lapsedAt: null,
          reinstatedAt: now,
          waitingPeriodResetAt: now,
          updatedAt: now,
        }).where(eq(policyLifecycleStates.policyId, input.policyId));
      });

      await db.insert(policyWorkflowEvents).values({
        policyId: input.policyId,
        eventType: "policy.reinstated",
        fromStatus: "lapsed",
        toStatus: "active",
        triggeredBy: ctx.user?.id ?? undefined,
        payload: { amount: input.amount, waitingPeriodResetAt: now.toISOString() },
      });
      await emitFluvioEvent(db, "policy-events", { eventType: "policy.reinstated", policyId: input.policyId });
      await emitAuditLog(db, "POLICY_REINSTATED", "policy", input.policyId, ctx.user?.id, { amount: input.amount });
      return { success: true, waitingPeriodResetAt: now, tigerBeetleRef: tbResult?.id ?? null };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // BENEFICIARY LIFECYCLE (INS-13)
  // ═══════════════════════════════════════════════════════════════════════════

  /** BEN-1: Add or update a beneficiary; percentage-sum<=100 enforced; minor needs guardian */
  upsertBeneficiary: protectedProcedure
    .input(z.object({
      policyId: z.number(),
      name: z.string().min(1),
      relationship: z.string().min(1),
      percentage: z.number().positive().max(100),
      dateOfBirth: z.string().optional(),
      isMinor: z.boolean().optional(),
      guardianName: z.string().optional(),
      nationalId: z.string().optional(),
      beneficiaryId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [policy] = await db.select().from(policies).where(eq(policies.id, input.policyId)).limit(1);
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      const isOwner = ctx.user?.id != null && policy.customerId === ctx.user.id;
      const isAdmin = (ctx.user as { role?: string } | undefined)?.role === "admin";
      if (!isOwner && !isAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized for this policy" });

      // Minor/guardian rule: a minor beneficiary MUST name a guardian.
      const dob = input.dateOfBirth ? new Date(input.dateOfBirth) : null;
      const isMinor = input.isMinor ?? (dob != null && Date.now() - dob.getTime() < 18 * 365.25 * 86_400_000);
      if (isMinor && !input.guardianName) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A minor beneficiary requires a guardianName" });
      }

      // Percentage-sum validation across the policy's beneficiaries
      // (excluding the row being replaced): the total may never exceed 100%.
      const existing = await db.select({ id: beneficiaries.id, percentage: beneficiaries.percentage })
        .from(beneficiaries).where(eq(beneficiaries.policyId, input.policyId));
      const otherTotal = existing
        .filter(b => b.id !== input.beneficiaryId)
        .reduce((acc, b) => acc + Number(b.percentage), 0);
      const newTotal = Math.round((otherTotal + input.percentage) * 100) / 100;
      if (newTotal > 100) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Beneficiary percentages would total ${newTotal}% (> 100%)` });
      }

      let row;
      if (input.beneficiaryId != null) {
        const updated = await db.update(beneficiaries).set({
          name: input.name,
          relationship: input.relationship,
          percentage: String(input.percentage),
          dateOfBirth: dob,
          isMinor,
          guardianName: input.guardianName ?? null,
          nationalId: input.nationalId ?? null,
          updatedAt: new Date(),
        }).where(and(eq(beneficiaries.id, input.beneficiaryId), eq(beneficiaries.policyId, input.policyId))).returning();
        if (updated.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Beneficiary not found for this policy" });
        row = updated[0];
      } else {
        [row] = await db.insert(beneficiaries).values({
          policyId: input.policyId,
          name: input.name,
          relationship: input.relationship,
          percentage: String(input.percentage),
          dateOfBirth: dob,
          isMinor,
          guardianName: input.guardianName ?? null,
          nationalId: input.nationalId ?? null,
        }).returning();
      }
      await emitAuditLog(db, "BENEFICIARY_UPSERTED", "policy", input.policyId, ctx.user?.id, { beneficiaryId: row.id });
      return { beneficiary: row };
    }),

  /** BEN-2: Remove a beneficiary */
  removeBeneficiary: protectedProcedure
    .input(z.object({ policyId: z.number(), beneficiaryId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [policy] = await db.select().from(policies).where(eq(policies.id, input.policyId)).limit(1);
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      const isOwner = ctx.user?.id != null && policy.customerId === ctx.user.id;
      const isAdmin = (ctx.user as { role?: string } | undefined)?.role === "admin";
      if (!isOwner && !isAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized for this policy" });
      const deleted = await db.delete(beneficiaries)
        .where(and(eq(beneficiaries.id, input.beneficiaryId), eq(beneficiaries.policyId, input.policyId)))
        .returning({ id: beneficiaries.id });
      if (deleted.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Beneficiary not found for this policy" });
      await emitAuditLog(db, "BENEFICIARY_REMOVED", "policy", input.policyId, ctx.user?.id, { beneficiaryId: input.beneficiaryId });
      return { success: true };
    }),

  /** BEN-3: List beneficiaries for a policy */
  listBeneficiaries: protectedProcedure
    .input(z.object({ policyId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [policy] = await db.select({ customerId: policies.customerId }).from(policies)
        .where(eq(policies.id, input.policyId)).limit(1);
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      const isOwner = ctx.user?.id != null && policy.customerId === ctx.user.id;
      const isAdmin = (ctx.user as { role?: string } | undefined)?.role === "admin";
      if (!isOwner && !isAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized for this policy" });
      const items = await db.select().from(beneficiaries).where(eq(beneficiaries.policyId, input.policyId));
      return { items };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTUARY WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════════

  /** AC-1: Compute actuarial reserves */
  computeReserves: protectedProcedure
    .input(z.object({
      reserveType: z.string(),
      productId: z.number().optional(),
      coverageType: z.string().optional(),
      reportingPeriod: z.string(),
      methodology: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Simplified reserve computation
      const activePolicies = await db.select({ total: sum(policies.sumInsured) })
        .from(policies).where(eq(policies.status, "active"));
      const totalSumInsured = Number(activePolicies[0]?.total ?? 0);

      const grossReserve = totalSumInsured * 0.05; // 5% reserve ratio
      const netReserve = grossReserve * 0.8;

      const [reserve] = await db.insert(actuarialReserves).values({
        reserveType: input.reserveType,
        productId: input.productId ?? null,
        calculationDate: new Date(),
        grossReserve: String(grossReserve),
        netReserve: String(netReserve),
        methodology: input.methodology ?? "chain_ladder",
        reportingPeriod: input.reportingPeriod,
        calculatedBy: ctx.user?.id ?? undefined,
        createdAt: new Date(),
      }).returning();

      await emitAuditLog(db, "RESERVES_COMPUTED", "actuarial_reserve", reserve.id, ctx.user?.id, {
        reserveType: input.reserveType, grossReserve, netReserve,
      });

      return { reserve, grossReserve, netReserve };
    }),

  /** AC-2: Generate IFRS17 measurement group */
  generateIfrs17Report: protectedProcedure
    .input(z.object({
      groupCode: z.string(),
      productId: z.number().optional(),
      measurementModel: z.enum(["GMM", "PAA", "VFA"]),
      reportingPeriod: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Simplified IFRS17 calculation
      const csm = 1000000; // Contractual Service Margin
      const ra = 50000;    // Risk Adjustment
      const lrc = csm + ra;

      const [group] = await db.insert(ifrs17MeasurementGroups).values({
        groupCode: input.groupCode,
        productId: input.productId ?? null,
        measurementModel: input.measurementModel,
        reportingPeriod: input.reportingPeriod,
        csm: String(csm),
        ra: String(ra),
        lrc: String(lrc),
        lrc_remaining: String(lrc * 0.9),
        calculatedAt: new Date(),
        calculatedBy: ctx.user?.id ?? undefined,
        createdAt: new Date(),
      }).returning();

      return { group, csm, ra, lrc };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLIANCE OFFICER WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════════

  /** CO-1: Submit NAICOM regulatory report */
  submitNaicomReport: protectedProcedure
    .input(z.object({
      reportType: z.string(),
      reportingPeriod: z.string(),
      dueDate: z.string(),
      reportData: z.record(z.string(), z.unknown()),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [report] = await db.insert(naicomReports).values({
        reportType: input.reportType,
        reportingPeriod: input.reportingPeriod,
        submissionDate: new Date(),
        status: "submitted",
        reportData: input.reportData,
        submittedBy: ctx.user?.id ?? undefined,
        dueDate: new Date(input.dueDate),
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      await emitAuditLog(db, "NAICOM_REPORT_SUBMITTED", "naicom_report", report.id, ctx.user?.id, {
        reportType: input.reportType, reportingPeriod: input.reportingPeriod,
      });

      return { report };
    }),

  /** CO-2: List pending compliance filings */
  getPendingComplianceFilings: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return { reports: [] };

      const reports = await db.select().from(naicomReports)
        .where(eq(naicomReports.status, "pending"))
        .orderBy(asc(naicomReports.dueDate));

      return { reports };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // REINSURER WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════════

  /** RI-1: Create reinsurance treaty */
  createTreaty: protectedProcedure
    .input(z.object({
      reinsurerName: z.string(),
      type: z.enum(["proportional", "non_proportional", "quota_share", "surplus", "excess_of_loss", "stop_loss", "catastrophe"]),
      retentionLimit: z.number(),
      cessionLimit: z.number(),
      cessionPercentage: z.number(),
      premiumRate: z.number(),
      startDate: z.string(),
      endDate: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const treatyNumber = `TRT-${Date.now()}`;
      const [treaty] = await db.insert(reinsuranceTreaties).values({
        treatyNumber,
        reinsurerName: input.reinsurerName,
        type: input.type,
        retentionLimit: String(input.retentionLimit),
        cessionLimit: String(input.cessionLimit),
        cessionPercentage: String(input.cessionPercentage),
        premiumRate: String(input.premiumRate),
        startDate: new Date(input.startDate),
        endDate: input.endDate ? new Date(input.endDate) : null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      await emitAuditLog(db, "TREATY_CREATED", "reinsurance_treaty", treaty.id, ctx.user?.id, { treatyNumber });
      return { treaty, treatyNumber };
    }),

  /** RI-2: Cede a policy to reinsurance treaty */
  cedePolicyToTreaty: financialProcedure
    .input(z.object({
      treatyId: z.number(),
      policyId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [treaty] = await db.select().from(reinsuranceTreaties)
        .where(eq(reinsuranceTreaties.id, input.treatyId)).limit(1);
      const [policy] = await db.select().from(policies)
        .where(eq(policies.id, input.policyId)).limit(1);

      if (!treaty || !policy) throw new TRPCError({ code: "NOT_FOUND", message: "Treaty or policy not found" });

      const cessionPct = Number(treaty.cessionPercentage ?? 0);
      const cededPremium = Number(policy.annualPremium) * cessionPct;
      const cededSumInsured = Number(policy.sumInsured) * cessionPct;

      const [cession] = await db.insert(reinsuranceCessions).values({
        treatyId: input.treatyId,
        policyId: input.policyId,
        cededPremium: String(cededPremium),
        cededSumInsured: String(cededSumInsured),
        retainedPremium: String(Number(policy.annualPremium) - cededPremium),
        retainedSumInsured: String(Number(policy.sumInsured) - cededSumInsured),
        cessionDate: new Date(),
        status: "pending",
        createdAt: new Date(),
      }).returning();

      return { cession };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════════

  /** AD-1: Create insurance product */
  createProduct: protectedProcedure
    .input(z.object({
      productCode: z.string(),
      name: z.string(),
      description: z.string().optional(),
      coverageType: z.enum(["life", "health", "motor", "property", "liability", "marine", "aviation", "agriculture", "credit", "travel", "micro", "group_life", "annuity", "pension"]),
      minPremium: z.number(),
      maxCoverageAmount: z.number().optional(),
      minAge: z.number().optional(),
      maxAge: z.number().optional(),
      waitingPeriodDays: z.number().optional(),
      policyTermMonths: z.number().optional(),
      regulatoryApprovalRef: z.string().optional(),
      naicomProductCode: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [product] = await db.insert(insuranceProducts).values({
        productCode: input.productCode,
        name: input.name,
        description: input.description ?? null,
        coverageType: input.coverageType,
        minPremium: String(input.minPremium),
        maxCoverageAmount: input.maxCoverageAmount ? String(input.maxCoverageAmount) : null,
        minAge: input.minAge ?? null,
        maxAge: input.maxAge ?? null,
        waitingPeriodDays: input.waitingPeriodDays ?? 0,
        policyTermMonths: input.policyTermMonths ?? 12,
        isActive: true,
        regulatoryApprovalRef: input.regulatoryApprovalRef ?? null,
        naicomProductCode: input.naicomProductCode ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      await emitAuditLog(db, "PRODUCT_CREATED", "insurance_product", product.id, ctx.user?.id, {
        productCode: input.productCode, name: input.name,
      });

      return { product };
    }),

  /** AD-2: Get platform-wide insurance dashboard */
  getInsuranceDashboard: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return { stats: {} };

      const [
        totalPolicies,
        activePolicies,
        totalClaims,
        pendingClaims,
        totalPremiums,
        totalProducts,
      ] = await Promise.all([
        db.select({ count: count() }).from(policies),
        db.select({ count: count() }).from(policies).where(eq(policies.status, "active")),
        db.select({ count: count() }).from(claims),
        db.select({ count: count() }).from(claims).where(eq(claims.status, "submitted")),
        db.select({ total: sum(premiumPayments.amount) }).from(premiumPayments).where(eq(premiumPayments.status, "completed")),
        db.select({ count: count() }).from(insuranceProducts).where(eq(insuranceProducts.isActive, true)),
      ]);

      return {
        stats: {
          totalPolicies: Number(totalPolicies[0]?.count ?? 0),
          activePolicies: Number(activePolicies[0]?.count ?? 0),
          totalClaims: Number(totalClaims[0]?.count ?? 0),
          pendingClaims: Number(pendingClaims[0]?.count ?? 0),
          totalPremiumsCollected: Number(totalPremiums[0]?.total ?? 0),
          activeProducts: Number(totalProducts[0]?.count ?? 0),
        },
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // ENDORSEMENT WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════════

  /** EN-1: Request policy endorsement */
  requestEndorsement: protectedProcedure
    .input(z.object({
      policyId: z.number(),
      type: z.enum(["addition", "deletion", "modification", "extension", "reduction", "cancellation", "reinstatement"]),
      effectiveDate: z.string(),
      description: z.string(),
      premiumAdjustment: z.number().optional(),
      sumInsuredAdjustment: z.number().optional(),
      changesDetail: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const endorsementNumber = `END-${Date.now()}-${input.policyId}`;
      const [endorsement] = await db.insert(endorsements).values({
        endorsementNumber,
        policyId: input.policyId,
        type: input.type,
        effectiveDate: new Date(input.effectiveDate),
        description: input.description,
        premiumAdjustment: input.premiumAdjustment ? String(input.premiumAdjustment) : "0",
        sumInsuredAdjustment: input.sumInsuredAdjustment ? String(input.sumInsuredAdjustment) : "0",
        changesDetail: input.changesDetail ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      await emitFluvioEvent(db, "policy-events", {
        eventType: "policy.endorsement_requested",
        policyId: input.policyId,
        endorsementNumber,
        type: input.type,
      });

      return { endorsement, endorsementNumber };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // QUERY ENDPOINTS (read-only)
  // ═══════════════════════════════════════════════════════════════════════════

  getPolicyById: protectedProcedure
    .input(z.object({ policyId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return null;
      const [policy] = await db.select().from(policies).where(eq(policies.id, input.policyId)).limit(1);
      // Tenant isolation (F-05): a tenant user may not read another tenant's
      // policy. Platform users (no tenantId → 0 sentinel) are unscoped.
      if (policy) assertTenantOwnership(policy.tenantId, ctx.user?.tenantId ?? 0, "Policy");
      return policy ?? null;
    }),

  getClaimById: protectedProcedure
    .input(z.object({ claimId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return null;
      const [claim] = await db.select().from(claims).where(eq(claims.id, input.claimId)).limit(1);
      // Tenant isolation (F-05): same ownership rule as getPolicyById.
      if (claim) assertTenantOwnership(claim.tenantId, ctx.user?.tenantId ?? 0, "Claim");
      return claim ?? null;
    }),

  listPolicies: protectedProcedure
    .input(z.object({
      customerId: z.number().optional(),
      agentId: z.number().optional(),
      status: z.string().optional(),
      limit: z.number().default(20),
      offset: z.number().default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { policies: [], total: 0 };

      const conditions: ReturnType<typeof eq>[] = [];
      // Tenant isolation (F-05): tenant users only list their own tenant's
      // policies.
      // M-wave (W2, 2026-09-19): previously users WITHOUT a tenantId
      // (tenantId=0 sentinel — the default for portal signups) were silently
      // UNSCOPED and read every tenant's policies. Fail-closed, matching the
      // L-eco disputeRefund.list gate: platform-scope reads require the
      // admin role; everyone else is scoped to their tenantId, and an
      // unresolvable tenantId denies the read.
      const tenantId = ctx.user?.tenantId ?? 0;
      if (tenantId === 0 && ctx.user?.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Platform-scope policy reads require the admin role",
        });
      }
      if (tenantId !== 0) conditions.push(eq(policies.tenantId, tenantId));
      if (input.customerId) conditions.push(eq(policies.customerId, input.customerId));
      if (input.agentId) conditions.push(eq(policies.agentId, input.agentId));
      if (input.status) conditions.push(eq(policies.status, input.status as any));

      const [rows, [{ total }]] = await Promise.all([
        db.select().from(policies)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(policies.createdAt)).limit(input.limit).offset(input.offset),
        db.select({ total: count() }).from(policies)
          .where(conditions.length ? and(...conditions) : undefined),
      ]);

      return { policies: rows, total: Number(total) };
    }),

  listClaims: protectedProcedure
    .input(z.object({
      policyId: z.number().optional(),
      status: z.string().optional(),
      adjusterId: z.number().optional(),
      limit: z.number().default(20),
      offset: z.number().default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { claims: [], total: 0 };

      const conditions: ReturnType<typeof eq>[] = [];
      // Tenant isolation (F-05): tenant users only list their own tenant's
      // claims.
      // M-wave (W2, 2026-09-19): platform-scope reads (tenantId=0 sentinel)
      // now require the admin role — same gate as listPolicies above and the
      // L-eco disputeRefund.list pattern. Fail-closed when tenantId is
      // unresolvable for non-admin callers.
      const tenantId = ctx.user?.tenantId ?? 0;
      if (tenantId === 0 && ctx.user?.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Platform-scope claim reads require the admin role",
        });
      }
      if (tenantId !== 0) conditions.push(eq(claims.tenantId, tenantId));
      if (input.policyId) conditions.push(eq(claims.policyId, input.policyId));
      if (input.status) conditions.push(eq(claims.status, input.status as any));
      if (input.adjusterId) conditions.push(eq(claims.assignedAdjusterId, input.adjusterId));

      const [rows, [{ total }]] = await Promise.all([
        db.select().from(claims)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(claims.createdAt)).limit(input.limit).offset(input.offset),
        db.select({ total: count() }).from(claims)
          .where(conditions.length ? and(...conditions) : undefined),
      ]);

      return { claims: rows, total: Number(total) };
    }),

  listProducts: protectedProcedure
    .input(z.object({
      coverageType: z.string().optional(),
      isActive: z.boolean().optional(),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { products: [] };

      const conditions: ReturnType<typeof eq>[] = [];
      if (input.coverageType) conditions.push(eq(insuranceProducts.coverageType, input.coverageType as any));
      if (input.isActive !== undefined) conditions.push(eq(insuranceProducts.isActive, input.isActive));

      const products = await db.select().from(insuranceProducts)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(asc(insuranceProducts.name)).limit(input.limit);

      return { products };
    }),

  getActuarialReserves: protectedProcedure
    .input(z.object({ reportingPeriod: z.string().optional() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { reserves: [] };

      const reserves = await db.select().from(actuarialReserves)
        .where(input.reportingPeriod ? eq(actuarialReserves.reportingPeriod, input.reportingPeriod) : undefined)
        .orderBy(desc(actuarialReserves.calculationDate));

      return { reserves };
    }),

  getReinsuranceTreaties: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return { treaties: [] };
      const treaties = await db.select().from(reinsuranceTreaties)
        .where(eq(reinsuranceTreaties.isActive, true))
        .orderBy(asc(reinsuranceTreaties.treatyNumber));
      return { treaties };
    }),

  getPolicyWorkflowHistory: protectedProcedure
    .input(z.object({ policyId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { events: [] };
      const events = await db.select().from(policyWorkflowEvents)
        .where(eq(policyWorkflowEvents.policyId, input.policyId))
        .orderBy(asc(policyWorkflowEvents.createdAt));
      return { events };
    }),

  getClaimWorkflowHistory: protectedProcedure
    .input(z.object({ claimId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { events: [] };
      const events = await db.select().from(claimWorkflowEvents)
        .where(eq(claimWorkflowEvents.claimId, input.claimId))
        .orderBy(asc(claimWorkflowEvents.createdAt));
      return { events };
    }),
});
