/**
 * merchantOnboardingPortal.ts — G1 fix-wave (2026-06)
 *
 * Audit fixes:
 *  - CRIT-4: approveMerchant was a plain protectedProcedure — ANY logged-in
 *    user could flip any merchant to active. It is now admin-only, gated on
 *    KYB completeness (all required doc types approved by an admin), uses a
 *    guarded state transition (pending -> active; no last-writer-wins), and
 *    logs the approver identity.
 *  - HIGH-12: list/get exposed ALL merchants incl. settlement account PII to
 *    any authenticated user. All portal reads are now admin-only and the list
 *    view selects a masked column set.
 *  - MED-16: approval advances the PERSISTED KYC stage to "approval" then
 *    "activation" (the doc-count-derived stage machine could never reach it).
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, sql, count, and } from "drizzle-orm";
import { z } from "zod";

import {
  merchants,
  merchantKycDocs,
  merchantKycStages,
  auditLog,
} from "../../drizzle/schema";
import { router, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";

// Same required doc set as merchantKycOnboarding.KYC_DOC_TYPES.
const REQUIRED_KYC_DOC_TYPES = [
  "cac_certificate",
  "tin_certificate",
  "utility_bill",
  "bank_statement",
  "id_card",
  "passport",
  "bvn_verification",
  "memart",
];

/** Mask all but the last 4 digits of an account number for list views. */
function maskAccount(acct: string | null): string | null {
  if (!acct) return null;
  return acct.length <= 4 ? "****" : `****${acct.slice(-4)}`;
}

async function setKycStage(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  merchantId: number,
  stage: string,
  updatedBy: number
): Promise<void> {
  await db
    .insert(merchantKycStages)
    .values({ merchantId, stage, updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: merchantKycStages.merchantId,
      set: { stage, updatedBy, updatedAt: new Date() },
    });
}

export const merchantOnboardingPortalRouter = router({
  // HIGH-12: admin-only; masked column selection (no raw settlement account,
  // no owner address/phone dump).
  listApplications: adminProcedure
    .input(
      z
        .object({
          limit: z.number().default(50),
          status: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const selection = {
          id: merchants.id,
          merchantCode: merchants.merchantCode,
          businessName: merchants.businessName,
          category: merchants.category,
          status: merchants.status,
          rcNumber: merchants.rcNumber,
          tinNumber: merchants.tinNumber,
          settlementAccountMasked: sql<string | null>`CASE WHEN ${merchants.settlementAccountNumber} IS NULL THEN NULL ELSE '****' || RIGHT(${merchants.settlementAccountNumber}, 4) END`,
          settlementBankName: merchants.settlementBankName,
          createdAt: merchants.createdAt,
        };
        const rows = input?.status
          ? await db
              .select(selection)
              .from(merchants)
              .where(eq(merchants.status, input.status as any))
              .orderBy(desc(merchants.createdAt))
              .limit(input?.limit ?? 50)
          : await db
              .select(selection)
              .from(merchants)
              .orderBy(desc(merchants.createdAt))
              .limit(input?.limit ?? 50);
        return { applications: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  // HIGH-12: admin-only. Full record incl. docs is an auditor view.
  getApplication: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [merchant] = await db
          .select()
          .from(merchants)
          .where(eq(merchants.id, input.id))
          .limit(1);
        if (!merchant) return null;
        const docs = await db
          .select()
          .from(merchantKycDocs)
          .where(eq(merchantKycDocs.merchantId, input.id))
          .limit(100);
        return { ...merchant, documents: docs };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  // CRIT-4: admin-only + KYB-complete precondition + guarded transition +
  // approver attribution.
  approveMerchant: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        // KYB-complete precondition: every required doc type approved.
        const docs = await db
          .select({
            docType: merchantKycDocs.docType,
            status: merchantKycDocs.status,
          })
          .from(merchantKycDocs)
          .where(eq(merchantKycDocs.merchantId, input.id))
          .limit(200);
        const approvedTypes = new Set(
          docs.filter(d => d.status === "approved").map(d => d.docType)
        );
        const missing = REQUIRED_KYC_DOC_TYPES.filter(
          t => !approvedTypes.has(t)
        );
        if (missing.length > 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `KYB incomplete — missing approved documents: ${missing.join(", ")}`,
          });
        }

        // MED-14: guarded state transition. Only a pending merchant can be
        // approved; concurrent approve/reject is no longer last-writer-wins.
        const claimed = await db
          .update(merchants)
          .set({ status: "active", updatedAt: new Date() })
          .where(
            and(eq(merchants.id, input.id), eq(merchants.status, "pending"))
          )
          .returning({ id: merchants.id });
        if (claimed.length === 0) {
          const [current] = await db
            .select({ status: merchants.status })
            .from(merchants)
            .where(eq(merchants.id, input.id))
            .limit(1);
          if (!current)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Merchant not found",
            });
          throw new TRPCError({
            code: "CONFLICT",
            message: `Merchant is not pending approval (current: ${current.status})`,
          });
        }

        // MED-16: approval is the ONLY path that advances the persisted stage
        // to "approval" -> "activation".
        await setKycStage(db, input.id, "approval", ctx.user.id);
        await setKycStage(db, input.id, "activation", ctx.user.id);

        await db.insert(auditLog).values({
          action: "merchant_approved",
          resource: "merchants",
          resourceId: String(input.id),
          status: "success",
          metadata: { approvedBy: ctx.user.id, approverEmail: ctx.user.email },
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
  rejectMerchant: adminProcedure
    .input(z.object({ id: z.number(), reason: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        // MED-14: guarded transition — only pending merchants can be rejected.
        const claimed = await db
          .update(merchants)
          .set({ status: "suspended", updatedAt: new Date() })
          .where(
            and(eq(merchants.id, input.id), eq(merchants.status, "pending"))
          )
          .returning({ id: merchants.id });
        if (claimed.length === 0) {
          const [current] = await db
            .select({ status: merchants.status })
            .from(merchants)
            .where(eq(merchants.id, input.id))
            .limit(1);
          if (!current)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Merchant not found",
            });
          throw new TRPCError({
            code: "CONFLICT",
            message: `Merchant is not pending review (current: ${current.status})`,
          });
        }
        await db.insert(auditLog).values({
          action: "merchant_rejected",
          resource: "merchants",
          resourceId: String(input.id),
          status: "success",
          metadata: { reason: input.reason, rejectedBy: ctx.user.id },
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
  getStats: adminProcedure.query(async () => {
    const db = (await getDb())!;
    const [total] = await db
      .select({ value: count() })
      .from(merchants)
      .limit(100);
    const [active] = await db
      .select({ value: count() })
      .from(merchants)
      .where(eq(merchants.status, "active"))
      .limit(100);
    const [pending] = await db
      .select({ value: count() })
      .from(merchants)
      .where(eq(merchants.status, "pending"))
      .limit(100);
    return {
      totalMerchants: Number(total.value),
      activeMerchants: Number(active.value),
      pendingMerchants: Number(pending.value),
    };
  }),
});
