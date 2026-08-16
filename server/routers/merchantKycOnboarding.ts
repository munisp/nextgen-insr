// @ts-check
/**
 * F06: Merchant KYC & Onboarding Workflow
 * Document upload, verification workflow, compliance checks, merchant activation
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, and, count, sql } from "drizzle-orm";
import { z } from "zod";

import { merchantKycDocs } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
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
  listDocs: protectedProcedure
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

  uploadDoc: protectedProcedure
    .input(
      z.object({
        merchantId: z.number(),
        docType: z.string(),
        docUrl: z.string(),
        docNumber: z.string().optional(),
        expiryDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        const [doc] = await db
          .insert(merchantKycDocs)
          .values({
            merchantId: input.merchantId,
            docType: input.docType,
            docUrl: input.docUrl,
            docNumber: input.docNumber,
            expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
            status: "pending",
          } as any)
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

  verifyDoc: protectedProcedure
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
        await db
          .update(merchantKycDocs)
          .set({
            status: input.approved ? "approved" : "rejected",
            verifiedBy: ctx.user?.id,
            verifiedAt: new Date(),
            rejectionReason: input.rejectionReason,
          })
          .where(eq(merchantKycDocs.id, input.docId));
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
        let stage = KYC_STAGES[0];
        if (submitted.length === KYC_DOC_TYPES.length) stage = KYC_STAGES[1];
        if (approved.length > KYC_DOC_TYPES.length / 2) stage = KYC_STAGES[2];
        if (approved.length === KYC_DOC_TYPES.length) stage = KYC_STAGES[4];
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
