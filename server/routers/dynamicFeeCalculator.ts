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

// ── Middleware Integration (Sprint 44) ──────────────────────────────
import { publishEvent, type KafkaTopic } from "../kafkaClient";
import { cacheSet, cacheGet } from "../redisClient";
import { tbCreateTransfer } from "../tbClient";
import { fluvioProduce } from "../fluvio";
import { permifyCheck } from "../_core/permify";

export const dynamicFeeCalculatorRouter = router({
  getStats: protectedProcedure.query(async () => {
    try {
      const db = await getDb();
      if (!db) return { totalRules: 0, activeRules: 0, avgFeeRate: 0 };
      const rows = await db
        .select()
        .from(systemConfig)
        .where(sql`${systemConfig.key} LIKE 'fee_rule_%'`)
        .limit(100);
      return {
        totalRules: rows.length,
        activeRules: rows.length,
        avgFeeRate: 1.5,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),
  calculate: protectedProcedure
    .input(
      z.object({
        amount: z.number(),
        transactionType: z.string(),
        channel: z.string().default("pos"),
        agentTier: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db)
          return {
            fee: Math.round(input.amount * 0.015),
            rate: 1.5,
            breakdown: [],
          };
        const rows = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.key, "fee_rule_" + input.transactionType))
          .limit(1);
        if (rows.length > 0) {
          const rule = JSON.parse(String(rows[0].value ?? "{}"));
          const rate = Number(rule.rate ?? 1.5);
          return {
            fee: Math.round((input.amount * rate) / 100),
            rate,
            breakdown: [
              {
                component: "Base fee",
                amount: Math.round((input.amount * rate) / 100),
              },
            ],
          };
        }
        const defaultRate = 1.5;
        return {
          fee: Math.round((input.amount * defaultRate) / 100),
          rate: defaultRate,
          breakdown: [
            {
              component: "Default fee",
              amount: Math.round((input.amount * defaultRate) / 100),
            },
          ],
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
  listRules: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { rules: [], total: 0 };
        const rows = await db
          .select()
          .from(systemConfig)
          .where(sql`${systemConfig.key} LIKE 'fee_rule_%'`)
          .limit(input?.limit ?? 20);
        return {
          rules: rows.map(r => ({
            id: r.key.replace("fee_rule_", ""),
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
        transactionType: z.string(),
        rate: z.number(),
        minFee: z.number().optional(),
        maxFee: z.number().optional(),
        flatFee: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db
          .insert(systemConfig)
          .values({
            key: "fee_rule_" + input.transactionType,
            value: JSON.stringify(input),
          })
          .onConflictDoUpdate({
            target: systemConfig.key,
            set: { value: JSON.stringify(input), updatedAt: new Date() },
          });
        await db.insert(auditLog).values({
          action: "fee_rule_created",
          resource: "fee_rules",
          resourceId: input.transactionType,
          status: "success",
          metadata: input,
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
});
