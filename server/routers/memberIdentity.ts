/**
 * memberIdentity.ts — R3 batch 4 member surface (2026-10-01, R3-b4)
 *
 * Member-scoped KYC / identity surface for the PWA
 * (customer-portal-full/client/src/services/identityApi.ts → mounted as
 * `memberIdentity`). IDENTITY IS THE HIGHEST-RISK DOMAIN: the R3-b4 worklist
 * (r4/worklist-b4.md) audited all 9 identity mounts and classified most of
 * them as fabricated-identity / IDOR — this router exposes ONLY the seven
 * procs below and deliberately never wraps:
 *
 *   - faceEnrollment.enroll / faceEnrollment.verify — FABRICATED identity:
 *     enroll stores a client-computed 512-d embedding plus SELF-DECLARED
 *     livenessScore/antiSpoofScore as an active credential with audit
 *     outcome "pass" (self-attested identity). Never exposed, not wrapped.
 *   - decentralizedIdentityManager.verifyIdentity — FABRICATED: sets
 *     agents.isActive=true for any client-supplied agentId, no provider check.
 *   - kycDocumentManagement.approve/reject — phantom review: returns
 *     success:true without writing anything.
 *   - biometricAuth.fullVerification — real provider results, but persists
 *     them into kycSessions by CLIENT-SUPPLIED sessionRef with no ownership
 *     check (IDOR). Wrapper deferred to the member enroll-flow wave.
 *   - all mfaManager mutations — no TOTP/SMS/WebAuthn capability exists
 *     in-tree or in the Keycloak realm; they fail loud. myMfaStatus reports
 *     the same honest state (constant copied from mfaManager.ts:13-17 —
 *     module-private, copy per worklist, wording kept identical).
 *
 * Identity rule: resolve the session customer via
 * `customers.keycloakSub = String(ctx.user.id)` (memberPolicies /
 * memberSavings resolveSessionCustomer pattern). Face enrollments are scoped
 * `faceEnrollments.userId = ctx.user.id` (users.id space — that is how
 * faceEnrollment.ts writes them, never trust client-supplied ids).
 *
 * PII rule: kycSessions.bvn / nin are AES-256-GCM encrypted at rest
 * (server/lib/piiCrypto.ts); bvn, nin, hashes, docExtractedIdNumber, ocrRaw,
 * livenessRaw, selfieUrl, idDocUrl and embeddingVector are NEVER selected
 * into any payload here.
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR; no customer profile → honest
 * "unstarted" empty state from myKycStatus (NOT_FOUND would be enumerating
 * nothing, but the PWA needs the disclosed empty state); foreign
 * enrollmentId revoke → NOT_FOUND with zero rows changed.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  biometricAuditEvents,
  customers,
  faceEnrollments,
  kycSessions,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { isLockedOut } from "../middleware/livenessSecurityEnhancements";

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
 * (memberPolicies/memberSavings pattern, 2026-10-01 R3-b4 copy). Returns null
 * when the session user has no customer profile — callers decide the honest
 * empty state; never enumerate other members.
 */
async function resolveSessionCustomer(d: DrizzleDb, userId: number) {
  const [customer] = await d
    .select({ id: customers.id, kycLevel: customers.kycLevel })
    .from(customers)
    .where(eq(customers.keycloakSub, String(userId)))
    .limit(1);
  return customer ?? null;
}

/**
 * 2026-10-01 (R3-b4): copied verbatim from mfaManager.ts (lines 13-17) — the
 * constant is module-private and the worklist forbids importing the router.
 * Keep the wording identical so both surfaces report the same honest state.
 */
const MFA_UNAVAILABLE_REASON =
  "MFA enrollment is not implemented: this deployment has no TOTP/SMS/WebAuthn " +
  "verification capability (no in-tree authenticator, and the Keycloak realm " +
  "has no MFA flow configured). Do not rely on MFA for step-up; financial " +
  "operations are gated by role + maker-checker instead.";

const KYC_ENFORCEMENT_URL =
  process.env.KYC_ENFORCEMENT_URL || "http://localhost:8211";

/** Columns myFaceEnrollments/myActiveFaceEnrollment may return — NEVER the
 * embeddingVector or source/device provenance hashes. */
const faceEnrollmentMemberProjection = {
  id: faceEnrollments.id,
  enrollmentType: faceEnrollments.enrollmentType,
  embeddingVersion: faceEnrollments.embeddingVersion,
  qualityScore: faceEnrollments.qualityScore,
  livenessScore: faceEnrollments.livenessScore,
  isActive: faceEnrollments.isActive,
  createdAt: faceEnrollments.createdAt,
  expiresAt: faceEnrollments.expiresAt,
  revokedAt: faceEnrollments.revokedAt,
} as const;

export const memberIdentityRouter = router({
  /**
   * Latest KYC session for the caller's RESOLVED customer (customers.id
   * space — members are not agents, so kyc.getStatus cannot serve them).
   * PII-safe projection only; bvn/nin/raw biometrics are never selected.
   */
  myKycStatus: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const customer = await resolveSessionCustomer(d, ctx.user.id);
    if (!customer) {
      // Honest empty state — dual-space tolerance as memberPolicies: the
      // session user simply has no customer profile on this deployment.
      return {
        hasProfile: false,
        hasSession: false,
        status: "unstarted",
        kycLevel: 0,
        session: null,
      };
    }

    const [session] = await d
      .select({
        id: kycSessions.id,
        status: kycSessions.status,
        type: kycSessions.type,
        livenessPassed: kycSessions.livenessPassed,
        livenessScore: kycSessions.livenessScore,
        docType: kycSessions.docType,
        docConfidence: kycSessions.docConfidence,
        rejectionReason: kycSessions.rejectionReason,
        reviewedAt: kycSessions.reviewedAt,
        expiresAt: kycSessions.expiresAt,
        createdAt: kycSessions.createdAt,
        updatedAt: kycSessions.updatedAt,
      })
      .from(kycSessions)
      .where(eq(kycSessions.customerId, customer.id))
      .orderBy(desc(kycSessions.createdAt))
      .limit(1);

    return {
      hasProfile: true,
      hasSession: !!session,
      status: session?.status ?? "unstarted",
      kycLevel: Number(customer.kycLevel ?? 0),
      session: session
        ? {
            ...session,
            livenessScore: session.livenessScore
              ? Number(session.livenessScore)
              : null,
            docConfidence: session.docConfidence
              ? Number(session.docConfidence)
              : null,
          }
        : null,
    };
  }),

  /**
   * Delegate-equivalent of mfaManager.getMfaStatus (member-safe-as-is per
   * worklist §1): reports the DB flag as-is plus the hard truth that no
   * second factor can actually be enrolled in this deployment.
   */
  myMfaStatus: protectedProcedure.query(({ ctx }) => {
    return {
      mfaEnabled: ctx.user.mfaEnabled ?? false,
      available: false,
      reason: MFA_UNAVAILABLE_REASON,
    };
  }),

  /**
   * Pass-through GET of the static CBN tier requirements from the KYC
   * enforcement gateway (kycEnforcement.tierRequirements is
   * member-safe-as-is: reference data, no caller data sent). Fail-closed:
   * gateway down → INTERNAL_SERVER_ERROR; the PWA shows a disclosed empty
   * state, never fabricated tier copy.
   */
  kycTierRequirements: protectedProcedure.query(async () => {
    let resp: Response;
    try {
      resp = await fetch(`${KYC_ENFORCEMENT_URL}/api/v1/tiers/requirements`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `KYC enforcement gateway unreachable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
    if (!resp.ok && resp.status !== 202) {
      const text = await resp.text().catch(() => "");
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `KYC enforcement gateway returned ${resp.status}: ${text.slice(0, 200)}`,
      });
    }
    return resp.json();
  }),

  /**
   * The caller's own face enrollments (faceEnrollment.list is
   * member-safe-as-is — scoped eq(userId, ctx.user.id)). Every row is
   * labelled verificationBasis "self-enrolled": these credentials come from
   * the self-attested enroll path and are NOT provider-verified.
   */
  myFaceEnrollments: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const rows = await d
      .select(faceEnrollmentMemberProjection)
      .from(faceEnrollments)
      .where(eq(faceEnrollments.userId, ctx.user.id))
      .orderBy(desc(faceEnrollments.createdAt));
    return rows.map(row => ({
      ...row,
      verificationBasis: "self-enrolled" as const,
    }));
  }),

  /** The caller's latest ACTIVE face enrollment of the given type. */
  myActiveFaceEnrollment: protectedProcedure
    .input(
      z.object({
        enrollmentType: z.enum(["kyc", "login", "payment"]).default("kyc"),
      })
    )
    .query(async ({ ctx, input }) => {
      const d = await db();
      const [row] = await d
        .select(faceEnrollmentMemberProjection)
        .from(faceEnrollments)
        .where(
          and(
            eq(faceEnrollments.userId, ctx.user.id),
            eq(faceEnrollments.enrollmentType, input.enrollmentType),
            eq(faceEnrollments.isActive, true)
          )
        )
        .orderBy(desc(faceEnrollments.createdAt))
        .limit(1);
      return row
        ? { ...row, verificationBasis: "self-enrolled" as const }
        : null;
    }),

  /**
   * Caller-scoped revoke of the caller's OWN enrollment. The underlying
   * faceEnrollment.revoke ownership check (id AND userId, lines 273-278) is
   * correct but returns `{ success: false }` on miss; the member surface
   * requires NOT_FOUND (non-enumerating), so the scoped update is
   * implemented directly here (per worklist §A.6) with the same
   * biometricAuditEvents record.
   */
  revokeMyFaceEnrollment: protectedProcedure
    .input(
      z.object({
        enrollmentId: z.number().int().positive(),
        reason: z.string().min(1).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const [updated] = await d
        .update(faceEnrollments)
        .set({
          isActive: false,
          revokedAt: new Date(),
          revokedReason: input.reason,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(faceEnrollments.id, input.enrollmentId),
            eq(faceEnrollments.userId, ctx.user.id)
          )
        )
        .returning({ id: faceEnrollments.id });

      if (!updated) {
        // Foreign or unknown id — identical NOT_FOUND either way (no
        // enumeration), zero rows changed.
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Face enrollment not found",
        });
      }

      await d.insert(biometricAuditEvents).values({
        sessionId: `revoke_${input.enrollmentId}_${Date.now()}`,
        userId: ctx.user.id,
        eventType: "enrollment",
        outcome: "pass",
        errorDetails: `Revoked: ${input.reason}`,
        ipAddress:
          (ctx.req?.headers?.["x-forwarded-for"] as string)?.split(",")[0] ??
          null,
      });

      return { success: true as const, id: updated.id };
    }),

  /**
   * Caller-scoped liveness cooldown check (kyc.checkCooldown equivalent for
   * the member identity space — keyed `member-<users.id>`, never the
   * `agent-` prefix; isLockedOut is a read against the in-process cooldown
   * store, imported read-only per worklist).
   */
  checkLivenessCooldown: protectedProcedure.query(({ ctx }) => {
    return isLockedOut(`member-${ctx.user.id}`);
  }),
});
