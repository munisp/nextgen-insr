// @ts-check
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
import { systemConfig, auditLog } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

export const runtimeConfigAdminRouter = router({
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { totalConfigs: 0, modifiedToday: 0, environments: 0 };
    const [total] = await db
      .select({ value: count() })
      .from(systemConfig)
      .limit(100);
    return {
      totalConfigs: Number(total.value),
      modifiedToday: 0,
      environments: 3,
    };
  }),
  listConfigs: protectedProcedure
    .input(
      z
        .object({
          prefix: z.string().optional(),
          limit: z.number().default(50),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { configs: [], total: 0 };
        const conditions: any[] = [];
        if (input?.prefix)
          conditions.push(sql`${systemConfig.key} LIKE ${input.prefix + "%"}`);
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const rows = await db
          .select()
          .from(systemConfig)
          .where(where)
          .orderBy(asc(systemConfig.key))
          .limit(input?.limit ?? 50);
        return {
          configs: rows.map(r => ({
            key: r.key,
            value: r.value,
            updatedAt: r.updatedAt,
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
  getConfig: protectedProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("Database connection unavailable");
        const rows = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.key, input.key))
          .limit(1);
        return rows.length > 0
          ? {
              key: rows[0].key,
              value: rows[0].value,
              updatedAt: rows[0].updatedAt,
            }
          : null;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  setConfig: protectedProcedure
    .input(z.object({ key: z.string(), value: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db
          .insert(systemConfig)
          .values({ key: input.key, value: input.value })
          .onConflictDoUpdate({
            target: systemConfig.key,
            set: { value: input.value, updatedAt: new Date() },
          });
        await db.insert(auditLog).values({
          action: "config_updated",
          resource: "system_config",
          resourceId: input.key,
          status: "success",
          metadata: { key: input.key },
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
  deleteConfig: protectedProcedure
    .input(z.object({ key: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.delete(systemConfig).where(eq(systemConfig.key, input.key));
        await db.insert(auditLog).values({
          action: "config_deleted",
          resource: "system_config",
          resourceId: input.key,
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
  get: protectedProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("Database connection unavailable");
        const rows = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.key, input.key))
          .limit(1);
        return rows.length > 0
          ? {
              key: rows[0].key,
              value: rows[0].value,
              updatedAt: rows[0].updatedAt,
            }
          : null;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  batchUpdate: protectedProcedure
    .input(
      z.object({
        configs: z.array(z.object({ key: z.string(), value: z.string() })),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const results = [];
        for (const cfg of input.configs) {
          await db
            .insert(systemConfig)
            .values({ key: cfg.key, value: cfg.value })
            .onConflictDoUpdate({
              target: systemConfig.key,
              set: { value: cfg.value, updatedAt: new Date() },
            });
          results.push({ key: cfg.key, success: true });
        }
        await db.insert(auditLog).values({
          action: "config_batch_updated",
          resource: "system_config",
          status: "success",
          metadata: {
            count: input.configs.length,
            keys: input.configs.map(c => c.key),
          },
        });
        return { updated: results.length, results };
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
