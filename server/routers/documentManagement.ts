import { TRPCError } from "@trpc/server";
import { eq, desc, sql, count } from "drizzle-orm";
import { z } from "zod";

import { kycDocuments, auditLog } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


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
  // ── Presigned direct-upload (P-wave perf, 2026-09-19) ────────────────────
  // Client uploads previously proxied raw bytes through the Node process.
  // This endpoint only AUTHORIZES and signs: it returns a presigned MinIO
  // PUT URL; the client uploads bytes directly to object storage. Auth-gated
  // (protectedProcedure), type allowlist, 10MB declared-size cap, key scoped
  // to the authenticated user. The proxied kyc.ts base64 path remains for
  // backward compatibility.
  requestUploadUrl: protectedProcedure
    .input(
      z.object({
        fileName: z.string().min(1).max(256),
        mimeType: z.enum([
          "image/jpeg",
          "image/png",
          "image/webp",
          "application/pdf",
        ]),
        fileSize: z
          .number()
          .int()
          .positive()
          .max(10 * 1024 * 1024, "File exceeds the 10MB upload limit"),
        purpose: z
          .enum(["kyc", "claim_document", "policy_document"])
          .default("kyc"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const { storagePresignPut } = await import("../storage");
        const safeName = input.fileName.replace(/[^A-Za-z0-9._-]/g, "_");
        const relKey = `uploads/${input.purpose}/${ctx.user.id}/${Date.now()}-${safeName}`;
        const signed = await storagePresignPut(relKey, input.mimeType);
        const db = (await getDb())!;
        await db.insert(auditLog).values({
          action: "upload_url_issued",
          resource: "storage",
          resourceId: signed.key,
          status: "success",
          metadata: {
            userId: ctx.user.id,
            mimeType: input.mimeType,
            fileSize: input.fileSize,
            purpose: input.purpose,
          },
        } as any);
        return {
          uploadUrl: signed.uploadUrl,
          fileKey: signed.key,
          bucket: signed.bucket,
          expiresIn: signed.expiresIn,
          instructions: `HTTP PUT the file bytes to uploadUrl with Content-Type: ${input.mimeType} (the signed Content-Type is enforced)`,
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
