// Sprint 87: Full domain logic — document verification workflow, expiry tracking, compliance scoring
import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { z } from "zod";

import { kycDocuments } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

const REQUIRED_DOC_TYPES = ["BVN", "NIN", "utility_bill", "passport_photo"];
const DOC_EXPIRY_DAYS: Record<string, number> = {
  utility_bill: 90,
  passport_photo: 1825,
  cac_cert: 365,
  BVN: 99999,
  NIN: 99999,
};

function calculateComplianceScore(docs: any[]): {
  score: number;
  missing: string[];
  expired: string[];
} {
  const missing = REQUIRED_DOC_TYPES.filter(
    t => !docs.find(d => d.docType === t && d.status === "verified")
  );
  const now = Date.now();
  const expired = docs
    .filter(d => {
      const expiryDays = DOC_EXPIRY_DAYS[d.docType] || 365;
      const expiryDate =
        new Date(d.createdAt).getTime() + expiryDays * 86400000;
      return expiryDate < now && d.status === "verified";
    })
    .map(d => d.docType);
  const score = Math.round(
    ((REQUIRED_DOC_TYPES.length - missing.length) / REQUIRED_DOC_TYPES.length) *
      100
  );
  return { score, missing, expired };
}

export const kycDocumentsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        agentId: z.number().optional(),
        status: z.string().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const conditions: any[] = [];
        if (input.agentId)
          conditions.push(eq(kycDocuments.agentId, input.agentId));
        if (input.status)
          conditions.push(eq(kycDocuments.status, input.status));
        const rows = await db
          .select()
          .from(kycDocuments)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(kycDocuments.id))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(kycDocuments)
          .where(conditions.length ? and(...conditions) : undefined)
          .limit(100);
        return { items: rows, total };
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
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [row] = await db
          .select()
          .from(kycDocuments)
          .where(eq(kycDocuments.id, input.id))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "KYC document not found",
          });
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
  submit: protectedProcedure
    .input(
      z.object({
        agentId: z.number(),
        docType: z.string(),
        docNumber: z.string().optional(),
        docUrl: z.string().url(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        // Check for duplicate submission
        const [existing] = await db
          .select()
          .from(kycDocuments)
          .where(
            and(
              eq(kycDocuments.agentId, input.agentId),
              eq(kycDocuments.docType, input.docType),
              eq(kycDocuments.status, "pending")
            )
          )
          .limit(100);
        if (existing)
          throw new TRPCError({
            code: "CONFLICT",
            message: `A ${input.docType} document is already pending review`,
          });
        // BVN must be 11 digits
        if (
          input.docType === "BVN" &&
          input.docNumber &&
          !/^[0-9]{11}$/.test(input.docNumber)
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "BVN must be exactly 11 digits",
          });
        // NIN must be 11 digits
        if (
          input.docType === "NIN" &&
          input.docNumber &&
          !/^[0-9]{11}$/.test(input.docNumber)
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "NIN must be exactly 11 digits",
          });
        const [row] = await db
          .insert(kycDocuments)
          .values({
            agentId: input.agentId,
            docType: input.docType,
            docNumber: input.docNumber || null,
            docUrl: input.docUrl,
            status: "pending",
          })
          .returning();
        return { ...row, message: "Document submitted for verification" };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  verify: protectedProcedure
    .input(z.object({ id: z.number(), verifiedBy: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [doc] = await db
          .select()
          .from(kycDocuments)
          .where(eq(kycDocuments.id, input.id))
          .limit(100);
        if (!doc)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Document not found",
          });
        if (doc.status !== "pending")
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Cannot verify a document with status: ${doc.status}`,
          });
        const [row] = await db
          .update(kycDocuments)
          .set({
            status: "verified",
            verifiedBy: input.verifiedBy,
            verifiedAt: new Date(),
          })
          .where(eq(kycDocuments.id, input.id))
          .returning();
        return { ...row, message: "Document verified" };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  reject: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        verifiedBy: z.number(),
        rejectionReason: z.string().min(10),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [doc] = await db
          .select()
          .from(kycDocuments)
          .where(eq(kycDocuments.id, input.id))
          .limit(100);
        if (!doc)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Document not found",
          });
        if (doc.status !== "pending")
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Cannot reject a document with status: ${doc.status}`,
          });
        const [row] = await db
          .update(kycDocuments)
          .set({
            status: "rejected",
            verifiedBy: input.verifiedBy,
            verifiedAt: new Date(),
            rejectionReason: input.rejectionReason,
          })
          .where(eq(kycDocuments.id, input.id))
          .returning();
        return { ...row, message: "Document rejected" };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getComplianceScore: protectedProcedure
    .input(z.object({ agentId: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const docs = await db
          .select()
          .from(kycDocuments)
          .where(eq(kycDocuments.agentId, input.agentId))
          .limit(100);
        const compliance = calculateComplianceScore(docs);
        return {
          agentId: input.agentId,
          ...compliance,
          documents: docs,
          isCompliant:
            compliance.score === 100 && compliance.expired.length === 0,
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
});
