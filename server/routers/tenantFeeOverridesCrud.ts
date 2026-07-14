// Premium fee schedule management — insurance product fee configuration
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { premiumFeeSchedules } from "../../drizzle/schema";
import { eq, desc, and, count } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const PRODUCT_TYPES = [
  "motor",
  "health",
  "life",
  "property",
  "travel",
  "marine",
  "liability",
  "group_life",
  "microinsurance",
];
const MAX_FEE_PERCENT = 10; // 10% max fee

export const tenantFeeOverridesRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        tenantId: z.number().optional(),
        productType: z.string().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const conditions: any[] = [];
        if (input.tenantId)
          conditions.push(eq(premiumFeeSchedules.tenantId, input.tenantId));
        if (input.productType)
          conditions.push(eq(premiumFeeSchedules.productType, input.productType));
        const rows = await db
          .select()
          .from(premiumFeeSchedules)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(premiumFeeSchedules.id))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(premiumFeeSchedules)
          .where(conditions.length ? and(...conditions) : undefined)
          .limit(100);
        return { items: rows, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [row] = await db
          .select()
          .from(premiumFeeSchedules)
          .where(eq(premiumFeeSchedules.id, input.id))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Fee schedule not found",
          });
        return row;
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
        productType: z.string(),
        feeType: z.enum(["percentage", "flat"]).default("percentage"),
        feeValue: z.string(),
        minFee: z.string().optional(),
        maxFee: z.string().optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!PRODUCT_TYPES.includes(input.productType))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid product type. Must be one of: ${PRODUCT_TYPES.join(", ")}`,
          });
        const feeVal = parseFloat(input.feeValue);
        if (input.feeType === "percentage" && feeVal > MAX_FEE_PERCENT)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Fee percentage cannot exceed ${MAX_FEE_PERCENT}%`,
          });
        if (
          input.minFee &&
          input.maxFee &&
          parseFloat(input.minFee) > parseFloat(input.maxFee)
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Minimum fee cannot exceed maximum fee",
          });
        const [existing] = await db
          .select()
          .from(premiumFeeSchedules)
          .where(
            and(
              eq(premiumFeeSchedules.tenantId, input.tenantId),
              eq(premiumFeeSchedules.productType, input.productType),
              eq(premiumFeeSchedules.isActive, true)
            )
          )
          .limit(100);
        if (existing)
          throw new TRPCError({
            code: "CONFLICT",
            message: `Active fee schedule already exists for ${input.productType}. Deactivate it first.`,
          });
        const [row] = await db
          .insert(premiumFeeSchedules)
          .values(input as any)
          .returning();
        return { ...row, message: "Fee schedule created" };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  calculateFee: protectedProcedure
    .input(
      z.object({ tenantId: z.number(), productType: z.string(), amount: z.number() })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [schedule] = await db
          .select()
          .from(premiumFeeSchedules)
          .where(
            and(
              eq(premiumFeeSchedules.tenantId, input.tenantId),
              eq(premiumFeeSchedules.productType, input.productType),
              eq(premiumFeeSchedules.isActive, true)
            )
          )
          .limit(100);
        if (!schedule)
          return {
            amount: input.amount,
            fee: 0,
            feeSource: "no_schedule",
            total: input.amount,
          };
        let fee =
          schedule.feeType === "percentage"
            ? (input.amount * Number(schedule.feeValue)) / 100
            : Number(schedule.feeValue);
        fee = Math.max(fee, Number(schedule.minFee));
        fee = Math.min(fee, Number(schedule.maxFee));
        return {
          amount: input.amount,
          fee: Math.round(fee * 100) / 100,
          feeSource: "premium_schedule",
          feeType: schedule.feeType,
          total: input.amount + Math.round(fee * 100) / 100,
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
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .delete(premiumFeeSchedules)
          .where(eq(premiumFeeSchedules.id, input.id));
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
