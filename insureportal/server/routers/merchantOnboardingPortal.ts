import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { eq, desc, sql, count, and } from "drizzle-orm";
import { merchants, merchantKycDocs, auditLog } from "@schema";
import { TRPCError } from "@trpc/server";

export const merchantOnboardingPortalRouter = router({
  listApplications: protectedProcedure
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
        const rows = input?.status
          ? await db
              .select()
              .from(merchants)
              .where(eq(merchants.status, input.status as any))
              .orderBy(desc(merchants.createdAt))
              .limit(input?.limit ?? 50)
          : await db
              .select()
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
  getApplication: protectedProcedure
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
  // CRIT-4 (G1 fix-wave, 2026-06): admin-only + KYB-complete precondition +
  // guarded transition + approver attribution (mirrors the platform fix).
  approveMerchant: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
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
        const REQUIRED = [
          "cac_certificate", "tin_certificate", "utility_bill",
          "bank_statement", "id_card", "passport", "bvn_verification",
          "memart",
        ];
        const missing = REQUIRED.filter(t => !approvedTypes.has(t));
        if (missing.length > 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `KYB incomplete — missing approved documents: ${missing.join(", ")}`,
          });
        }
        const claimed = await db
          .update(merchants)
          .set({ status: "active" })
          .where(and(eq(merchants.id, input.id), eq(merchants.status, "pending")))
          .returning({ id: merchants.id });
        if (claimed.length === 0) {
          const [current] = await db
            .select({ status: merchants.status })
            .from(merchants)
            .where(eq(merchants.id, input.id))
            .limit(1);
          if (!current)
            throw new TRPCError({ code: "NOT_FOUND", message: "Merchant not found" });
          throw new TRPCError({
            code: "CONFLICT",
            message: `Merchant is not pending approval (current: ${current.status})`,
          });
        }
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
  rejectMerchant: protectedProcedure
    .input(z.object({ id: z.number(), reason: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .update(merchants)
          .set({ status: "suspended" })
          .where(eq(merchants.id, input.id));
        await db.insert(auditLog).values({
          action: "merchant_rejected",
          resource: "merchants",
          resourceId: String(input.id),
          status: "success",
          metadata: { reason: input.reason },
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
  getStats: protectedProcedure.query(async () => {
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
