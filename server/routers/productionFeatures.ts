// @ts-check
// Production features: rateLimit configuration, health check endpoints, monitoring
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
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
import { auditLog, systemConfig } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

export const productionFeaturesRouter = router({
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return {
        totalFeatures: 0,
        enabled: 0,
        disabled: 0,
        rolloutInProgress: 0,
      };
    const rows = await db
      .select()
      .from(systemConfig)
      .where(sql`${systemConfig.key} LIKE 'ff_%'`)
      .limit(100);
    const enabled = rows.filter(r => {
      try {
        return JSON.parse(String(r.value ?? "{}")).enabled === true;
      } catch {
        return false;
      }
    }).length;
    return {
      totalFeatures: rows.length,
      enabled,
      disabled: rows.length - enabled,
      rolloutInProgress: 0,
    };
  }),
  listFeatures: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { features: [], total: 0 };
        const rows = await db
          .select()
          .from(systemConfig)
          .where(sql`${systemConfig.key} LIKE 'ff_%'`)
          .limit(input?.limit ?? 50);
        return {
          features: rows.map(r => ({
            key: r.key.replace("ff_", ""),
            ...JSON.parse(String(r.value ?? "{}")),
          })),
          total: rows.length,
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
  toggleFeature: protectedProcedure
    .input(z.object({ featureKey: z.string(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const key = "ff_" + input.featureKey;
        const rows = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.key, key))
          .limit(1);
        const existing =
          rows.length > 0 ? JSON.parse(String(rows[0].value ?? "{}")) : {};
        const merged = {
          ...existing,
          enabled: input.enabled,
          updatedAt: new Date().toISOString(),
        };
        await db
          .insert(systemConfig)
          .values({ key, value: JSON.stringify(merged) })
          .onConflictDoUpdate({
            target: systemConfig.key,
            set: { value: JSON.stringify(merged), updatedAt: new Date() },
          });
        await db.insert(auditLog).values({
          action: input.enabled ? "feature_enabled" : "feature_disabled",
          resource: "feature_flags",
          resourceId: input.featureKey,
          status: "success",
          metadata: { enabled: input.enabled },
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
  createFeature: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        enabled: z.boolean().default(false),
        rolloutPercent: z.number().default(0),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const key = "ff_" + input.name.toLowerCase().replace(/\s+/g, "_");
        await db.insert(systemConfig).values({
          key,
          value: JSON.stringify({
            name: input.name,
            description: input.description,
            enabled: input.enabled,
            rolloutPercent: input.rolloutPercent,
            createdAt: new Date().toISOString(),
          }),
        });
        await db.insert(auditLog).values({
          action: "feature_created",
          resource: "feature_flags",
          resourceId: key,
          status: "success",
          metadata: { name: input.name },
        });
        return { success: true, featureKey: key };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  batchOps: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "Batch operations are not implemented yet",
    });
  }),

  prefMatrix: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "Preference matrix is not implemented yet",
    });
  }),
});
