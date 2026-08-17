import { TRPCError } from "@trpc/server";
import { eq, desc, sql, count } from "drizzle-orm";
import { z } from "zod";

import { tenantFeatureToggles, auditLog } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const featureFlagsRouter = router({
  listFlags: protectedProcedure
    .input(z.object({ limit: z.number().default(100) }).optional())
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(tenantFeatureToggles)
          .orderBy(desc(tenantFeatureToggles.createdAt))
          .limit(input?.limit ?? 100);
        return { flags: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getFlag: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [flag] = await db
          .select()
          .from(tenantFeatureToggles)
          .where(eq(tenantFeatureToggles.id, input.id))
          .limit(1);
        return flag ?? null;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  toggleFlag: protectedProcedure
    .input(z.object({ id: z.number(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .update(tenantFeatureToggles)
          .set({ enabled: input.enabled })
          .where(eq(tenantFeatureToggles.id, input.id));
        await db.insert(auditLog).values({
          action: input.enabled
            ? "feature_flag_enabled"
            : "feature_flag_disabled",
          resource: "tenant_feature_toggles",
          resourceId: String(input.id),
          status: "success",
          metadata: { enabled: input.enabled },
        });
        return { success: true, id: input.id, enabled: input.enabled };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  createFlag: protectedProcedure
    .input(
      z.object({
        featureName: z.string(),
        tenantId: z.number(),
        enabled: z.boolean().default(false),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [flag] = await db
          .insert(tenantFeatureToggles)
          .values({
            featureName: input.featureName,
            tenantId: input.tenantId,
            enabled: input.enabled,
          } as any)
          .returning();
        await db.insert(auditLog).values({
          action: "feature_flag_created",
          resource: "tenant_feature_toggles",
          resourceId: String(flag.id),
          status: "success",
          metadata: { featureName: input.featureName },
        } as any);
        return flag;
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
      .from(tenantFeatureToggles)
      .limit(100);
    return {
      totalFlags: Number(total.value),
      lastUpdated: new Date().toISOString(),
    };
  }),
  // F-12 (wave-4b): zero-payload dashboard + environments fixture — no
  // feature-flag dashboard store is delivered. Fail loud.
  dashboard: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "dashboard: no feature-flag dashboard store is delivered",
    });
  }),
});
