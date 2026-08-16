import { TRPCError } from "@trpc/server";
import { eq, desc, sql, count } from "drizzle-orm";
import { z } from "zod";

import { merchants, merchantKycDocs, auditLog } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


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
  approveMerchant: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .update(merchants)
          .set({ status: "active" })
          .where(eq(merchants.id, input.id));
        await db.insert(auditLog).values({
          action: "merchant_approved",
          resource: "merchants",
          resourceId: String(input.id),
          status: "success",
          metadata: {},
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
