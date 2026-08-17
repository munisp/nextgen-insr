import { TRPCError } from "@trpc/server";
import {
  eq,
  desc,
  and,
  sql,
  count,
  sum,
  isNull,
  gte,
  lte,
  or,
  asc,
} from "drizzle-orm";
import { z } from "zod";

import { kycDocuments, auditLog } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const agentKycDocVaultRouter = router({
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { totalDocuments: 0, verified: 0, pending: 0, rejected: 0 };
    const [total] = await db
      .select({ value: count() })
      .from(kycDocuments)
      .limit(100);
    // F-12 (wave-4b): verified 0 / pending total / rejected 0 were
    // hardcoded — real status-grouped aggregates now.
    const byStatus = await db
      .select({ status: kycDocuments.status, value: count() })
      .from(kycDocuments)
      .groupBy(kycDocuments.status);
    const countOf = (st: string) =>
      Number(
        (byStatus as Array<{ status: string; value: number | string }>).find(
          r => r.status === st
        )?.value ?? 0
      );
    return {
      totalDocuments: Number(total.value),
      verified: countOf("verified") + countOf("approved"),
      pending: countOf("pending") + countOf("submitted"),
      rejected: countOf("rejected"),
    };
  }),
  listDocuments: protectedProcedure
    .input(
      z
        .object({
          agentId: z.number().optional(),
          limit: z.number().default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { documents: [], total: 0 };
        const conditions: any[] = [];
        if (input?.agentId)
          conditions.push(eq(kycDocuments.agentId, input.agentId));
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const rows = await db
          .select()
          .from(kycDocuments)
          .where(where)
          .orderBy(desc(kycDocuments.createdAt))
          .limit(input?.limit ?? 20);
        return { documents: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  uploadDocument: protectedProcedure
    .input(
      z.object({
        agentId: z.number(),
        docType: z.string(),
        docUrl: z.string(),
        docNumber: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const [doc] = await db
          .insert(kycDocuments)
          .values({
            agentId: input.agentId,
            docType: input.docType,
            docUrl: input.docUrl,
            docNumber: input.docNumber ?? "",
            status: "pending",
          })
          .returning();
        await db.insert(auditLog).values({
          action: "kyc_doc_uploaded",
          resource: "kyc_documents",
          resourceId: String(doc.id),
          status: "success",
          metadata: { agentId: input.agentId, docType: input.docType },
        });
        return { success: true, document: doc };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  verifyDocument: protectedProcedure
    .input(
      z.object({
        documentId: z.number(),
        verified: z.boolean(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const [updated] = await db
          .update(kycDocuments)
          .set({
            status: input.verified ? "verified" : "rejected",
            verifiedAt: input.verified ? new Date() : undefined,
          })
          .where(eq(kycDocuments.id, input.documentId))
          .returning();
        await db.insert(auditLog).values({
          action: input.verified ? "kyc_doc_verified" : "kyc_doc_rejected",
          resource: "kyc_documents",
          resourceId: String(input.documentId),
          status: "success",
        });
        return { success: true, document: updated };
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
