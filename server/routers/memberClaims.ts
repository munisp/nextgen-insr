/**
 * memberClaims.ts — R3 batch 1 member surface (2026-10-01, R3)
 *
 * Member-scoped claims surface for the PWA
 * (customer-portal-full/client/src/services/memberClaimsApi.ts → mounted as
 * `memberClaims`). The domain router server/routers/insuranceWorkflows.ts is
 * deliberately staff/tenant-gated for listing (listPolicies/listClaims FORBID
 * tenant-0 portal members) — this router gives members an honest caller-scoped
 * view without opening the admin procs:
 *
 *   - myClaims:          claims.claimantId = ctx.user.id (claimantId IS
 *                        users.id — same precedent as parametricMember.myPayouts,
 *                        R2), joined to policies for the policy number.
 *   - myClaim:           single claim + its claim_documents, same claimantId
 *                        scope; NOT_FOUND on miss (non-enumerating — a foreign
 *                        claim id is indistinguishable from a nonexistent one).
 *   - fileClaim:         thin member wrapper over insuranceWorkflows.fileClaim
 *                        (the one real implementation — window checks, sum-
 *                        insured bound, AB-7 duplicate/doc-hash dedup, lifecycle
 *                        holds all stay there). This wrapper re-verifies
 *                        policies.customerId = ctx.user.id FIRST and answers
 *                        NOT_FOUND (never FORBIDDEN) for foreign/nonexistent
 *                        policies so the member surface does not enumerate
 *                        other members' policies.
 *   - myPoliciesPicker:  the caller's ACTIVE policies only — feeds the
 *                        FileClaim.tsx policy picker (never a hardcoded list).
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR; no fabricated claim data.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  claimDocuments,
  claims,
  customers,
  insuranceProducts,
  policies,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { resolveMemberCustomer } from "../lib/memberFunds";
import { assertPolicyOwnershipDual } from "../lib/memberGuards";
import { insuranceWorkflowsRouter } from "./insuranceWorkflows";

type DrizzleDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function db(): Promise<DrizzleDb> {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
  return d;
}

// 2026-10-01 (R3): member-facing subset of the claim_status pgEnum
// (drizzle/schema.ts claimStatusEnum). Staff-only queue states
// (investigation/pending_adjudication) are still selectable server-side but
// not advertised in the PWA filter.
const CLAIM_STATUSES = [
  "submitted",
  "under_review",
  "investigation",
  "approved",
  "partially_approved",
  "rejected",
  "paid",
  "closed",
  "appealed",
  "escalated",
  "pending_adjudication",
] as const;

export const memberClaimsRouter = router({
  /**
   * Caller's claims, newest first. Read-only, caller-scoped via
   * claims.claimantId = ctx.user.id.
   */
  myClaims: protectedProcedure
    .input(
      z
        .object({
          status: z.enum(CLAIM_STATUSES).optional(),
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const d = await db();
      const scope = and(
        eq(claims.claimantId, ctx.user.id),
        input?.status ? eq(claims.status, input.status) : undefined
      );
      const rows = await d
        .select({
          id: claims.id,
          claimNumber: claims.claimNumber,
          policyId: claims.policyId,
          policyNumber: policies.policyNumber,
          status: claims.status,
          claimType: claims.claimType,
          incidentDate: claims.incidentDate,
          reportedDate: claims.reportedDate,
          claimedAmount: claims.claimedAmount,
          approvedAmount: claims.approvedAmount,
          paidAmount: claims.paidAmount,
          createdAt: claims.createdAt,
        })
        .from(claims)
        .innerJoin(policies, eq(policies.id, claims.policyId))
        .where(scope)
        .orderBy(desc(claims.id))
        .limit(input?.limit ?? 50)
        .offset(input?.offset ?? 0);

      const [countRow] = await d
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(claims)
        .where(scope);

      return { claims: rows, count: countRow?.count ?? 0 };
    }),

  /**
   * Single claim detail (status + amounts + uploaded document metadata) for
   * the caller's own claim. NOT_FOUND for foreign ids — non-enumerating.
   */
  myClaim: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const d = await db();
      const [claim] = await d
        .select({
          id: claims.id,
          claimNumber: claims.claimNumber,
          policyId: claims.policyId,
          policyNumber: policies.policyNumber,
          status: claims.status,
          claimType: claims.claimType,
          incidentDate: claims.incidentDate,
          reportedDate: claims.reportedDate,
          claimedAmount: claims.claimedAmount,
          approvedAmount: claims.approvedAmount,
          paidAmount: claims.paidAmount,
          deductible: claims.deductible,
          incidentDescription: claims.incidentDescription,
          rejectionReason: claims.rejectionReason,
          settlementDate: claims.settlementDate,
          createdAt: claims.createdAt,
          updatedAt: claims.updatedAt,
        })
        .from(claims)
        .innerJoin(policies, eq(policies.id, claims.policyId))
        .where(and(eq(claims.id, input.id), eq(claims.claimantId, ctx.user.id)))
        .limit(1);
      if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });

      const docs = await d
        .select({
          id: claimDocuments.id,
          documentType: claimDocuments.documentType,
          fileName: claimDocuments.fileName,
          fileUrl: claimDocuments.fileUrl,
          fileSize: claimDocuments.fileSize,
          mimeType: claimDocuments.mimeType,
          isVerified: claimDocuments.isVerified,
          createdAt: claimDocuments.createdAt,
        })
        .from(claimDocuments)
        .where(eq(claimDocuments.claimId, claim.id))
        .orderBy(desc(claimDocuments.id))
        .limit(100);

      return { claim, documents: docs };
    }),

  /**
   * File a claim against one of the CALLER'S policies. Re-verifies ownership
   * here (NOT_FOUND — non-enumerating — for foreign/nonexistent policies),
   * then delegates to insuranceWorkflows.fileClaim via createCaller so all
   * lifecycle/dedup/doc-hash validation and the claim insert stay in the one
   * real implementation (same R2 delegation pattern as freemiumTiers.upgrade).
   */
  fileClaim: protectedProcedure
    .input(
      z.object({
        policyId: z.number().int().positive(),
        claimType: z.string().min(1).max(64),
        incidentDate: z.string().min(1),
        claimedAmount: z.number().positive(),
        incidentDescription: z.string().min(1).max(4000),
        documents: z.array(z.string().min(1).max(512)).max(20).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const [policy] = await d
        .select({ id: policies.id, customerId: policies.customerId, status: policies.status })
        .from(policies)
        .where(eq(policies.id, input.policyId))
        .limit(1);
      // Fail-closed + non-enumerating: a member cannot distinguish (or probe)
      // policies they do not own.
      if (!policy || policy.customerId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      }
      if (policy.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Policy is not active" });
      }

      const caller = insuranceWorkflowsRouter.createCaller(ctx);
      return caller.fileClaim({
        policyId: input.policyId,
        claimType: input.claimType,
        incidentDate: input.incidentDate,
        claimedAmount: input.claimedAmount,
        incidentDescription: input.incidentDescription,
        documents: input.documents,
      });
    }),

  /**
   * W11-B1a (2026-10-05): member-safe claim-form prefill for one of the
   * CALLER'S policies. Ownership is dual-space
   * (memberGuards.assertPolicyOwnershipDual — portal rows pin
   * policies.customerId = ctx.user.id, wallet-era rows pin the resolved
   * customers.id); any miss → NOT_FOUND (non-enumerating).
   *
   * Returns ONLY fields that actually exist in the schema:
   *   - policy: policyNumber / coverageType / sumInsured / annualPremium /
   *     startDate / endDate / status + product name/code (insurance_products
   *     join). `assetDetails` is policies.metadata verbatim — the ONLY
   *     insured-asset detail carrier on the policy record (schema.ts:4938);
   *     null when the policy has none.
   *   - member: the caller's contact from the session-resolved customers row
   *     (null when the member has no customer profile — the users.id identity
   *     still owns portal-filed policies).
   *   - lastClaim: the caller's most recent claim against THIS policy
   *     (claimantId = ctx.user.id — claims.claimantId is users.id, same
   *     precedent as myClaims) or null.
   */
  getClaimPrefill: protectedProcedure
    .input(z.object({ policyId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const d = await db();
      const customer = await resolveMemberCustomer(d, ctx.user.id);
      await assertPolicyOwnershipDual(d, input.policyId, ctx.user.id, customer?.id ?? null);

      const [policy] = await d
        .select({
          id: policies.id,
          policyNumber: policies.policyNumber,
          status: policies.status,
          coverageType: policies.coverageType,
          sumInsured: policies.sumInsured,
          annualPremium: policies.annualPremium,
          startDate: policies.startDate,
          endDate: policies.endDate,
          assetDetails: policies.metadata,
          productName: insuranceProducts.name,
          productCode: insuranceProducts.productCode,
        })
        .from(policies)
        .innerJoin(insuranceProducts, eq(insuranceProducts.id, policies.productId))
        .where(eq(policies.id, input.policyId))
        .limit(1);
      // Ownership was asserted above; a missing join row means inconsistent
      // product reference — fail closed, never fabricate.
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });

      const [lastClaim] = await d
        .select({
          claimNumber: claims.claimNumber,
          status: claims.status,
          claimType: claims.claimType,
          claimedAmount: claims.claimedAmount,
          incidentDate: claims.incidentDate,
          createdAt: claims.createdAt,
        })
        .from(claims)
        .where(and(eq(claims.policyId, input.policyId), eq(claims.claimantId, ctx.user.id)))
        .orderBy(desc(claims.id))
        .limit(1);

      let member: {
        firstName: string;
        lastName: string;
        email: string | null;
        phone: string | null;
      } | null = null;
      if (customer) {
        const [c] = await d
          .select({
            firstName: customers.firstName,
            lastName: customers.lastName,
            email: customers.email,
            phone: customers.phone,
          })
          .from(customers)
          .where(eq(customers.id, customer.id))
          .limit(1);
        member = c ?? null;
      }

      return { policy, member, lastClaim: lastClaim ?? null };
    }),

  /**
   * The caller's ACTIVE policies — the real policy picker source for   * FileClaim.tsx. Caller-scoped via policies.customerId = ctx.user.id
   * (same convention as parametricMember.myCoverage, R2).
   */
  myPoliciesPicker: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const rows = await d
      .select({
        id: policies.id,
        policyNumber: policies.policyNumber,
        productName: insuranceProducts.name,
        sumInsured: policies.sumInsured,
        startDate: policies.startDate,
        endDate: policies.endDate,
        status: policies.status,
      })
      .from(policies)
      .innerJoin(insuranceProducts, eq(insuranceProducts.id, policies.productId))
      .where(and(eq(policies.customerId, ctx.user.id), eq(policies.status, "active")))
      .orderBy(desc(policies.id))
      .limit(100);

    return { policies: rows };
  }),
});
