/**
 * careRetention.ts — Q4 health & retention wave (2026-09-25)
 *
 * Care-app retention layer (Alan model) + claims CX upgrades:
 *  - teleconsult.*   : booking/status against the configurable provider
 *    adapter (server/lib/teleconsultAdapter.ts). FAIL-CLOSED when the
 *    provider is unconfigured (PRECONDITION_FAILED, honest message) — this
 *    platform never simulates a consultation. Session rows are
 *    PHI-minimized (refs + coarse status only). Members see ONLY their own.
 *  - wellness.*      : staff-gated content CRUD (admin) + member feed
 *    (locale-aware, bounded pagination — same limit/offset cap discipline
 *    as the P-wave list endpoints: limit max 50, default 20).
 *  - photoReimbursement.* : one-tap reimbursement. Members upload receipt
 *    photos via the EXISTING presigned PUT flow
 *    (documentManagement.requestUploadUrl, P-wave), then submit the returned
 *    file keys here. Ownership of every key is verified against the
 *    user-scoped upload prefix before anything is persisted. Adjudication
 *    REUSES the existing claim_status vocabulary; OCR is the disclosed,
 *    fail-closed adapter hook (server/lib/ocrAdapter.ts) — no fake OCR.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, count } from "drizzle-orm";
import { z } from "zod";

import {
  auditLog,
  claims,
  photoReimbursements,
  teleconsultSessions,
  wellnessContent,
} from "../../drizzle/schema";
import {
  adminProcedure,
  protectedProcedure,
  router,
} from "../_core/trpc";
import { getDb } from "../db";
import {
  TeleconsultNotConfiguredError,
  bookSession,
  getSessionStatus,
  isTeleconsultConfigured,
} from "../lib/teleconsultAdapter";
import { extractReceiptFields, isOcrConfigured } from "../lib/ocrAdapter";

/** Reimbursement lifecycle reuses the existing claim_status vocabulary. */
const REIMBURSEMENT_STATUSES = [
  "pending_review",
  "under_review",
  "approved",
  "rejected",
  "paid",
] as const;

/**
 * Upload keys issued by documentManagement.requestUploadUrl are scoped
 * `uploads/<purpose>/<userId>/<ts>-<name>` (P-wave). A reimbursement
 * submission may only reference keys issued for THIS member with the
 * claim_document purpose — anything else is a forgery attempt.
 */
function ownedUploadPrefix(userId: number): string {
  return `uploads/claim_document/${userId}/`;
}

export const careRetentionRouter = router({
  // ── Teleconsult (member) ─────────────────────────────────────────────────
  teleconsultBook: protectedProcedure
    .input(
      z.object({
        scheduledAt: z
          .string()
          .datetime()
          .refine(s => new Date(s).getTime() > Date.now(), {
            message: "scheduledAt must be in the future",
          }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Fail-closed: unconfigured provider -> honest error, no fake booking.
      if (!isTeleconsultConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Teleconsult provider is not configured on this deployment (TELECONSULT_PROVIDER_URL/TELECONSULT_API_KEY). No consultation was booked and none will be simulated.",
        });
      }
      let booked: { providerSessionRef: string; providerCode: string };
      try {
        booked = await bookSession({
          // Pseudonymous member reference only — no PHI crosses the boundary.
          memberRef: `member:${ctx.user.id}`,
          scheduledAt: new Date(input.scheduledAt),
        });
      } catch (error) {
        if (error instanceof TeleconsultNotConfiguredError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error.message,
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Teleconsult booking failed: ${
            error instanceof Error ? error.message : String(error)
          }. No session was created.`,
        });
      }
      const db = (await getDb())!;
      const [row] = await db
        .insert(teleconsultSessions)
        .values({
          memberId: ctx.user.id,
          providerCode: booked.providerCode,
          providerSessionRef: booked.providerSessionRef,
          status: "scheduled",
          scheduledAt: new Date(input.scheduledAt),
        })
        .returning();
      await db.insert(auditLog).values({
        action: "teleconsult_booked",
        resource: "teleconsult_sessions",
        resourceId: String(row.id),
        status: "success",
        metadata: {
          memberId: ctx.user.id,
          providerCode: booked.providerCode,
        },
      } as any);
      return {
        id: row.id,
        status: row.status,
        scheduledAt: row.scheduledAt,
        providerCode: row.providerCode,
      };
    }),

  teleconsultStatus: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const db = (await getDb())!;
      const [row] = await db
        .select()
        .from(teleconsultSessions)
        .where(eq(teleconsultSessions.id, input.id))
        .limit(1);
      if (!row || row.memberId !== ctx.user.id) {
        // Fail-closed scoping: never reveal another member's session.
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Teleconsult session not found",
        });
      }
      if (!isTeleconsultConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Teleconsult provider is not configured on this deployment; live status refresh is unavailable and no status will be guessed.",
        });
      }
      const { status } = await getSessionStatus({
        providerSessionRef: row.providerSessionRef,
      });
      if (status !== row.status) {
        await db
          .update(teleconsultSessions)
          .set({ status, updatedAt: new Date() })
          .where(eq(teleconsultSessions.id, row.id));
      }
      return { id: row.id, status, scheduledAt: row.scheduledAt };
    }),

  teleconsultList: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().positive().max(50).default(20),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const db = (await getDb())!;
      const rows = await db
        .select()
        .from(teleconsultSessions)
        .where(eq(teleconsultSessions.memberId, ctx.user.id))
        .orderBy(desc(teleconsultSessions.scheduledAt))
        .limit(input?.limit ?? 20)
        .offset(input?.offset ?? 0);
      return { sessions: rows, count: rows.length };
    }),

  // ── Wellness content (staff CRUD + member feed) ──────────────────────────
  wellnessCreate: adminProcedure
    .input(
      z.object({
        title: z.string().min(1).max(256),
        body: z.string().min(1),
        category: z.string().min(1).max(64),
        locale: z.string().min(2).max(16).default("en"),
        publish: z.boolean().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = (await getDb())!;
      const [row] = await db
        .insert(wellnessContent)
        .values({
          title: input.title,
          body: input.body,
          category: input.category,
          locale: input.locale,
          status: input.publish ? "published" : "draft",
          publishedAt: input.publish ? new Date() : null,
          createdBy: ctx.user.id,
        })
        .returning();
      await db.insert(auditLog).values({
        action: "wellness_content_created",
        resource: "wellness_content",
        resourceId: String(row.id),
        status: "success",
        metadata: { createdBy: ctx.user.id, status: row.status },
      } as any);
      return row;
    }),

  wellnessUpdate: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        title: z.string().min(1).max(256).optional(),
        body: z.string().min(1).optional(),
        category: z.string().min(1).max(64).optional(),
        locale: z.string().min(2).max(16).optional(),
        status: z.enum(["draft", "published", "archived"]).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = (await getDb())!;
      const [existing] = await db
        .select()
        .from(wellnessContent)
        .where(eq(wellnessContent.id, input.id))
        .limit(1);
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Wellness content not found",
        });
      }
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.title !== undefined) patch.title = input.title;
      if (input.body !== undefined) patch.body = input.body;
      if (input.category !== undefined) patch.category = input.category;
      if (input.locale !== undefined) patch.locale = input.locale;
      if (input.status !== undefined) {
        patch.status = input.status;
        if (input.status === "published" && !existing.publishedAt) {
          patch.publishedAt = new Date();
        }
      }
      await db
        .update(wellnessContent)
        .set(patch)
        .where(eq(wellnessContent.id, input.id));
      await db.insert(auditLog).values({
        action: "wellness_content_updated",
        resource: "wellness_content",
        resourceId: String(input.id),
        status: "success",
        metadata: { updatedBy: ctx.user.id, patch: Object.keys(patch) },
      } as any);
      const [row] = await db
        .select()
        .from(wellnessContent)
        .where(eq(wellnessContent.id, input.id))
        .limit(1);
      return row;
    }),

  wellnessFeed: protectedProcedure
    .input(
      z
        .object({
          locale: z.string().min(2).max(16).default("en"),
          category: z.string().max(64).optional(),
          // Bounded pagination (P-wave list discipline): hard cap 50.
          limit: z.number().int().positive().max(50).default(20),
          offset: z.number().int().min(0).max(10_000).default(0),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = (await getDb())!;
      const locale = input?.locale ?? "en";
      const conditions = [
        eq(wellnessContent.status, "published"),
        eq(wellnessContent.locale, locale),
      ];
      if (input?.category) {
        conditions.push(eq(wellnessContent.category, input.category));
      }
      const where = and(...conditions);
      const [total] = await db
        .select({ value: count() })
        .from(wellnessContent)
        .where(where);
      const items = await db
        .select()
        .from(wellnessContent)
        .where(where)
        .orderBy(desc(wellnessContent.publishedAt))
        .limit(input?.limit ?? 20)
        .offset(input?.offset ?? 0);
      return { items, total: Number(total.value), locale };
    }),

  // ── One-tap photo reimbursement ──────────────────────────────────────────
  photoReimbursementSubmit: protectedProcedure
    .input(
      z.object({
        // Optional: link to a REAL existing claim owned by the member; omit
        // for the direct-to-review queue.
        claimId: z.number().int().positive().optional(),
        // Storage keys returned by documentManagement.requestUploadUrl after
        // the client PUT the bytes directly to object storage.
        documentRefs: z.array(z.string().min(1).max(512)).min(1).max(5),
        amount: z.number().positive().max(100_000_000),
        currency: z.string().length(3).default("NGN"),
        description: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify every referenced upload was issued for THIS member with the
      // claim_document purpose (P-wave key scoping). Foreign keys rejected.
      const prefix = ownedUploadPrefix(ctx.user.id);
      for (const ref of input.documentRefs) {
        if (!ref.startsWith(prefix)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Document reference was not issued for your account via the presigned upload flow",
          });
        }
      }
      const db = (await getDb())!;
      let linkedClaimId: number | null = null;
      let status: (typeof REIMBURSEMENT_STATUSES)[number] = "pending_review";
      if (input.claimId !== undefined) {
        const [claim] = await db
          .select()
          .from(claims)
          .where(eq(claims.id, input.claimId))
          .limit(1);
        if (!claim) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Claim not found",
          });
        }
        if (claim.claimantId !== ctx.user.id) {
          // Fail-closed ownership: cannot attach to another member's claim.
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Cannot link a reimbursement to another member's claim",
          });
        }
        linkedClaimId = claim.id;
        status = "under_review";
      }
      // OCR hook (honest, disclosed): real extraction when a provider is
      // configured; otherwise the manual_entry fallback — never fabricated.
      let ocrStatus = "not_requested";
      let ocrExtracted: Record<string, unknown> | null = null;
      let ocrDisclosure: string | null = null;
      if (isOcrConfigured()) {
        const ocr = await extractReceiptFields({
          fileKey: input.documentRefs[0],
        });
        if (ocr.status === "completed") {
          ocrStatus = "completed";
          ocrExtracted = ocr.fields;
        } else {
          ocrStatus = "manual_entry";
          ocrDisclosure = ocr.reason;
        }
      } else {
        ocrStatus = "manual_entry";
        ocrDisclosure =
          "OCR provider not configured; amounts are reviewed via staff manual entry (disclosed fallback — no OCR result was generated).";
      }
      const [row] = await db
        .insert(photoReimbursements)
        .values({
          memberId: ctx.user.id,
          claimId: linkedClaimId,
          documentRefs: input.documentRefs,
          amount: String(input.amount),
          currency: input.currency,
          description: input.description ?? null,
          status,
          ocrStatus,
          ocrExtracted,
        })
        .returning();
      await db.insert(auditLog).values({
        action: "photo_reimbursement_submitted",
        resource: "photo_reimbursements",
        resourceId: String(row.id),
        status: "success",
        metadata: {
          memberId: ctx.user.id,
          claimId: linkedClaimId,
          docCount: input.documentRefs.length,
          ocrStatus,
        },
      } as any);
      return {
        id: row.id,
        status: row.status,
        claimId: row.claimId,
        ocrStatus: row.ocrStatus,
        ocrDisclosure,
      };
    }),

  photoReimbursementList: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().positive().max(50).default(20),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const db = (await getDb())!;
      const rows = await db
        .select()
        .from(photoReimbursements)
        .where(eq(photoReimbursements.memberId, ctx.user.id))
        .orderBy(desc(photoReimbursements.createdAt))
        .limit(input?.limit ?? 20)
        .offset(input?.offset ?? 0);
      return { reimbursements: rows, count: rows.length };
    }),

  // Staff adjudication — reuses existing claim statuses; when linked to a
  // claim, the claim's own status is driven with the same decision.
  photoReimbursementReview: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        decision: z.enum(["approved", "rejected"]),
        notes: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = (await getDb())!;
      const [row] = await db
        .select()
        .from(photoReimbursements)
        .where(eq(photoReimbursements.id, input.id))
        .limit(1);
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Reimbursement request not found",
        });
      }
      if (row.status === "approved" || row.status === "rejected") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Reimbursement already adjudicated (${row.status})`,
        });
      }
      await db
        .update(photoReimbursements)
        .set({
          status: input.decision,
          reviewedBy: ctx.user.id,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(photoReimbursements.id, row.id));
      if (row.claimId != null) {
        // Reuse the EXISTING claim_status vocabulary on the linked claim.
        await db
          .update(claims)
          .set({
            status: input.decision,
            rejectionReason:
              input.decision === "rejected"
                ? (input.notes ?? "Photo reimbursement rejected")
                : null,
            updatedAt: new Date(),
          })
          .where(eq(claims.id, row.claimId));
      }
      await db.insert(auditLog).values({
        action: `photo_reimbursement_${input.decision}`,
        resource: "photo_reimbursements",
        resourceId: String(row.id),
        status: "success",
        metadata: {
          reviewedBy: ctx.user.id,
          claimId: row.claimId,
          notes: input.notes ?? null,
        },
      } as any);
      return { id: row.id, status: input.decision, claimId: row.claimId };
    }),
});
