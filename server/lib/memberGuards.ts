/**
 * memberGuards.ts — R3 batch 1 (2026-10-01, R3)
 *
 * Ownership guards for member-facing procedures. The first consumer is
 * insuranceProductCatalog.calculatePremium: when an optional `policyId` is
 * supplied, that proc reads the policy-linked telematics_scores row (member
 * behavioral data) — the worklist requires verifying
 * `policies.customerId = ctx.user.id` before that read. Wired at integration
 * time into calculatePremium; this module is deliberately standalone so the
 * existing router file is left untouched by the R3 batch-1 agents.
 *
 * Fail-closed, non-enumerating: a policy that does not exist OR belongs to
 * another member both throw NOT_FOUND (callers must not learn whether a
 * foreign policy id exists).
 */
import { TRPCError } from "@trpc/server";
import { and, eq, or } from "drizzle-orm";

import { policies } from "../../drizzle/schema";
import type { getDb } from "../db";

export type DrizzleDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * Assert that `policyId` exists and is owned by `userId`
 * (policies.customerId = userId). Throws TRPCError NOT_FOUND on any miss —
 * never FORBIDDEN, so foreign ids are not enumerable.
 */
export async function assertPolicyOwnership(
  db: DrizzleDb,
  policyId: number,
  userId: number
): Promise<void> {
  const [row] = await db
    .select({ id: policies.id, customerId: policies.customerId })
    .from(policies)
    .where(eq(policies.id, policyId))
    .limit(1);
  if (!row || row.customerId !== userId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Policy not found",
    });
  }
}

/**
 * 2026-10-01 (R3-b5): dual-space variant of assertPolicyOwnership.
 * policies.customerId is written in TWO identity spaces with no FK
 * (schema.ts:4919) — portal-filed rows pin customerId = ctx.user.id
 * (users.id; insuranceWorkflows.ts ~337), customer-wallet-era rows pin the
 * resolved customers.id (customers.keycloakSub = String(ctx.user.id)).
 * memberPolicies.callerPolicyScope documents this. The single-space guard
 * above would WRONGLY reject a caller whose policy lives in the
 * customers.id space, so member renewal/endorsement mutations (which also
 * resolve the session customer) use this variant. Both spaces are the
 * caller's OWN identities — OR-ing them is fail-closed; no foreign row can
 * enter the scope. Same non-enumerating NOT_FOUND contract.
 */
export async function assertPolicyOwnershipDual(
  db: DrizzleDb,
  policyId: number,
  userId: number,
  customerId: number | null
): Promise<void> {
  const [row] = await db
    .select({ id: policies.id })
    .from(policies)
    .where(
      and(
        eq(policies.id, policyId),
        or(
          eq(policies.customerId, userId),
          customerId != null ? eq(policies.customerId, customerId) : undefined
        )
      )
    )
    .limit(1);
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Policy not found",
    });
  }
}
