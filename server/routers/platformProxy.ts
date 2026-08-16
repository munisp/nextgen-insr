import { TRPCError } from "@trpc/server";
import { eq, desc, sql, count, avg, and } from "drizzle-orm";
import { z } from "zod";

import {
  rateLimitRules,
  platform_health_checks,
  systemConfig,
  auditLog,
} from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const platformProxyRouter = router({
  listRoutes: protectedProcedure
    .input(
      z.object({ limit: z.number().min(1).max(200).default(50) }).optional()
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(rateLimitRules)
          .orderBy(desc(rateLimitRules.createdAt))
          .limit(input?.limit ?? 50);
        return { routes: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getConfig: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [config] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, "proxy_config"))
      .limit(1);
    return config
      ? JSON.parse(String(config.value))
      : {
          upstream: process.env.APP_UPSTREAM_URL ?? "http://localhost:3000",
          timeout: 30000,
          retries: 3,
          circuitBreaker: { threshold: 5, resetMs: 60000 },
        };
  }),
  updateConfig: protectedProcedure
    .input(
      z.object({
        timeout: z.number().min(1000).max(120000).optional(),
        retries: z.number().int().min(0).max(10).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const key = "proxy_config";
        const [existing] = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.key, key))
          .limit(1);
        const current = existing ? JSON.parse(String(existing.value)) : {};
        const merged = { ...current, ...input };
        if (existing) {
          await db
            .update(systemConfig)
            .set({ value: JSON.stringify(merged) })
            .where(eq(systemConfig.key, key));
        } else {
          await db
            .insert(systemConfig)
            .values({ key, value: JSON.stringify(merged) });
        }
        await db.insert(auditLog).values({
          action: "proxy_config_updated",
          resource: "platform_proxy",
          resourceId: "config",
          status: "success",
          metadata: input,
        });
        return { success: true, config: merged };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getUpstreamHealth: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [stats] = await db
      .select({
        total: count(),
        avgLat: avg(platform_health_checks.responseTime),
      })
      .from(platform_health_checks)
      .limit(100);
    return {
      status: "healthy",
      totalChecks: Number(stats.total),
      avgLatencyMs: Math.round(Number(stats.avgLat ?? 0)),
    };
  }),
  getStats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [rules] = await db
      .select({ value: count() })
      .from(rateLimitRules)
      .limit(100);
    const [checks] = await db
      .select({ value: count() })
      .from(platform_health_checks)
      .limit(100);
    return {
      totalRules: Number(rules.value),
      totalChecks: Number(checks.value),
    };
  }),
});
