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
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const transactionLimitsEngineRouter = router({
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { totalLimits: 0, activeLimits: 0, breachesToday: 0 };
    const rows = await db
      .select()
      .from(systemConfig)
      .where(sql`${systemConfig.key} LIKE 'tx_limit_%'`)
      .limit(100);
    return {
      totalLimits: rows.length,
      activeLimits: rows.length,
      breachesToday: 0,
    };
  }),
  listLimits: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { limits: [], total: 0 };
        const rows = await db
          .select()
          .from(systemConfig)
          .where(sql`${systemConfig.key} LIKE 'tx_limit_%'`)
          .limit(input?.limit ?? 20);
        return {
          limits: rows.map(r => ({
            id: r.key.replace("tx_limit_", ""),
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
  checkLimit: protectedProcedure
    .input(
      z.object({
        agentId: z.number(),
        amount: z.number(),
        transactionType: z.string(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { allowed: true, limit: 0, remaining: 0 };
        const rows = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.key, "tx_limit_" + input.transactionType))
          .limit(1);
        if (rows.length === 0)
          return { allowed: true, limit: 10000000, remaining: 10000000 };
        const limit = JSON.parse(String(rows[0].value ?? "{}"));
        const maxAmount = Number(limit.maxAmount ?? 10000000);
        return {
          allowed: input.amount <= maxAmount,
          limit: maxAmount,
          remaining: Math.max(0, maxAmount - input.amount),
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
  setLimit: protectedProcedure
    .input(
      z.object({
        transactionType: z.string(),
        maxAmount: z.number(),
        dailyLimit: z.number().optional(),
        monthlyLimit: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db
          .insert(systemConfig)
          .values({
            key: "tx_limit_" + input.transactionType,
            value: JSON.stringify(input),
          })
          .onConflictDoUpdate({
            target: systemConfig.key,
            set: { value: JSON.stringify(input), updatedAt: new Date() },
          });
        await db.insert(auditLog).values({
          action: "tx_limit_set",
          resource: "tx_limits",
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
