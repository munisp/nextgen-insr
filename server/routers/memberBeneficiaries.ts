/**
 * memberBeneficiaries.ts — R3 batch 5 member surface (2026-10-01, R3-b5)
 *
 * Member-scoped beneficiary lifecycle for the PWA
 * (customer-portal-full/client/src/services/memberLifecycleApi.ts → mounted
 * as `memberBeneficiaries`). Source: insuranceWorkflows
 * (server/routers/insuranceWorkflows.ts) BEN-1/BEN-2/BEN-3 procs
 * (upsertBeneficiary ~1910, removeBeneficiary ~1981, listBeneficiaries
 * ~2000).
 *
 * Worklist claim verification (2026-10-01, R3-b5): the claim that the three
 * source beneficiary procs are owner-checked is TRUE — each fetches the
 * policy and enforces `policy.customerId === ctx.user.id` or the admin role
 * (upsertBeneficiary insuranceWorkflows.ts:1926-1929, removeBeneficiary
 * :1988-1992, listBeneficiaries :2008-2012). Two gaps this member variant
 * closes:
 *   1. The source check is SINGLE-space (users.id only); customer-wallet-era
 *      policies pin policies.customerId = resolved customers.id
 *      (memberPolicies callerPolicyScope, R3-b1). This router enforces the
 *      caller-bound DUAL-space scope so wallet-era members are not wrongly
 *      rejected.
 *   2. The source throws FORBIDDEN on foreign ownership, which confirms the
 *      policy EXISTS (enumeration). This router throws NOT_FOUND on any
 *      ownership miss (memberGuards.assertPolicyOwnershipDual) — foreign
 *      policy ids are never enumerable.
 * The 100%-percentage-sum and minor-requires-guardian validations are copied
 * verbatim from the source (per the worklist: copy with a dated comment).
 *
 * PII: beneficiary rows carry third-party PII (name, DoB, relationship,
 * guardianName, nationalId of people OTHER than the caller). List responses
 * mask nationalId (last-2 only); the full nationalId is stored but never
 * returned by any member proc.
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR; ownership miss → NOT_FOUND.
 */
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { auditLog, beneficiaries, customers, policies } from "../../drizzle/schema";
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
 * Returns null when no profile exists — the users.id identity still scopes
 * portal-filed policies.
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
 * Caller-bound dual-space ownership assert (memberGuards,
 * 2026-10-01 R3-b5): NOT_FOUND on any miss — never FORBIDDEN, so foreign
 * policy ids are not enumerable.
 */
async function requireOwnedPolicy(
  d: DrizzleDb,
  policyId: number,
  userId: number
): Promise<void> {
  const customer = await resolveSessionCustomer(d, userId);
  await assertPolicyOwnershipDual(d, policyId, userId, customer?.id ?? null);
}

/** 2026-10-01 (R3-b5): non-blocking audit entry (insuranceWorkflows emitAuditLog shape). */
async function emitAuditLog(
  d: DrizzleDb,
  action: string,
  entityId: string | number,
  userId: number,
  details: Record<string, unknown>
) {
  try {
    await d.insert(auditLog).values({
      action,
      resource: "policy",
      resourceId: String(entityId),
      agentId: userId,
      metadata: { ...details, userId },
      createdAt: new Date(),
    });
  } catch {
    // Non-blocking
  }
}

/**
 * 2026-10-01 (R3-b5): mask a third-party national id for list responses —
 * last 2 characters only. The full value is stored (upsert) but never
 * returned to the member UI.
 */
function maskNationalId(nationalId: string | null): string | null {
  if (!nationalId) return null;
  return `***${nationalId.slice(-2)}`;
}

const upsertInput = z.object({
  policyId: z.number().int().positive(),
  name: z.string().min(1).max(256),
  relationship: z.string().min(1).max(64),
  percentage: z.number().positive().max(100),
  dateOfBirth: z.string().optional(),
  isMinor: z.boolean().optional(),
  guardianName: z.string().max(256).optional(),
  nationalId: z.string().max(64).optional(),
  beneficiaryId: z.number().int().positive().optional(),
});

export const memberBeneficiariesRouter = router({
  /**
   * BEN-3 member variant: the caller's beneficiaries for an OWNED policy.
   * NOT_FOUND on miss or foreign ownership (non-enumerating). nationalId is
   * masked in the response (PII of third parties).
   */
  myBeneficiaries: protectedProcedure
    .input(z.object({ policyId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const d = await db();
      await requireOwnedPolicy(d, input.policyId, ctx.user.id);
      const items = await d
        .select({
          id: beneficiaries.id,
          policyId: beneficiaries.policyId,
          name: beneficiaries.name,
          relationship: beneficiaries.relationship,
          percentage: beneficiaries.percentage,
          dateOfBirth: beneficiaries.dateOfBirth,
          isMinor: beneficiaries.isMinor,
          guardianName: beneficiaries.guardianName,
          nationalId: beneficiaries.nationalId,
          createdAt: beneficiaries.createdAt,
          updatedAt: beneficiaries.updatedAt,
        })
        .from(beneficiaries)
        .where(eq(beneficiaries.policyId, input.policyId));
      return {
        items: items.map((b) => ({
          ...b,
          nationalId: maskNationalId(b.nationalId),
        })),
      };
    }),

  /**
   * BEN-1 member variant: add or update a beneficiary on an OWNED policy.
   * Ownership assert (dual-space, NOT_FOUND) FIRST; then the source's
   * minor/guardian and 100%-sum validations verbatim
   * (insuranceWorkflows.upsertBeneficiary, 2026-10-01 R3-b5 copy).
   */
  upsertBeneficiary: protectedProcedure
    .input(upsertInput)
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      await requireOwnedPolicy(d, input.policyId, ctx.user.id);

      // Minor/guardian rule: a minor beneficiary MUST name a guardian.
      const dob = input.dateOfBirth ? new Date(input.dateOfBirth) : null;
      const isMinor =
        input.isMinor ??
        (dob != null && Date.now() - dob.getTime() < 18 * 365.25 * 86_400_000);
      if (isMinor && !input.guardianName) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A minor beneficiary requires a guardianName",
        });
      }

      // Percentage-sum validation across the policy's beneficiaries
      // (excluding the row being replaced): the total may never exceed 100%.
      const existing = await d
        .select({ id: beneficiaries.id, percentage: beneficiaries.percentage })
        .from(beneficiaries)
        .where(eq(beneficiaries.policyId, input.policyId));
      const otherTotal = existing
        .filter((b) => b.id !== input.beneficiaryId)
        .reduce((acc, b) => acc + Number(b.percentage), 0);
      const newTotal = Math.round((otherTotal + input.percentage) * 100) / 100;
      if (newTotal > 100) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Beneficiary percentages would total ${newTotal}% (> 100%)`,
        });
      }

      let row;
      if (input.beneficiaryId != null) {
        const updated = await d
          .update(beneficiaries)
          .set({
            name: input.name,
            relationship: input.relationship,
            percentage: String(input.percentage),
            dateOfBirth: dob,
            isMinor,
            guardianName: input.guardianName ?? null,
            nationalId: input.nationalId ?? null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(beneficiaries.id, input.beneficiaryId),
              eq(beneficiaries.policyId, input.policyId)
            )
          )
          .returning({ id: beneficiaries.id });
        if (updated.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Beneficiary not found for this policy",
          });
        }
        row = updated[0];
      } else {
        [row] = await d
          .insert(beneficiaries)
          .values({
            policyId: input.policyId,
            name: input.name,
            relationship: input.relationship,
            percentage: String(input.percentage),
            dateOfBirth: dob,
            isMinor,
            guardianName: input.guardianName ?? null,
            nationalId: input.nationalId ?? null,
          })
          .returning({ id: beneficiaries.id });
      }
      await emitAuditLog(d, "BENEFICIARY_UPSERTED", input.policyId, ctx.user.id, {
        beneficiaryId: row.id,
        source: "memberBeneficiaries.upsertBeneficiary",
      });
      return { success: true, beneficiaryId: row.id };
    }),

  /**
   * BEN-2 member variant: remove a beneficiary from an OWNED policy.
   * NOT_FOUND on ownership miss or beneficiary miss (non-enumerating).
   */
  removeBeneficiary: protectedProcedure
    .input(
      z.object({
        policyId: z.number().int().positive(),
        beneficiaryId: z.number().int().positive(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      await requireOwnedPolicy(d, input.policyId, ctx.user.id);
      const deleted = await d
        .delete(beneficiaries)
        .where(
          and(
            eq(beneficiaries.id, input.beneficiaryId),
            eq(beneficiaries.policyId, input.policyId)
          )
        )
        .returning({ id: beneficiaries.id });
      if (deleted.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Beneficiary not found for this policy",
        });
      }
      await emitAuditLog(d, "BENEFICIARY_REMOVED", input.policyId, ctx.user.id, {
        beneficiaryId: input.beneficiaryId,
        source: "memberBeneficiaries.removeBeneficiary",
      });
      return { success: true };
    }),
});
