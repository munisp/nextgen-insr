/**
 * F05: Dynamic Fee Engine
 * Fee rules, tiered pricing, volume discounts, fee audit trail, fee simulation
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, and, gte, count, sql } from "drizzle-orm";
import { z } from "zod";

import { feeRules, feeAuditTrail } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const dynamicFeeEngineRouter = router({
  // List fee rules
  listRules: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        txType: z.string().optional(),
        channel: z.string().optional(),
        active: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { items: [], total: 0 };
        const conditions = [];
        if (input.txType) conditions.push(eq(feeRules.txType, input.txType));
        if ((input as any).channel)
          conditions.push(eq((feeRules as any).channel, input.channel));
        // @ts-expect-error auto-fix
        if (input.isActive !== undefined)
          conditions.push(eq(feeRules.isActive, input.active as any));
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const items = await db
          .select()
          .from(feeRules)
          .where(where)
          .orderBy(desc(feeRules.createdAt))
          .limit(input.limit)
          .offset((input.page - 1) * input.limit);
        const [{ total }] = await db
          .select({ total: count() })
          .from(feeRules)
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

  // Create fee rule
  createRule: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        txType: z.string(),
        channel: z.string(),
        feeType: z.enum(["flat", "percentage", "tiered", "capped_percentage"]),
        flatAmount: z.number().optional(),
        percentageRate: z.number().optional(),
        minFee: z.number().optional(),
        maxFee: z.number().optional(),
        tiers: z
          .array(
            z.object({
              minAmount: z.number(),
              maxAmount: z.number(),
              fee: z.number(),
              feeType: z.enum(["flat", "percentage"]),
            })
          )
          .optional(),
        effectiveFrom: z.string(),
        effectiveTo: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        const [rule] = await db
          .insert(feeRules)
          .values({
            name: input.name,
            txType: input.txType,
            channel: input.channel,
            feeType: input.feeType,
            flatAmount: input.flatAmount ? String(input.flatAmount) : null,
            percentageRate: input.percentageRate
              ? String(input.percentageRate)
              : null,
            minFee: input.minFee ? String(input.minFee) : null,
            maxFee: input.maxFee ? String(input.maxFee) : null,
            tiers: input.tiers ? JSON.stringify(input.tiers) : null,
            effectiveFrom: new Date(input.effectiveFrom),
            effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
            active: true,
            createdBy: ctx.user?.id,
          } as any)
          .returning();
        // Audit trail
        await db.insert(feeAuditTrail).values({
          feeRuleId: rule.id,
          action: "created",
          changedBy: ctx.user?.id,
          newValues: JSON.stringify(input),
        } as any);
        return { rule };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Update fee rule
  updateRule: protectedProcedure
    .input(
      z.object({
        ruleId: z.number(),
        name: z.string().optional(),
        flatAmount: z.number().optional(),
        percentageRate: z.number().optional(),
        minFee: z.number().optional(),
        maxFee: z.number().optional(),
        active: z.boolean().optional(),
      } as any)
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        const [oldRule] = await db
          .select()
          .from(feeRules)
          .where(eq(feeRules.id, input.ruleId as any))
          .limit(100);
        const updates: any = { updatedAt: new Date() };
        if (input.name !== undefined) updates.name = input.name;
        if (input.flatAmount !== undefined)
          updates.flatAmount = String(input.flatAmount);
        if (input.percentageRate !== undefined)
          updates.percentageRate = String(input.percentageRate);
        if (input.minFee !== undefined) updates.minFee = String(input.minFee);
        if (input.maxFee !== undefined) updates.maxFee = String(input.maxFee);
        if (input.active !== undefined) updates.active = input.active;
        await db
          .update(feeRules)
          .set(updates)
          .where(eq(feeRules.id, input.ruleId as any));
        await db.insert(feeAuditTrail).values({
          feeRuleId: input.ruleId,
          action: "updated",
          changedBy: ctx.user?.id,
          previousValues: JSON.stringify(oldRule),
          newValues: JSON.stringify(updates),
        } as any);
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

  // Calculate fee for a transaction
  calculateFee: protectedProcedure
    .input(
      z.object({
        txType: z.string(),
        channel: z.string(),
        amount: z.number(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { fee: 0, breakdown: {} };
        const now = new Date();
        const [rule] = await db
          .select()
          .from(feeRules)
          .where(
            and(
              eq(feeRules.txType, input.txType),
              eq((feeRules as any).channel, input.channel),
              eq(feeRules.isActive, true)
            )
          )
          .limit(1);
        if (!rule)
          return { fee: 0, breakdown: { message: "No matching fee rule" } };
        let fee = 0;
        const breakdown: any = {
          ruleId: rule.id,
          ruleName: rule.name,
          feeType: rule.feeType,
        };
        switch (rule.feeType) {
          case "flat":
            fee = parseFloat(String((rule as any).flatAmount || "0"));
            break;
          case "percentage":
            fee =
              (input.amount *
                parseFloat(String((rule as any).percentageRate || "0"))) /
              100;
            break;
          case "capped_percentage":
            fee =
              (input.amount *
                parseFloat(String((rule as any).percentageRate || "0"))) /
              100;
            const minFee = parseFloat(String(rule.minFee || "0"));
            const maxFee = parseFloat(String(rule.maxFee || "999999999"));
            fee = Math.max(minFee, Math.min(fee, maxFee));
            breakdown.capped = true;
            break;
          case "tiered":
            if ((rule as any).tiers) {
              const tiers = JSON.parse(String((rule as any).tiers));
              for (const tier of tiers) {
                if (
                  input.amount >= tier.minAmount &&
                  input.amount <= tier.maxAmount
                ) {
                  fee =
                    tier.feeType === "flat"
                      ? tier.fee
                      : (input.amount * tier.fee) / 100;
                  breakdown.matchedTier = tier;
                  break;
                }
              }
            }
            break;
        }
        breakdown.calculatedFee = fee;
        return { fee: Math.round(fee * 100) / 100, breakdown };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Fee audit trail
  auditTrail: protectedProcedure
    .input(
      z.object({
        ruleId: z.number().optional(),
        page: z.number().default(1),
        limit: z.number().default(20),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { items: [], total: 0 };
        const conditions = [];
        if (input.ruleId)
          conditions.push(eq(feeAuditTrail.feeRuleId, input.ruleId));
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const items = await db
          .select()
          .from(feeAuditTrail)
          .where(where)
          .orderBy(desc(feeAuditTrail.createdAt))
          .limit(input.limit)
          .offset((input.page - 1) * input.limit);
        const [{ total }] = await db
          .select({ total: count() })
          .from(feeAuditTrail)
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

  // Fee simulation — test fee rules against sample amounts
  simulate: protectedProcedure
    .input(
      z.object({
        txType: z.string(),
        channel: z.string(),
        amounts: z.array(z.number()),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { results: [] };
        const [rule] = await db
          .select()
          .from(feeRules)
          .where(
            and(
              eq(feeRules.txType, input.txType),
              eq((feeRules as any).channel, input.channel),
              eq(feeRules.isActive, true)
            )
          )
          .limit(1);
        if (!rule)
          return {
            results: input.amounts.map(a => ({
              amount: a,
              fee: 0,
              noRule: true,
            })),
          };
        const results = input.amounts.map(amount => {
          let fee = 0;
          switch (rule.feeType) {
            case "flat":
              fee = parseFloat(String((rule as any).flatAmount || "0"));
              break;
            case "percentage":
              fee =
                (amount *
                  parseFloat(String((rule as any).percentageRate || "0"))) /
                100;
              break;
            case "capped_percentage":
              fee =
                (amount *
                  parseFloat(String((rule as any).percentageRate || "0"))) /
                100;
              fee = Math.max(
                parseFloat(String(rule.minFee || "0")),
                Math.min(fee, parseFloat(String(rule.maxFee || "999999999")))
              );
              break;
            case "tiered":
              if ((rule as any).tiers) {
                const tiers = JSON.parse(String((rule as any).tiers));
                for (const tier of tiers) {
                  if (amount >= tier.minAmount && amount <= tier.maxAmount) {
                    fee =
                      tier.feeType === "flat"
                        ? tier.fee
                        : (amount * tier.fee) / 100;
                    break;
                  }
                }
              }
              break;
          }
          return { amount, fee: Math.round(fee * 100) / 100 };
        });
        return {
          results,
          rule: { id: rule.id, name: rule.name, feeType: rule.feeType },
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
});
