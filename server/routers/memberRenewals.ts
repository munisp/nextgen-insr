/**
 * memberRenewals.ts — R3 batch 5 member surface (2026-10-01, R3-b5)
 *
 * Member-scoped policy renewal surface for the PWA
 * (customer-portal-full/client/src/services/memberLifecycleApi.ts → mounted
 * as `memberRenewals`). Source: insuranceWorkflows.requestRenewal
 * (server/routers/insuranceWorkflows.ts:765).
 *
 * Worklist claim verification (2026-10-01, R3-b5): the claim that
 * requestRenewal is an IDOR is TRUE — the source fetches the policy by id
 * (insuranceWorkflows.ts:774-776) with NO customerId/ownership check, so any
 * authenticated user can request a renewal for ANY policyId. This member
 * variant enforces ownership FIRST via memberGuards.assertPolicyOwnershipDual
 * (dual-space callerPolicyScope per memberPolicies: portal-filed rows pin
 * customerId = ctx.user.id, wallet-era rows pin resolved customers.id — both
 * are the caller's OWN identities). The status/dup-guard/insert/fluvio logic
 * is copied verbatim from the source (per the worklist: copy with a dated
 * comment). The source emits a fluvio "policy.renewal_requested" event; the
 * emit helper is copied (non-blocking).
 *
 * Identity space for myRenewals (2026-10-01, R3-b5 decision): DUAL-space per
 * memberPolicies — the read joins policy_renewals ⋈ policies and scopes
 * policies.customerId to BOTH the caller's users.id and resolved
 * customers.id. (The worklist asked to pick ONE and document; dual-space is
 * the memberPolicies precedent and cannot leak foreign rows since both ids
 * resolve from the session.)
 *
 * payRenewal is deliberately NOT exposed here — it moves funds (TigerBeetle)
 * and is deferred to the funds wave (worklist §4d).
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR; ownership miss → NOT_FOUND
 * (non-enumerating).
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  customers,
  fluvioEventLog,
  policies,
  policyRenewals,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { assertPolicyOwnershipDual } from "../lib/memberGuards";
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
 * Resolve the session customer: customers.keycloakSub = String(ctx.user.id)
 * (memberPolicies.resolveSessionCustomer pattern, 2026-10-01 R3-b5 copy).
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
 * 2026-10-01 (R3-b5): non-blocking fluvio event emit — copied from
 * insuranceWorkflows.emitFluvioEvent (the Dapr fan-out inside the source
 * helper is non-blocking/fail-open there too; here we keep only the durable
 * fluvio_event_log row, which is the auditable member-facing record).
 */
async function emitFluvioEvent(
  d: DrizzleDb,
  topic: string,
  payload: Record<string, unknown>
) {
  try {
    await d.insert(fluvioEventLog).values({
      topic,
      payload,
      processedAt: new Date(),
      status: "processed",
    });
  } catch {
    // Non-blocking
  }
}

export const memberRenewalsRouter = router({
  /**
   * Caller's renewals, newest first, joined to policies for the policy
   * number. Dual-space scoped (see header); a caller with no policies gets an
   * honest empty list (count 0), never fabricated rows.
   */
  myRenewals: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const d = await db();
      const customer = await resolveSessionCustomer(d, ctx.user.id);
      const scope = or(
        eq(policies.customerId, ctx.user.id),
        customer ? eq(policies.customerId, customer.id) : undefined
      );
      const rows = await d
        .select({
          id: policyRenewals.id,
          originalPolicyId: policyRenewals.originalPolicyId,
          policyNumber: policies.policyNumber,
          status: policyRenewals.status,
          renewalDueDate: policyRenewals.renewalDueDate,
          renewalPremium: policyRenewals.renewalPremium,
          isAutoRenewal: policyRenewals.isAutoRenewal,
          completedAt: policyRenewals.completedAt,
          createdAt: policyRenewals.createdAt,
        })
        .from(policyRenewals)
        .innerJoin(policies, eq(policies.id, policyRenewals.originalPolicyId))
        .where(scope)
        .orderBy(desc(policyRenewals.id))
        .limit(input?.limit ?? 50)
        .offset(input?.offset ?? 0);
      const [countRow] = await d
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(policyRenewals)
        .innerJoin(policies, eq(policies.id, policyRenewals.originalPolicyId))
        .where(scope);
      return {
        renewals: rows.map((r) => ({
          ...r,
          // Platform settlement currency (NGN) — member surface convention.
          currency: "NGN",
        })),
        count: countRow?.count ?? 0,
      };
    }),

  /**
   * PH-5 member variant: request a renewal for an OWNED policy.
   * Ownership guard FIRST (the source proc is an IDOR — see header), then
   * the source's status gate (only active/bound), one-open-renewal duplicate
   * guard, insert, and fluvio event (insuranceWorkflows.requestRenewal,
   * 2026-10-01 R3-b5 copy). No funds movement.
   */
  requestRenewal: protectedProcedure
    .input(
      z.object({
        policyId: z.number().int().positive(),
        isAutoRenewal: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const customer = await resolveSessionCustomer(d, ctx.user.id);
      // 2026-10-01 (R3-b5): ownership guard closes the source IDOR BEFORE any
      // policy read/write. NOT_FOUND on miss — non-enumerating.
      await assertPolicyOwnershipDual(
        d,
        input.policyId,
        ctx.user.id,
        customer?.id ?? null
      );

      const [policy] = await d
        .select({
          id: policies.id,
          status: policies.status,
          endDate: policies.endDate,
          annualPremium: policies.annualPremium,
        })
        .from(policies)
        .where(eq(policies.id, input.policyId))
        .limit(1);
      if (!policy)
        throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      // INS-11: only live policies can be renewed — never cancelled/expired ones.
      if (!["active", "bound"].includes(policy.status ?? "")) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Policy status '${policy.status}' cannot be renewed`,
        });
      }

      // INS-11: duplicate-renewal guard — one open renewal per policy.
      const existing = await d
        .select({ id: policyRenewals.id })
        .from(policyRenewals)
        .where(
          and(
            eq(policyRenewals.originalPolicyId, input.policyId),
            eq(policyRenewals.status, "pending")
          )
        )
        .limit(1);
      if (existing.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An open renewal already exists for this policy",
        });
      }

      const [renewal] = await d
        .insert(policyRenewals)
        .values({
          originalPolicyId: input.policyId,
          renewalDueDate: policy.endDate ?? new Date(),
          renewalPremium: policy.annualPremium,
          isAutoRenewal: input.isAutoRenewal ?? false,
          status: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      await emitFluvioEvent(d, "policy-events", {
        eventType: "policy.renewal_requested",
        policyId: input.policyId,
      });
      return { renewal };
    }),
});
