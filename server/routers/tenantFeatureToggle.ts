// @ts-check

/**
 * F10: Multi-Tenant Feature Toggle
 * Feature flags per tenant, rollout percentages, A/B testing, kill switches
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { tenantFeatureToggles } from "../../drizzle/schema";
import { eq, desc, and, count, sql } from "drizzle-orm";

export const tenantFeatureToggleRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(50),
        tenantId: z.number().optional(),
        featureName: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { items: [], total: 0 };
        const conditions = [];
        if (input.tenantId)
          conditions.push(eq(tenantFeatureToggles.tenantId, input.tenantId));
        if (input.featureName)
          conditions.push(
            eq(tenantFeatureToggles.featureKey, input.featureName)
          );
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const items = await db
          .select()
          .from(tenantFeatureToggles)
          .where(where)
          .orderBy(desc(tenantFeatureToggles.createdAt))
          .limit(input.limit)
          .offset((input.page - 1) * input.limit);
        const [{ total }] = await db
          .select({ total: count() })
          .from(tenantFeatureToggles)
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

  create: protectedProcedure
    .input(
      z.object({
        tenantId: z.number(),
        featureName: z.string(),
        enabled: z.boolean().default(false),
        rolloutPercentage: z.number().min(0).max(100).default(0),
        config: z.any().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        const [toggle] = await db
          .insert(tenantFeatureToggles)
          .values({
            tenantId: input.tenantId,
            featureName: input.featureName,
            enabled: input.enabled,
            rolloutPercentage: input.rolloutPercentage,
            config: input.config ? JSON.stringify(input.config) : null,
            updatedBy: ctx.user?.id,
          } as any)
          .returning();
        return { toggle };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        toggleId: z.number(),
        enabled: z.boolean().optional(),
        rolloutPercentage: z.number().optional(),
        config: z.any().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        const updates: any = { updatedAt: new Date(), updatedBy: ctx.user?.id };
        if (input.enabled !== undefined) updates.enabled = input.enabled;
        if (input.rolloutPercentage !== undefined)
          updates.rolloutPercentage = input.rolloutPercentage;
        if (input.config !== undefined)
          updates.config = JSON.stringify(input.config);
        await db
          .update(tenantFeatureToggles)
          .set(updates)
          .where(eq(tenantFeatureToggles.id, input.toggleId));
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

  delete: protectedProcedure
    .input(z.object({ toggleId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        await db
          .delete(tenantFeatureToggles)
          .where(eq(tenantFeatureToggles.id, input.toggleId));
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

  // Check if feature is enabled for a tenant
  isEnabled: protectedProcedure
    .input(z.object({ tenantId: z.number(), featureName: z.string() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { enabled: false };
        const [toggle] = await db
          .select()
          .from(tenantFeatureToggles)
          .where(
            and(
              eq(tenantFeatureToggles.tenantId, input.tenantId),
              eq(tenantFeatureToggles.featureKey, input.featureName)
            )
          );
        if (!toggle) return { enabled: false };
        if (!toggle.enabled) return { enabled: false };
        const config = toggle.config ? JSON.parse(String(toggle.config)) : null;
        const rollout = config?.rolloutPercentage ?? 100;
        if (rollout < 100) {
          const hash = (input.tenantId * 31 + input.featureName.length) % 100;
          return { enabled: hash < rollout };
        }
        return {
          enabled: true,
          config: toggle.config ? JSON.parse(String(toggle.config)) : null,
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

  // Kill switch — disable feature globally
  killSwitch: protectedProcedure
    .input(z.object({ featureName: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        await db
          .update(tenantFeatureToggles)
          .set({ enabled: false } as any)
          .where(eq(tenantFeatureToggles.featureKey, input.featureName));
        return { success: true, killed: input.featureName };
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
