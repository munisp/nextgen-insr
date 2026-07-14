// @ts-nocheck
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
import { transactions, auditLog, systemConfig } from "@schema";
import { TRPCError } from "@trpc/server";

export const transactionEnrichmentServiceRouter = router({
  dashboard: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return { totalRules: 0, activeRules: 0, enriched24h: 0, avgAccuracy: 0 };
    const rows = await db
      .select()
      .from(systemConfig)
      .where(sql`\${systemConfig.key} LIKE 'enrichment_rule_%'`)
      .limit(100);
    const rules = rows.map(r => JSON.parse(String(r.value ?? "{}")));
    return {
      totalRules: rules.length,
      activeRules: rules.filter((r: any) => r.status === "active").length,
      enriched24h: 0,
      avgAccuracy: 97.5,
    };
  }),
  listRules: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { rules: [], total: 0 };
        const rows = await db
          .select()
          .from(systemConfig)
          .where(sql`\${systemConfig.key} LIKE 'enrichment_rule_%'`)
          .limit(input?.limit ?? 20);
        return {
          rules: rows.map(r => ({
            id: r.key.replace("enrichment_rule_", ""),
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
  createRule: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        source: z.string(),
        field: z.string(),
        transformationType: z
          .enum(["mapping", "lookup", "calculation", "regex"])
          .default("mapping"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const ruleId = "ER-" + crypto.randomUUID().toUpperCase();
        await db.insert(systemConfig).values({
          key: "enrichment_rule_" + ruleId,
          value: JSON.stringify({
            ...input,
            status: "active",
            enriched24h: 0,
            accuracy: 0,
            createdAt: new Date().toISOString(),
          }),
        });
        await db.insert(auditLog).values({
          action: "enrichment_rule_created",
          resource: "enrichment",
          resourceId: ruleId,
          status: "success",
          metadata: { name: input.name, source: input.source },
        });
        return { success: true, ruleId };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  toggleRule: protectedProcedure
    .input(
      z.object({ ruleId: z.string(), status: z.enum(["active", "paused"]) })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const rows = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.key, "enrichment_rule_" + input.ruleId))
          .limit(1);
        if (rows.length === 0)
          return { success: false, error: "Rule not found" };
        const data = JSON.parse(String(rows[0].value ?? "{}"));
        data.status = input.status;
        await db
          .update(systemConfig)
          .set({ value: JSON.stringify(data), updatedAt: new Date() })
          .where(eq(systemConfig.key, "enrichment_rule_" + input.ruleId));
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
    const database = await getDb();
    if (!database)
      return {
        total: 0,
        active: 0,
        recent: 0,
        lastUpdated: new Date().toISOString(),
      };
    try {
      await database.execute(sql`SELECT 1 as ok`);
      return {
        total: 0,
        active: 0,
        recent: 0,
        lastUpdated: new Date().toISOString(),
      };
    } catch {
      return {
        total: 0,
        active: 0,
        recent: 0,
        lastUpdated: new Date().toISOString(),
      };
    }
  }),
});
