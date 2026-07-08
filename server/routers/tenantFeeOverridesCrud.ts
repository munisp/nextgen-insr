// @ts-check

// Sprint 87: Fee schedule validation, effective date logic, approval workflow
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { tenantFeeOverrides } from "../../drizzle/schema";
import { eq, desc, and, count } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const TX_TYPES = [
  "transfer",
  "cash_in",
  "cash_out",
  "airtime",
  "bills",
  "card_payment",
  "qr_payment",
];
const MAX_FEE_PERCENT = 10; // 10% max fee

export const tenantFeeOverridesRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        tenantId: z.number().optional(),
        txType: z.string().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const conditions: any[] = [];
        if (input.tenantId)
          conditions.push(eq(tenantFeeOverrides.tenantId, input.tenantId));
        if (input.txType)
          conditions.push(eq(tenantFeeOverrides.txType, input.txType));
        const rows = await db
          .select()
          .from(tenantFeeOverrides)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(tenantFeeOverrides.id))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(tenantFeeOverrides)
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
          .from(tenantFeeOverrides)
          .where(eq(tenantFeeOverrides.id, input.id))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Fee override not found",
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
        txType: z.string(),
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
        if (!TX_TYPES.includes(input.txType))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid tx type. Must be one of: ${TX_TYPES.join(", ")}`,
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
        // Check for duplicate override
        const [existing] = await db
          .select()
          .from(tenantFeeOverrides)
          .where(
            and(
              eq(tenantFeeOverrides.tenantId, input.tenantId),
              eq(tenantFeeOverrides.txType, input.txType),
              eq(tenantFeeOverrides.isActive, true)
            )
          )
          .limit(100);
        if (existing)
          throw new TRPCError({
            code: "CONFLICT",
            message: `Active fee override already exists for ${input.txType}. Deactivate it first.`,
          });
        const [row] = await db
          .insert(tenantFeeOverrides)
          .values(input as any)
          .returning();
        return { ...row, message: "Fee override created" };
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
      z.object({ tenantId: z.number(), txType: z.string(), amount: z.number() })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [override] = await db
          .select()
          .from(tenantFeeOverrides)
          .where(
            and(
              eq(tenantFeeOverrides.tenantId, input.tenantId),
              eq(tenantFeeOverrides.txType, input.txType),
              eq(tenantFeeOverrides.isActive, true)
            )
          )
          .limit(100);
        if (!override)
          return {
            amount: input.amount,
            fee: 0,
            feeSource: "no_override",
            total: input.amount,
          };
        let fee =
          override.feeType === "percentage"
            ? (input.amount * Number(override.feeValue)) / 100
            : Number(override.feeValue);
        fee = Math.max(fee, Number(override.minFee));
        fee = Math.min(fee, Number(override.maxFee));
        return {
          amount: input.amount,
          fee: Math.round(fee * 100) / 100,
          feeSource: "tenant_override",
          feeType: override.feeType,
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
          .delete(tenantFeeOverrides)
          .where(eq(tenantFeeOverrides.id, input.id));
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
