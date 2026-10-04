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
 *
 * 2026-10-04 (W10-B3): added the member-safe MUTATIONS from the W10 design
 * brief §6.6/§6.7 (w10-funds-design.md):
 *   - submitKyc — real NIN/BVN verification via the enhanced-kyc-kyb
 *     service (the same member-appropriate /api/v1/kyc/verify-nin|verify-bvn
 *     endpoints the ussd-gateway member flow calls), caller-scoped
 *     kycSessions persistence, encrypted doc number at rest, one-open-
 *     session duplicate guard, status transitions ONLY on the service's
 *     real adjudication (never self-declared).
 *   - startFaceEnrollment / submitFaceEnrollmentFrame — the agent liveness
 *     flow (kyc.ts startLiveness/submitLivenessFrame) mirrored in the
 *     MEMBER key space: real challenge from the video-kyc liveness service,
 *     single-use 60-second challenges, Redis-backed attempt lockout keyed
 *     `member-<users.id>`, server-computed embedding via the DeepFace
 *     service ONLY (clients send frames, never embeddings/results), and
 *     faceEnrollments written only on a real provider pass + real
 *     server-side embedding. Every service dependency fails CLOSED and
 *     LOUD when unconfigured.
 *   - myKycSession — caller-scoped PII-safe read of one own session.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";

import {
  biometricAuditEvents,
  customers,
  faceEnrollments,
  kycSessions,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { encryptPii } from "../lib/piiCrypto";
import {
  isLockedOut,
  recordLivenessFailure,
  recordLivenessSuccess,
} from "../middleware/livenessSecurityEnhancements";

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
    .select({
      id: customers.id,
      kycLevel: customers.kycLevel,
      firstName: customers.firstName,
      lastName: customers.lastName,
    })
    .from(customers)
    .where(eq(customers.keycloakSub, String(userId)))
    .limit(1);
  return customer ?? null;
}

// ═════════════════════════════════════════════════════════════════════════════
// 2026-10-04 (W10-B3): member-safe KYC submit + server-verified face enrollment
// ═════════════════════════════════════════════════════════════════════════════
//
// Service configuration is read LAZILY (never at module load) so an
// unconfigured deployment is detected per-call and fails closed with a loud
// PRECONDITION_FAILED before any row is written — the W10-B2 gateway
// discipline (memberBillPayments.pay). Env names follow the existing
// in-tree clients: ENHANCED_KYC_URL / ENHANCED_KYC_API_KEY
// (server/journey-activities.ts callEnhancedKycVerify), KYC_SERVICE_URL and
// DEEPFACE_SERVICE_URL (server/_core/kycClient.ts).

function enhancedKycConfig(): { url: string; apiKey: string } {
  return {
    url: process.env.ENHANCED_KYC_URL ?? "",
    apiKey: process.env.ENHANCED_KYC_API_KEY ?? "",
  };
}
function livenessServiceUrl(): string {
  return process.env.KYC_SERVICE_URL ?? "";
}
function deepfaceServiceUrl(): string {
  return process.env.DEEPFACE_SERVICE_URL ?? "";
}

/** 2026-10-04 (W10-B3): challenge TTL mirrors kycClient.ts
 * createLivenessChallenge (expiresAt = issued + 60s). */
const LIVENESS_CHALLENGE_TTL_MS = 60_000;
/** kycSessions.type discriminator for member document-verification sessions. */
const MEMBER_KYC_SESSION_TYPE = "customer_kyc";
/** kycSessions.type discriminator for member face-enrollment liveness sessions. */
const MEMBER_FACE_SESSION_TYPE = "customer_face_enrollment";
/** Provenance marker written into faceEnrollments.sourceImageHash for
 * server-verified enrollments — lets the member reads label the credential
 * "server-verified" without ever exposing the hash itself. */
const SERVER_VERIFIED_HASH_PREFIX = "liveness-session:";

interface EnhancedKycVerifyResponse {
  verified?: boolean;
  status?: string;
}

/**
 * Real call to the enhanced-kyc-kyb member verification endpoint
 * (/api/v1/kyc/verify-nin | /api/v1/kyc/verify-bvn — the same endpoints the
 * ussd-gateway member flow uses, ussd-gateway/main.go:795). THROWS on
 * transport/HTTP failure (fail-loud); the caller decides the honest status.
 */
async function callEnhancedKycVerify(
  path: string,
  body: Record<string, unknown>
): Promise<EnhancedKycVerifyResponse> {
  const { url, apiKey } = enhancedKycConfig();
  // Config is checked by the caller BEFORE any write; this is belt-and-braces.
  if (!url || !apiKey) {
    throw new Error(
      "ENHANCED_KYC_URL / ENHANCED_KYC_API_KEY not configured — identity verification is unavailable (fail-closed)"
    );
  }
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(
      `KYC verification service returned HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`
    );
  }
  return (await res.json()) as EnhancedKycVerifyResponse;
}

interface LivenessChallenge {
  challengeId: string;
  method: string;
  instruction: string;
}

/** Real challenge issuance against the video-kyc liveness service — same
 * endpoint/contract as kycClient.ts createLivenessChallenge. Throws
 * (fail-loud) on any failure; members get NO fabricated fallback challenge. */
async function createMemberLivenessChallenge(
  method: string
): Promise<LivenessChallenge> {
  const base = livenessServiceUrl();
  if (!base) {
    throw new Error("KYC_SERVICE_URL not configured (fail-closed)");
  }
  const res = await fetch(`${base}/create_challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Liveness service returned HTTP ${res.status}`);
  }
  const d = (await res.json()) as Record<string, unknown>;
  const challengeId = String(d.challenge_id ?? d.challengeId ?? "");
  if (!challengeId) {
    throw new Error("Liveness service returned no challenge id");
  }
  return {
    challengeId,
    method: String(d.method ?? method),
    instruction: String(d.instruction ?? "Please blink twice"),
  };
}

interface LivenessDecision {
  passed: boolean;
  score: number;
  spoofingDetected: boolean;
  raw: unknown;
}

/** Real frame decision against the video-kyc liveness service — same
 * endpoint/contract as kycClient.ts verifyLivenessChallenge. Returns null on
 * transport/HTTP failure so the caller can record an HONEST failure (and
 * count it toward the lockout) instead of fabricating a pass. */
async function decideMemberLivenessFrame(
  challengeId: string,
  frameBase64: string
): Promise<LivenessDecision | null> {
  const base = livenessServiceUrl();
  if (!base) return null;
  let res: Response;
  try {
    res = await fetch(
      `${base}/respond_challenge/${encodeURIComponent(challengeId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: frameBase64 }),
        signal: AbortSignal.timeout(30_000),
      }
    );
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const d = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!d) return null;
  // 2026-10-04 (W10-B3-r2, FINDING-C5): STRICT boolean adjudication — only
  // the JSON literal `true` is a pass. `Boolean("false") === true` minted a
  // real face_enrollments credential on a FAIL response; the submitKyc path
  // already uses `verified === true`, this path must match that discipline.
  return {
    passed: d.passed === true || d.is_live === true,
    score: Number(d.score ?? d.liveness_score ?? 0),
    spoofingDetected: d.spoofing_detected === true,
    raw: d,
  };
}

interface ServerEmbedding {
  embedding: number[];
  model: string;
}

/**
 * Server-side embedding extraction via the DeepFace service — the ONLY way a
 * member faceEnrollments row may obtain an embedding (kycClient.ts
 * deepfaceExtractEmbedding contract, /represent). Returns null when the
 * extractor is unconfigured or fails: enrollment then fails CLOSED (no
 * credential is written), per design brief §6.7.
 */
async function extractServerEmbedding(
  frameBase64: string
): Promise<ServerEmbedding | null> {
  const base = deepfaceServiceUrl();
  if (!base) return null;
  let res: Response;
  try {
    res = await fetch(`${base}/represent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: frameBase64,
        model_name: "ArcFace",
        detector_backend: "retinaface",
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const d = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const embedding = (d?.embedding ?? []) as number[];
  if (!d || !Array.isArray(embedding) || embedding.length === 0) return null;
  return { embedding, model: String(d.model ?? "ArcFace").slice(0, 32) };
}

function memberLockKey(userId: number): string {
  return `member-${userId}`;
}

function clientIp(ctx: {
  req?: { headers?: Record<string, unknown> };
}): string | null {
  const fwd = ctx.req?.headers?.["x-forwarded-for"];
  return typeof fwd === "string" ? (fwd.split(",")[0]?.trim() ?? null) : null;
}

async function throwIfLockedOut(userId: number): Promise<void> {
  const cooldown = await isLockedOut(memberLockKey(userId));
  if (cooldown.locked) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Too many failed attempts. Please wait ${Math.ceil(cooldown.remainingMs / 60000)} minutes before trying again.`,
    });
  }
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
      // 2026-10-04 (W10-B3): scoped to DOCUMENT-verification sessions so a
      // face-enrollment liveness session never masquerades as the member's
      // KYC document status (mobile consumes this contract unchanged).
      .where(
        and(
          eq(kycSessions.customerId, customer.id),
          eq(kycSessions.type, MEMBER_KYC_SESSION_TYPE)
        )
      )
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
    // sourceImageHash is selected ONLY to derive the honest verificationBasis
    // label — it is stripped before the payload leaves the server.
    const rows = await d
      .select({
        ...faceEnrollmentMemberProjection,
        sourceImageHash: faceEnrollments.sourceImageHash,
      })
      .from(faceEnrollments)
      .where(eq(faceEnrollments.userId, ctx.user.id))
      .orderBy(desc(faceEnrollments.createdAt));
    return rows.map(({ sourceImageHash, ...row }) => ({
      ...row,
      // 2026-10-04 (W10-B3): credentials written by the server-verified
      // enroll flow carry the liveness-session provenance marker; everything
      // else remains honestly "self-enrolled" (self-attested, NOT
      // provider-verified).
      verificationBasis: sourceImageHash?.startsWith(SERVER_VERIFIED_HASH_PREFIX)
        ? ("server-verified" as const)
        : ("self-enrolled" as const),
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
        .select({
          ...faceEnrollmentMemberProjection,
          sourceImageHash: faceEnrollments.sourceImageHash,
        })
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
      if (!row) return null;
      const { sourceImageHash, ...projection } = row;
      return {
        ...projection,
        verificationBasis: sourceImageHash?.startsWith(
          SERVER_VERIFIED_HASH_PREFIX
        )
          ? ("server-verified" as const)
          : ("self-enrolled" as const),
      };
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

  /**
   * 2026-10-04 (W10-B3, design brief §6.6): member KYC document submission.
   *
   * Caller-scoped (the session user resolves the customer — NO client
   * userId/customerId), real NIN/BVN verification via enhanced-kyc-kyb
   * (verify-nin / verify-bvn — the member-appropriate endpoints the
   * ussd-gateway member flow calls). Contract:
   *   - doc number is validated zod-strict and stored AES-256-GCM encrypted
   *     (piiCrypto) — never plaintext, never echoed back;
   *   - duplicate guard (memberRenewals INS-11 precedent): one OPEN
   *     document session per member → CONFLICT;
   *   - service UNCONFIGURED → PRECONDITION_FAILED BEFORE any row is
   *     written (W10-B2 fail-closed discipline);
   *   - service unreachable/HTTP error → the session honestly REMAINS
   *     "pending" and the response says so (never a fabricated outcome);
   *   - status transitions ONLY on the service's real adjudication:
   *     verified===true → "verified" (guarded conditional UPDATE), any
   *     other adjudication → "rejected" with the real service status as
   *     the rejection reason. NEVER self-declared verified.
   */
  submitKyc: protectedProcedure
    .input(
      z
        .object({
          docType: z.enum(["nin", "bvn"]),
          docNumber: z
            .string()
            .regex(/^\d{11}$/, "NIN/BVN must be exactly 11 digits"),
          docImageRef: z.string().min(1).max(512).optional(),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const customer = await resolveSessionCustomer(d, ctx.user.id);
      if (!customer) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No customer profile for this session — complete member onboarding before submitting KYC",
        });
      }

      // Duplicate guard: one open document session per member
      // (memberRenewals INS-11 precedent — CONFLICT, not a silent second row).
      const [open] = await d
        .select({ id: kycSessions.id })
        .from(kycSessions)
        .where(
          and(
            eq(kycSessions.customerId, customer.id),
            eq(kycSessions.type, MEMBER_KYC_SESSION_TYPE),
            eq(kycSessions.status, "pending")
          )
        )
        .limit(1);
      if (open) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An open KYC submission already exists for this member",
        });
      }

      // FAIL-CLOSED: verification service must be configured BEFORE any row
      // is written (W10-B2 gateway discipline) — zero rows on this path.
      const { url, apiKey } = enhancedKycConfig();
      if (!url || !apiKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "KYC verification service is not configured — identity verification is unavailable (fail-closed)",
        });
      }

      const fullName = [customer.firstName, customer.lastName]
        .filter(Boolean)
        .join(" ");
      const encryptedDoc = encryptPii(input.docNumber);

      const [session] = await d
        .insert(kycSessions)
        .values({
          customerId: customer.id,
          type: MEMBER_KYC_SESSION_TYPE,
          status: "pending",
          docType: input.docType,
          nin: input.docType === "nin" ? encryptedDoc : null,
          bvn: input.docType === "bvn" ? encryptedDoc : null,
          idDocUrl: input.docImageRef ?? null,
        })
        .returning({ id: kycSessions.id });

      // Real verification call. Transport/HTTP failure → the row honestly
      // stays "pending" (resumable by a later submit once the duplicate
      // guard is cleared by review/expiry) and the response says exactly
      // that — never a fabricated outcome.
      let result: EnhancedKycVerifyResponse;
      try {
        result = await callEnhancedKycVerify(
          input.docType === "nin"
            ? "/api/v1/kyc/verify-nin"
            : "/api/v1/kyc/verify-bvn",
          input.docType === "nin"
            ? { nin: input.docNumber, full_name: fullName }
            : { bvn: input.docNumber, full_name: fullName }
        );
      } catch (error) {
        return {
          sessionId: session.id,
          status: "pending" as const,
          verified: false,
          serviceOutcome: "unavailable" as const,
          message: `Verification could not be completed: ${error instanceof Error ? error.message : String(error)}. Your submission is pending and will be verified when the service recovers.`,
        };
      }

      // Status transitions ONLY from the service's real adjudication, via a
      // guarded conditional UPDATE (verifyPremiumPayment pattern) so a
      // concurrent reviewer action is never clobbered.
      const verified = result.verified === true;
      const nextStatus = verified ? "verified" : "rejected";
      const [updated] = await d
        .update(kycSessions)
        .set({
          status: nextStatus,
          rejectionReason: verified
            ? null
            : `Identity verification adjudicated "${result.status ?? "failed"}" by the verification service`,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(kycSessions.id, session.id),
            eq(kycSessions.status, "pending")
          )
        )
        .returning({ id: kycSessions.id, status: kycSessions.status });

      return {
        sessionId: session.id,
        // If the guarded update lost a race (reviewer acted first), report
        // the CURRENT persisted state, not the adjudication we computed.
        status: updated?.status ?? ("pending" as const),
        verified,
        serviceOutcome: "adjudicated" as const,
        serviceStatus: result.status ?? null,
        message: verified
          ? "Identity verified by the verification service."
          : `Identity verification adjudicated "${result.status ?? "failed"}" — not verified.`,
      };
    }),

  /**
   * 2026-10-04 (W10-B3, design brief §6.7): member face enrollment, step 1 —
   * start a REAL liveness challenge (kyc.ts startLiveness mirrored into the
   * member key space). Fail-closed: attempt lockout (`member-<users.id>`)
   * and liveness-service availability are checked BEFORE any row is
   * written; an unconfigured/down service yields a loud error and ZERO
   * rows (the agent flow's `serviceAvailable:false` fallback session is
   * NOT acceptable for member credential issuance).
   */
  startFaceEnrollment: protectedProcedure
    .input(
      z
        .object({
          method: z
            .enum([
              "active_blink",
              "active_smile",
              "active_head_movement",
              "passive",
            ])
            .default("active_blink"),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      await throwIfLockedOut(ctx.user.id);

      const customer = await resolveSessionCustomer(d, ctx.user.id);
      if (!customer) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No customer profile for this session — complete member onboarding before enrolling a face",
        });
      }

      // One open liveness challenge per member (prevents challenge farming).
      const [open] = await d
        .select({ id: kycSessions.id })
        .from(kycSessions)
        .where(
          and(
            eq(kycSessions.customerId, customer.id),
            eq(kycSessions.type, MEMBER_FACE_SESSION_TYPE),
            eq(kycSessions.status, "pending")
          )
        )
        .limit(1);
      if (open) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An open face-enrollment challenge already exists",
        });
      }

      // FAIL-CLOSED before any write: the liveness service must be
      // configured, and the challenge must REALLY be issued.
      if (!livenessServiceUrl()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Liveness service is not configured — face enrollment is unavailable (fail-closed)",
        });
      }
      let challenge: LivenessChallenge;
      try {
        challenge = await createMemberLivenessChallenge(input.method);
      } catch (error) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Liveness challenge could not be issued: ${error instanceof Error ? error.message : String(error)}`,
        });
      }

      const [session] = await d
        .insert(kycSessions)
        .values({
          customerId: customer.id,
          type: MEMBER_FACE_SESSION_TYPE,
          status: "pending",
          livenessMethod: challenge.method,
          livenessChallenge: challenge.challengeId,
        })
        .returning({ id: kycSessions.id, createdAt: kycSessions.createdAt });

      return {
        sessionId: session.id,
        challengeId: challenge.challengeId,
        instruction: challenge.instruction,
        method: challenge.method,
        expiresAt: new Date(
          session.createdAt.getTime() + LIVENESS_CHALLENGE_TTL_MS
        ),
      };
    }),

  /**
   * 2026-10-04 (W10-B3, design brief §6.7): member face enrollment, step 2 —
   * submit a camera frame for the REAL liveness decision, and ONLY on a
   * provider pass + a SERVER-COMPUTED embedding (DeepFace /represent) write
   * the faceEnrollments credential. The client sends FRAMES, never
   * embeddings or verification outcomes — the input schema is zod-strict so
   * any client-supplied embedding/livenessScore/verified flag is REJECTED.
   *
   * Abuse controls mirrored from the agent flow
   * (livenessSecurityEnhancements): Redis-backed attempt lockout keyed
   * `member-<users.id>` (3 failures → 5-minute lockout), single-use
   * challenges (a decided session can never be replayed), 60-second
   * challenge TTL, and challenge-id binding to the caller's own session.
   * Foreign sessionId → NOT_FOUND (never enumerating).
   */
  submitFaceEnrollmentFrame: protectedProcedure
    .input(
      z
        .object({
          sessionId: z.number().int().positive(),
          challengeId: z.string().min(1).max(128),
          frameBase64: z.string().min(100).max(14_000_000),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const customer = await resolveSessionCustomer(d, ctx.user.id);
      if (!customer) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No customer profile for this session",
        });
      }

      // Ownership: the session must belong to the CALLER's resolved
      // customer — member B acting on member A's session is NOT_FOUND.
      const [session] = await d
        .select()
        .from(kycSessions)
        .where(eq(kycSessions.id, input.sessionId))
        .limit(1);
      if (
        !session ||
        session.type !== MEMBER_FACE_SESSION_TYPE ||
        session.customerId !== customer.id
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Face-enrollment session not found",
        });
      }

      await throwIfLockedOut(ctx.user.id);

      // Single-use: a decided session is never re-decided.
      if (session.status !== "pending") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Challenge already decided (status '${session.status}') — start a new enrollment`,
        });
      }
      // Challenge binding: the frame must answer THIS session's challenge.
      if (session.livenessChallenge !== input.challengeId) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Challenge does not match this enrollment session",
        });
      }

      const markFailed = async (reason: string) => {
        await d
          .update(kycSessions)
          .set({
            status: "liveness_failed",
            livenessPassed: false,
            rejectionReason: reason,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(kycSessions.id, session.id),
              eq(kycSessions.status, "pending")
            )
          );
      };

      // TTL: challenges expire 60s after issuance (kycClient expiresAt).
      if (
        Date.now() - session.createdAt.getTime() >
        LIVENESS_CHALLENGE_TTL_MS
      ) {
        await recordLivenessFailure(memberLockKey(ctx.user.id));
        await markFailed("Liveness challenge expired");
        return {
          sessionId: session.id,
          passed: false,
          enrolled: false,
          status: "liveness_failed" as const,
          reason: "challenge_expired" as const,
        };
      }

      const decision = await decideMemberLivenessFrame(
        input.challengeId,
        input.frameBase64
      );

      if (!decision || !decision.passed) {
        await recordLivenessFailure(memberLockKey(ctx.user.id));
        await d
          .update(kycSessions)
          .set({
            status: "liveness_failed",
            livenessPassed: false,
            livenessScore: decision?.score?.toFixed(2) ?? null,
            livenessRaw: decision?.raw ?? null,
            rejectionReason: decision
              ? decision.spoofingDetected
                ? "Liveness check failed — spoofing detected"
                : "Liveness check failed"
              : "Liveness service error — no decision could be obtained",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(kycSessions.id, session.id),
              eq(kycSessions.status, "pending")
            )
          );
        await d.insert(biometricAuditEvents).values({
          sessionId: `liveness_member_${session.id}_${Date.now()}`,
          userId: ctx.user.id,
          eventType: "liveness",
          outcome: "fail",
          confidenceScore: decision?.score?.toFixed(4) ?? null,
          livenessMethod: session.livenessMethod ?? null,
          errorDetails: decision ? null : "liveness service error",
          ipAddress: clientIp(ctx),
        });
        return {
          sessionId: session.id,
          passed: false,
          enrolled: false,
          status: "liveness_failed" as const,
          reason: decision
            ? ("provider_rejected" as const)
            : ("service_error" as const),
          spoofingDetected: decision?.spoofingDetected ?? false,
        };
      }

      // Provider PASS — persist the real decision, then extract the
      // embedding SERVER-SIDE. No extractor provisioned → enrollment fails
      // CLOSED: the liveness pass is honestly recorded but NO credential is
      // written (design brief §6.7).
      await recordLivenessSuccess(memberLockKey(ctx.user.id));
      // 2026-10-04 (W10-B3-r2, TOCTOU): this guarded UPDATE is the GATE for
      // credential issuance — only the frame that atomically transitions
      // pending → liveness_passed may proceed. A concurrent frame that also
      // got a provider pass finds 0 rows (session already decided) and gets
      // an honest CONFLICT; without the .returning() check both frames could
      // insert face_enrollments credentials.
      const decided = await d
        .update(kycSessions)
        .set({
          status: "liveness_passed",
          livenessPassed: true,
          livenessScore: decision.score.toFixed(2),
          livenessRaw: decision.raw ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(kycSessions.id, session.id),
            eq(kycSessions.status, "pending")
          )
        )
        .returning({ id: kycSessions.id });
      if (decided.length === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This liveness challenge was already decided by another frame submission.",
        });
      }

      const extracted = await extractServerEmbedding(input.frameBase64);
      if (!extracted) {
        return {
          sessionId: session.id,
          passed: true,
          enrolled: false,
          status: "liveness_passed" as const,
          reason: "embedding_extractor_unavailable" as const,
          message:
            "Liveness passed, but the server-side face-embedding service is not configured/available — enrollment failed closed and no credential was created.",
        };
      }

      // Supersede any prior active kyc credentials (including self-attested
      // ones) so exactly one active kyc credential exists per member.
      await d
        .update(faceEnrollments)
        .set({
          isActive: false,
          revokedAt: new Date(),
          revokedReason: "Superseded by server-verified enrollment",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(faceEnrollments.userId, ctx.user.id),
            eq(faceEnrollments.enrollmentType, "kyc"),
            eq(faceEnrollments.isActive, true)
          )
        );

      const [enrollment] = await d
        .insert(faceEnrollments)
        .values({
          userId: ctx.user.id,
          enrollmentType: "kyc",
          embeddingVector: JSON.stringify(extracted.embedding),
          embeddingVersion: extracted.model,
          livenessScore: decision.score.toFixed(4),
          sourceImageHash: `${SERVER_VERIFIED_HASH_PREFIX}${session.id}`,
          ipAddress: clientIp(ctx),
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        })
        .returning({ id: faceEnrollments.id });

      // 2026-10-04 (W10-B3-r2, TOCTOU): post-insert single-active guard — if a
      // concurrent frame from ANOTHER open session also passed and inserted,
      // the later writer supersedes every other active kyc credential so at
      // most ONE active credential per member survives any interleaving.
      await d
        .update(faceEnrollments)
        .set({
          isActive: false,
          revokedAt: new Date(),
          revokedReason: "Superseded by server-verified enrollment",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(faceEnrollments.userId, ctx.user.id),
            eq(faceEnrollments.enrollmentType, "kyc"),
            eq(faceEnrollments.isActive, true),
            ne(faceEnrollments.id, enrollment.id)
          )
        );

      await d.insert(biometricAuditEvents).values({
        sessionId: `enroll_member_${enrollment.id}_${Date.now()}`,
        userId: ctx.user.id,
        eventType: "enrollment",
        outcome: "pass",
        confidenceScore: decision.score.toFixed(4),
        livenessMethod: session.livenessMethod ?? null,
        ipAddress: clientIp(ctx),
      });

      return {
        sessionId: session.id,
        passed: true,
        enrolled: true,
        enrollmentId: enrollment.id,
        status: "enrolled" as const,
        score: decision.score,
        embeddingVersion: extracted.model,
      };
    }),

  /**
   * 2026-10-04 (W10-B3): caller-scoped PII-safe read of ONE own KYC/liveness
   * session (poll submitKyc pending → adjudicated, or inspect a face
   * enrollment session). Foreign sessionId → NOT_FOUND, same as the
   * mutations. Never returns bvn/nin/raw biometrics.
   */
  myKycSession: protectedProcedure
    .input(z.object({ sessionId: z.number().int().positive() }).strict())
    .query(async ({ ctx, input }) => {
      const d = await db();
      const customer = await resolveSessionCustomer(d, ctx.user.id);
      if (!customer) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No customer profile for this session",
        });
      }
      const [session] = await d
        .select({
          id: kycSessions.id,
          status: kycSessions.status,
          type: kycSessions.type,
          livenessPassed: kycSessions.livenessPassed,
          livenessScore: kycSessions.livenessScore,
          docType: kycSessions.docType,
          rejectionReason: kycSessions.rejectionReason,
          reviewedAt: kycSessions.reviewedAt,
          createdAt: kycSessions.createdAt,
          updatedAt: kycSessions.updatedAt,
        })
        .from(kycSessions)
        .where(
          and(
            eq(kycSessions.id, input.sessionId),
            eq(kycSessions.customerId, customer.id)
          )
        )
        .limit(1);
      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "KYC session not found",
        });
      }
      return {
        ...session,
        livenessScore: session.livenessScore
          ? Number(session.livenessScore)
          : null,
      };
    }),
});
