// Sprint 87: GDPR/NDPR compliance, consent expiry, withdrawal workflow
import { TRPCError } from "@trpc/server";
import { eq, desc, and, count, isNull } from "drizzle-orm";
import { z } from "zod";

import { dataConsentRecords } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, writeAuditLog } from "../db";

const CONSENT_TYPES = [
  "data_processing",
  "marketing",
  "analytics",
  "third_party_sharing",
  "biometric",
];
// 2026-10-25 (W12-R1): expiry is now caller-supplied (optional expiresAt
// input) instead of a hard-coded 365-day default, so no constant here.

// ── 2026-10-25 (W12-R1, verifier F1): fail-closed caller-identity binding ──
// The effective member identity ALWAYS comes from ctx.user (the
// authenticated caller), never from free input. input.userId is retained
// for ADMIN act-as only; a non-admin passing a foreign userId is FORBIDDEN.
// Admin role pattern follows adminProcedure (ctx.user.role === "admin",
// server/_core/trpc.ts requireAdmin). Row-id access (getById/withdraw/
// delete) is non-enumerating: absent and foreign rows BOTH answer
// NOT_FOUND (memberFunds transaction pattern, server/lib/memberFunds.ts).
type ConsentCallerCtx = { user: { id: number; role: string } };

function effectiveOwnerId(ctx: ConsentCallerCtx, requested?: number): number {
  const callerId = ctx.user.id;
  if (requested === undefined || requested === callerId) return callerId;
  if (ctx.user.role === "admin") return requested;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Cannot act on another member's consent records",
  });
}

function assertRowAccess(
  ctx: ConsentCallerCtx,
  row: { entityType: string; entityId: number } | undefined
): asserts row is { entityType: string; entityId: number } {
  const isOwner =
    row != null && row.entityType === "customer" && row.entityId === ctx.user.id;
  if (!row || (!isOwner && ctx.user.role !== "admin")) {
    // Non-enumerating: do not distinguish "missing" from "someone else's".
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Consent record not found",
    });
  }
}

export const dataConsentRecordsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        userId: z.number().optional(),
        consentType: z.string().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        const conditions: any[] = [];
        // 2026-10-25 (W12-R1): was eq(userAgent, userId as any) → Postgres
        // text=integer 500. Scope by the real consent-owner columns, same
        // predicate shape gdprDashboard uses.
        // 2026-10-25 (W12-R1, verifier F1): ALWAYS scoped to the caller
        // (fail-closed — no more unauthenticated-shape unscoped listing);
        // input.userId is admin act-as only.
        const ownerId = effectiveOwnerId(ctx, input.userId);
        conditions.push(
          and(
            eq(dataConsentRecords.entityType, "customer"),
            eq(dataConsentRecords.entityId, ownerId)
          )
        );
        if (input.consentType)
          conditions.push(
            eq(dataConsentRecords.consentType, input.consentType)
          );
        const rows = await db
          .select()
          .from(dataConsentRecords)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(dataConsentRecords.id))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(dataConsentRecords)
          .where(conditions.length ? and(...conditions) : undefined)
          .limit(100);
        const enriched = rows.map((r: any) => ({
          ...r,
          isExpired: r.expiresAt ? new Date(r.expiresAt) < new Date() : false,
        }));
        return { items: enriched, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        const [row] = await db
          .select()
          .from(dataConsentRecords)
          .where(eq(dataConsentRecords.id, input.id))
          .limit(100);
        // 2026-10-25 (W12-R1, verifier F1): owner-or-admin gate,
        // non-enumerating NOT_FOUND.
        assertRowAccess(ctx, row);
        return row;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  grantConsent: protectedProcedure
    .input(
      z.object({
        userId: z.number(),
        consentType: z.enum([
          "data_processing",
          "marketing",
          "analytics",
          "third_party_sharing",
          "biometric",
        ]),
        ipAddress: z.string().optional(),
        expiresAt: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        // 2026-10-25 (W12-R1): was `...input, status, expiresAt as any`
        // inserting non-existent userId/status/expiresAt columns and
        // omitting notNull granted/entityType/entityId → 23502 500.
        // Now mirrors gdprDashboard's writer: supersede prior active rows
        // for the same (entityType, entityId, consentType), then insert a
        // fully-typed row.
        // 2026-10-25 (W12-R1, verifier F1): owner identity from ctx;
        // input.userId is admin act-as only.
        const ownerId = effectiveOwnerId(ctx, input.userId);
        const expiresAt = input.expiresAt ?? null;
        // 2026-10-25 (W13-A, verifier F5): reject a past/now expiresAt —
        // a consent born already-expired is never a meaningful grant.
        // Boundary decision: STRICTLY future only, i.e. expiresAt exactly
        // equal to "now" is rejected too (an instant-expiry consent has no
        // active lifetime). null stays allowed (= non-expiring, matching
        // gdprDashboard-written rows).
        if (expiresAt && expiresAt.getTime() <= Date.now()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "expiresAt must be in the future; omit it for a non-expiring consent",
          });
        }
        await db
          .update(dataConsentRecords)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(dataConsentRecords.entityType, "customer"),
              eq(dataConsentRecords.entityId, ownerId),
              eq(dataConsentRecords.consentType, input.consentType),
              eq(dataConsentRecords.granted, true),
              isNull(dataConsentRecords.revokedAt)
            )
          );
        const [row] = await db
          .insert(dataConsentRecords)
          .values({
            entityType: "customer",
            entityId: ownerId,
            consentType: input.consentType,
            granted: true,
            grantedAt: new Date(),
            ipAddress: input.ipAddress ?? null,
            expiresAt,
          })
          .returning();
        return {
          ...row,
          message: expiresAt
            ? `Consent granted for ${input.consentType}. Expires: ${expiresAt.toISOString()}`
            : `Consent granted for ${input.consentType}. No expiry.`,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  withdrawConsent: protectedProcedure
    .input(z.object({ id: z.number(), reason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        const [record] = await db
          .select()
          .from(dataConsentRecords)
          .where(eq(dataConsentRecords.id, input.id))
          .limit(100);
        // 2026-10-25 (W12-R1, verifier F1): a member may withdraw ONLY
        // their own consent; admins may act for anyone. Non-enumerating
        // NOT_FOUND for absent/foreign rows.
        assertRowAccess(ctx, record);
        // 2026-10-25 (W13-A, verifier F4): idempotent withdraw — a second
        // withdraw on an already-withdrawn record is an honest no-op
        // success that PRESERVES the original revokedAt and
        // withdrawalReason (first-withdrawal audit trail). Previously the
        // unconditional UPDATE below silently overwrote withdrawal_reason,
        // losing the original reason. Idempotent success (rather than
        // CONFLICT) matches the NDPR Article 2.3 response contract and
        // keeps retries safe; the returned message states the no-op.
        if (record.revokedAt) {
          return {
            success: true,
            alreadyWithdrawn: true,
            message:
              "Consent already withdrawn — original withdrawal reason and timestamp preserved",
          };
        }
        // 2026-10-25 (W12-R1): was `.set({ withdrawalReason } as any)` →
        // UPDATE with SET referencing a non-existent column (500). Now sets
        // the real revoke semantics (matches gdprDashboard active-consent
        // predicate) plus the new audit column.
        await db
          .update(dataConsentRecords)
          .set({
            granted: false,
            revokedAt: new Date(),
            withdrawalReason: input.reason ?? null,
          })
          .where(eq(dataConsentRecords.id, input.id));
        return {
          success: true,
          message: "Consent withdrawn per NDPR Article 2.3",
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getComplianceStatus: protectedProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        // 2026-10-25 (W12-R1): was eq(userAgent, userId as any) →
        // text=integer 500. Real owner scoping.
        // 2026-10-25 (W12-R1, verifier F1): owner identity from ctx;
        // input.userId is admin act-as only.
        const ownerId = effectiveOwnerId(ctx, input.userId);
        const records = await db
          .select()
          .from(dataConsentRecords)
          .where(
            and(
              eq(dataConsentRecords.entityType, "customer"),
              eq(dataConsentRecords.entityId, ownerId)
            )
          )
          .limit(100);
        // Active = granted AND not revoked AND not expired (derived status;
        // no status column exists). Rows written by gdprDashboard have
        // expiresAt NULL → treated as non-expiring.
        const now = new Date();
        const active = records.filter(
          r =>
            r.granted === true &&
            !r.revokedAt &&
            (!r.expiresAt || new Date(r.expiresAt) > now)
        );
        const missing = CONSENT_TYPES.filter(
          t => !active.find(r => r.consentType === t)
        );
        return {
          userId: ownerId,
          activeConsents: active.length,
          missingConsents: missing,
          isCompliant:
            missing.filter(m => m === "data_processing").length === 0,
          consentTypes: CONSENT_TYPES,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        // 2026-10-25 (W12-R1, verifier F1+F2): delete stays a HARD delete
        // (GDPR/NDPR Art. 17 erasure-compatible — gdprDashboard's revoke
        // path preserves an audit trail, this endpoint is the erasure
        // path), but is now owner-or-admin gated and non-enumerating:
        // absent and foreign rows both answer NOT_FOUND, and only an
        // existing, accessible row is actually deleted.
        const [record] = await db
          .select()
          .from(dataConsentRecords)
          .where(eq(dataConsentRecords.id, input.id))
          .limit(100);
        assertRowAccess(ctx, record);
        await db
          .delete(dataConsentRecords)
          .where(eq(dataConsentRecords.id, input.id));
        // 2026-10-25 (W13-A, verifier R2.5 residual): audit-log the hard
        // delete via the established tamper-evident chain writer
        // (writeAuditLog, server/db.ts — same pattern as
        // actuarialRatesAdmin). Ids only, no PII: the row payload is gone
        // by design (Art. 17 erasure), this entry preserves WHO erased
        // WHICH consent record and WHEN. writeAuditLog is fail-soft
        // (logs on error) so an audit write failure never rolls back the
        // erasure itself.
        await writeAuditLog({
          agentId: ctx.user.id,
          action: "CONSENT_RECORD_DELETE",
          resource: "data_consent_record",
          resourceId: String(input.id),
          status: "success",
          metadata: {
            entityType: record.entityType,
            entityId: record.entityId,
            consentType: record.consentType,
          },
        });
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
});
