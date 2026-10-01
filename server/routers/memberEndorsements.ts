/**
 * memberEndorsements.ts — R3 batch 5 member surface (2026-10-01, R3-b5)
 *
 * Member-scoped policy endorsement surface for the PWA
 * (customer-portal-full/client/src/services/memberLifecycleApi.ts → mounted
 * as `memberEndorsements`). Source: insuranceWorkflows.requestEndorsement
 * (server/routers/insuranceWorkflows.ts:2307).
 *
 * Worklist claim verification (2026-10-01, R3-b5): the claim that
 * requestEndorsement is an IDOR is TRUE — the source inserts an endorsement
 * for ANY caller-supplied policyId without fetching the policy or checking
 * ownership at all (insuranceWorkflows.ts:2307-2342). This member variant
 * enforces ownership FIRST via memberGuards.assertPolicyOwnershipDual
 * (dual-space callerPolicyScope per memberPolicies — see memberRenewals
 * header). The insert + fluvio event logic is copied verbatim from the
 * source (per the worklist: copy with a dated comment).
 *
 * premiumAdjustment is a REQUEST field only — a member-proposed adjustment
 * recorded on the endorsement row for staff review. It is NOT a charge: no
 * ledger entry, no TigerBeetle transfer, no funds movement of any kind
 * happens here (funds wave is deferred, worklist §4d).
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR; ownership miss → NOT_FOUND
 * (non-enumerating).
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  customers,
  endorsements,
  fluvioEventLog,
  policies,
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
 * insuranceWorkflows.emitFluvioEvent (durable fluvio_event_log row only).
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

export const memberEndorsementsRouter = router({
  /**
   * Caller's endorsements, newest first, joined to policies for the policy
   * number. Dual-space scoped (policies.customerId IN caller's two
   * identities). Optional policyId filter: a foreign policyId yields an
   * honest empty list (count 0) — never an error that confirms existence.
   */
  myEndorsements: protectedProcedure
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
      const scope = and(
        or(
          eq(policies.customerId, ctx.user.id),
          customer ? eq(policies.customerId, customer.id) : undefined
        ),
        input?.policyId ? eq(endorsements.policyId, input.policyId) : undefined
      );
      const rows = await d
        .select({
          id: endorsements.id,
          endorsementNumber: endorsements.endorsementNumber,
          policyId: endorsements.policyId,
          policyNumber: policies.policyNumber,
          type: endorsements.type,
          effectiveDate: endorsements.effectiveDate,
          description: endorsements.description,
          premiumAdjustment: endorsements.premiumAdjustment,
          sumInsuredAdjustment: endorsements.sumInsuredAdjustment,
          approvedAt: endorsements.approvedAt,
          createdAt: endorsements.createdAt,
        })
        .from(endorsements)
        .innerJoin(policies, eq(policies.id, endorsements.policyId))
        .where(scope)
        .orderBy(desc(endorsements.id))
        .limit(input?.limit ?? 50)
        .offset(input?.offset ?? 0);
      const [countRow] = await d
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(endorsements)
        .innerJoin(policies, eq(policies.id, endorsements.policyId))
        .where(scope);
      return {
        endorsements: rows.map((r) => ({
          ...r,
          // Platform settlement currency (NGN) — member surface convention.
          currency: "NGN",
        })),
        count: countRow?.count ?? 0,
      };
    }),

  /**
   * EN-1 member variant: request an endorsement on an OWNED policy.
   * Ownership guard FIRST (the source proc is an IDOR — see header), then
   * the source's insert + fluvio event verbatim
   * (insuranceWorkflows.requestEndorsement, 2026-10-01 R3-b5 copy).
   * premiumAdjustment/sumInsuredAdjustment are recorded REQUEST fields — no
   * funds movement (see header).
   */
  requestEndorsement: protectedProcedure
    .input(
      z.object({
        policyId: z.number().int().positive(),
        type: z.enum([
          "addition",
          "deletion",
          "modification",
          "extension",
          "reduction",
          "cancellation",
          "reinstatement",
        ]),
        effectiveDate: z.string(),
        description: z.string().min(1).max(4096),
        premiumAdjustment: z.number().optional(),
        sumInsuredAdjustment: z.number().optional(),
        changesDetail: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const customer = await resolveSessionCustomer(d, ctx.user.id);
      // 2026-10-01 (R3-b5): ownership guard closes the source IDOR BEFORE any
      // write. NOT_FOUND on miss — non-enumerating.
      await assertPolicyOwnershipDual(
        d,
        input.policyId,
        ctx.user.id,
        customer?.id ?? null
      );

      const endorsementNumber = `END-${Date.now()}-${input.policyId}`;
      const [endorsement] = await d
        .insert(endorsements)
        .values({
          endorsementNumber,
          policyId: input.policyId,
          type: input.type,
          effectiveDate: new Date(input.effectiveDate),
          description: input.description,
          premiumAdjustment: input.premiumAdjustment
            ? String(input.premiumAdjustment)
            : "0",
          sumInsuredAdjustment: input.sumInsuredAdjustment
            ? String(input.sumInsuredAdjustment)
            : "0",
          changesDetail: input.changesDetail ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      await emitFluvioEvent(d, "policy-events", {
        eventType: "policy.endorsement_requested",
        policyId: input.policyId,
        endorsementNumber,
        type: input.type,
      });

      return { endorsement, endorsementNumber };
    }),
});
