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
import { eq } from "drizzle-orm";

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
