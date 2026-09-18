// @ts-check
/**
 * F06: Merchant KYC & Onboarding Workflow
 * Document upload, verification workflow, compliance checks, merchant activation
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, and, count, sql } from "drizzle-orm";
import { z } from "zod";

import {
  merchantKycDocs,
  merchantKycStages,
  merchants,
} from "../../drizzle/schema";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";


const KYC_DOC_TYPES = [
  "cac_certificate",
  "tin_certificate",
  "utility_bill",
  "bank_statement",
  "id_card",
  "passport",
  "bvn_verification",
  "memart",
];
const KYC_STAGES = [
  "document_collection",
  "verification",
  "compliance_review",
  "approval",
  "activation",
];

export const merchantKycOnboardingRouter = router({
  // HIGH-7/#20 (G1 fix-wave, 2026-06): KYB documents (incl. raw doc URLs
  // and CAC/TIN/BVN numbers) are PII — admin/auditor view only.
  listDocs: adminProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        merchantId: z.number().optional(),
        status: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { items: [], total: 0 };
        const conditions = [];
        if (input.merchantId)
          conditions.push(eq(merchantKycDocs.merchantId, input.merchantId));
        if (input.status)
          conditions.push(eq(merchantKycDocs.status, input.status));
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const items = await db
          .select()
          .from(merchantKycDocs)
          .where(where)
          .orderBy(desc(merchantKycDocs.createdAt))
          .limit(input.limit)
          .offset((input.page - 1) * input.limit);
        const [{ total }] = await db
          .select({ total: count() })
          .from(merchantKycDocs)
          .where(where)
          .limit(100);
        return { items, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // HIGH-7 (G1 fix-wave, 2026-06): uploads were previously accepted for ANY
  // merchantId from ANY authenticated user. Now the caller must be an admin
  // or the merchant bound to the caller's Keycloak identity.
  // MED-20: docUrl must point at our controlled document storage
  // (MERCHANT_DOC_URL_PREFIX), not an arbitrary external URL.
  uploadDoc: protectedProcedure
    .input(
      z.object({
        merchantId: z.number(),
        docType: z.enum([
          "cac_certificate",
          "tin_certificate",
          "utility_bill",
          "bank_statement",
          "id_card",
          "passport",
          "bvn_verification",
          "memart",
        ]),
        docUrl: z.string().url().max(1024),
        expiryDate: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");

        if (ctx.user.role !== "admin") {
          const [own] = await db
            .select({ id: merchants.id })
            .from(merchants)
            .where(
              and(
                eq(merchants.id, input.merchantId),
                eq(merchants.keycloakSub, ctx.user.keycloakSub),
                sql`${merchants.deletedAt} IS NULL`
              )
            )
            .limit(1);
          if (!own)
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "Documents can only be uploaded for your own merchant account",
            });
        }

        const prefix = process.env.MERCHANT_DOC_URL_PREFIX;
        if (prefix && !input.docUrl.startsWith(prefix)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "docUrl must reference the platform document storage bucket",
          });
        }

        const [doc] = await db
          .insert(merchantKycDocs)
          .values({
            merchantId: input.merchantId,
            docType: input.docType,
            docUrl: input.docUrl,
            expiresAt: input.expiryDate ? new Date(input.expiryDate) : null,
            status: "pending",
          })
          .returning();
        return { doc };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // HIGH-7 (G1 fix-wave, 2026-06): document approval/rejection is an
  // admin-only KYB decision. Guarded transition: only pending docs can be
  // decided, so concurrent decisions can't overwrite each other.
  verifyDoc: adminProcedure
    .input(
      z.object({
        docId: z.number(),
        approved: z.boolean(),
        rejectionReason: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        const claimed = await db
          .update(merchantKycDocs)
          .set({
            status: input.approved ? "approved" : "rejected",
            verifiedBy: ctx.user.id,
            verifiedAt: new Date(),
            rejectionReason: input.approved ? null : input.rejectionReason,
          })
          .where(
            and(
              eq(merchantKycDocs.id, input.docId),
              eq(merchantKycDocs.status, "pending")
            )
          )
          .returning({ id: merchantKycDocs.id });
        if (claimed.length === 0) {
          const [current] = await db
            .select({ status: merchantKycDocs.status })
            .from(merchantKycDocs)
            .where(eq(merchantKycDocs.id, input.docId))
            .limit(1);
          if (!current)
            throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
          throw new TRPCError({
            code: "CONFLICT",
            message: `Document already decided (status: ${current.status})`,
          });
        }
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

  kycProgress: protectedProcedure
    .input(z.object({ merchantId: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          return {
            required: KYC_DOC_TYPES,
            submitted: [],
            approved: [],
            rejected: [],
            progress: 0,
            stage: KYC_STAGES[0],
          };
        const docs = await db
          .select()
          .from(merchantKycDocs)
          .where(eq(merchantKycDocs.merchantId, input.merchantId))
          .limit(100);
        const submitted = docs.map(d => d.docType);
        const approved = docs
          .filter(d => d.status === "approved")
          .map(d => d.docType);
        const rejected = docs
          .filter(d => d.status === "rejected")
          .map(d => d.docType);
        const progress = Math.round(
          (approved.length / KYC_DOC_TYPES.length) * 100
        );
        // MED-16 (G1 fix-wave, 2026-06): the stage is PERSISTED, not derived
        // from doc counts. Derived stages made "approval" unreachable and let
        // doc counts alone jump to "activation". Document progress can only
        // advance the stage as far as compliance_review; "approval" and
        // "activation" are assigned exclusively by the admin
        // merchantOnboardingPortal.approveMerchant path after the KYB gate.
        const derived =
          approved.length === KYC_DOC_TYPES.length
            ? KYC_STAGES[2] // compliance_review — ready for admin decision
            : submitted.length === KYC_DOC_TYPES.length
              ? KYC_STAGES[1] // verification
              : KYC_STAGES[0]; // document_collection
        const [persisted] = await db
          .select({ stage: merchantKycStages.stage })
          .from(merchantKycStages)
          .where(eq(merchantKycStages.merchantId, input.merchantId))
          .limit(1);
        const ORDER = KYC_STAGES;
        const stage =
          persisted &&
          ORDER.indexOf(persisted.stage) > ORDER.indexOf(derived)
            ? persisted.stage
            : derived;
        return {
          required: KYC_DOC_TYPES,
          submitted,
          approved,
          rejected,
          progress,
          stage,
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

  docTypes: protectedProcedure.query(() => KYC_DOC_TYPES),
  stages: protectedProcedure.query(() => KYC_STAGES),
});
