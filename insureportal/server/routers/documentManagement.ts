import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { eq, desc, sql, count } from "drizzle-orm";
import { kycDocuments, auditLog } from "@schema";
import { TRPCError } from "@trpc/server";

export const documentManagementRouter = router({
  listDocuments: protectedProcedure
    .input(
      z
        .object({ limit: z.number().default(50), type: z.string().optional() })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = input?.type
          ? await db
              .select()
              .from(kycDocuments)
              .where(eq(kycDocuments.docType, input.type))
              .orderBy(desc(kycDocuments.createdAt))
              .limit(input?.limit ?? 50)
          : await db
              .select()
              .from(kycDocuments)
              .orderBy(desc(kycDocuments.createdAt))
              .limit(input?.limit ?? 50);
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
  getDocument: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [doc] = await db
          .select()
          .from(kycDocuments)
          .where(eq(kycDocuments.id, input.id))
          .limit(1);
        return doc ?? null;
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
        documentType: z.string(),
        documentNumber: z.string(),
        expiryDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [doc] = await db
          .insert(kycDocuments)
          .values({
            agentId: input.agentId,
            documentType: input.documentType,
            documentNumber: input.documentNumber,
            status: "pending",
            expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
          } as any)
          .returning();
        await db.insert(auditLog).values({
          action: "document_uploaded",
          resource: "kyc_documents",
          resourceId: String(doc.id),
          status: "success",
          metadata: {
            agentId: input.agentId,
            documentType: input.documentType,
          },
        } as any);
        return doc;
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
        id: z.number(),
        verified: z.boolean(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .update(kycDocuments)
          .set({ status: input.verified ? "verified" : "rejected" })
          .where(eq(kycDocuments.id, input.id));
        await db.insert(auditLog).values({
          action: input.verified ? "document_verified" : "document_rejected",
          resource: "kyc_documents",
          resourceId: String(input.id),
          status: "success",
          metadata: { notes: input.notes },
        });
        return {
          success: true,
          id: input.id,
          status: input.verified ? "verified" : "rejected",
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
  getStats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [total] = await db
      .select({ value: count() })
      .from(kycDocuments)
      .limit(100);
    return {
      totalDocuments: Number(total.value),
      lastUpdated: new Date().toISOString(),
    };
  }),

  dashboard: protectedProcedure.query(async () => {
    return {
      totalItems: 0,
      activeItems: 0,
      recentActivity: [],
      lastUpdated: new Date().toISOString(),
    };
  }),
});
