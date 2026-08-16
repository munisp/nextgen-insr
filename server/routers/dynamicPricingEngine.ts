import { TRPCError } from "@trpc/server";
import { eq, desc, sql, count } from "drizzle-orm";
import { z } from "zod";

import { feeRules, feeAuditTrail, auditLog } from "../../drizzle/schema";
import { permifyCheck } from "../_core/permify";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


// ── Middleware Integration (Sprint 44) ──────────────────────────────
import { fluvioProduce } from "../fluvio";
import { publishEvent, type KafkaTopic } from "../kafkaClient";
import { cacheSet, cacheGet } from "../redisClient";
import { tbCreateTransfer } from "../tbClient";

export const dynamicPricingEngineRouter = router({
  listRules: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(feeRules)
          .orderBy(desc(feeRules.createdAt))
          .limit(input?.limit ?? 50);
        return { rules: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getRule: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [rule] = await db
          .select()
          .from(feeRules)
          .where(eq(feeRules.id, input.id))
          .limit(1);
        return rule ?? null;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  calculatePrice: protectedProcedure
    .input(
      z.object({
        amount: z.number().positive(),
        type: z.string(),
        channel: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rules = await db
          .select()
          .from(feeRules)
          .where(eq(feeRules.txType, input.type))
          .limit(5);
        const applicableRule = rules[0];
        const fee = applicableRule
          ? applicableRule.feeType === "percentage"
            ? (input.amount * Number(applicableRule.feeValue)) / 100
            : Number(applicableRule.feeValue)
          : 0;
        return {
          originalAmount: input.amount,
          fee: Math.round(fee * 100) / 100,
          totalAmount: input.amount + fee,
          ruleApplied: applicableRule?.id ?? null,
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
        feeType: z.enum(["percentage", "flat"]),
        feeValue: z.number(),
        minAmount: z.number().optional(),
        maxAmount: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [rule] = await db
          .insert(feeRules)
          .values({
            transactionType: input.transactionType,
            feeType: input.feeType,
            feeValue: String(input.feeValue),
            minAmount: input.minAmount ? String(input.minAmount) : null,
            maxAmount: input.maxAmount ? String(input.maxAmount) : null,
          } as any)
          .returning();
        await db.insert(auditLog).values({
          action: "pricing_rule_created",
          resource: "fee_rules",
          resourceId: String(rule.id),
          status: "success",
          metadata: { transactionType: input.transactionType },
        } as any);
        return rule;
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
    try {
      const db = (await getDb())!;
      const [total] = await db
        .select({ value: count() })
        .from(feeRules)
        .limit(100);
      const [totalAudit] = await db
        .select({ value: count() })
        .from(feeAuditTrail)
        .limit(100);
      return {
        totalRules: Number(total.value),
        totalFeeCalculations: Number(totalAudit.value),
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),
});
