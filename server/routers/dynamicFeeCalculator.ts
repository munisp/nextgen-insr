// @ts-check
import { TRPCError } from "@trpc/server";
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
import { z } from "zod";

import { systemConfig, auditLog } from "../../drizzle/schema";
import { permifyCheck } from "../_core/permify";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
// ── Middleware Integration (Sprint 44) ──────────────────────────────
import { fluvioProduce } from "../fluvio";
import { publishEvent, type KafkaTopic } from "../kafkaClient";
import { cacheSet, cacheGet } from "../redisClient";
import { tbCreateTransfer } from "../tbClient";

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
      // F-12 (wave-4b): avgFeeRate was a fabricated 1.5 — derive it from
      // the real fee_rule_* rows (null when no rule carries a rate).
      const rates = rows
        .map(r => {
          try {
            const rule = JSON.parse(String(r.value ?? "{}"));
            return typeof rule.rate === "number" ? Number(rule.rate) : null;
          } catch {
            return null;
          }
        })
        .filter((x): x is number => x != null);
      return {
        totalRules: rows.length,
        activeRules: rows.length,
        avgFeeRate:
          rates.length > 0
            ? rates.reduce((a, b) => a + b, 0) / rates.length
            : null,
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
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Database unavailable",
          });
        const rows = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.key, "fee_rule_" + input.transactionType))
          .limit(1);
        if (rows.length > 0) {
          const rule = JSON.parse(String(rows[0].value ?? "{}"));
          // F-12 (wave-4b): a stored rule without a rate is config
          // corruption — never silently substitute a fabricated 1.5%.
          if (typeof rule.rate !== "number") {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `fee_rule_${input.transactionType} is misconfigured (no rate)`,
            });
          }
          const rate = Number(rule.rate);
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
        // F-12 (wave-4b): no fee rule configured — never quote a
        // fabricated 1.5% default. Fail loud.
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No fee rule configured for transaction type "${input.transactionType}"`,
        });
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
