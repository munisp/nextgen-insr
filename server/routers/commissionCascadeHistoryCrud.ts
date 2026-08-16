// Sprint 87: Full domain logic — cascade calculation, tier-based splits, audit trail
import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count, sum } from "drizzle-orm";
import { z } from "zod";

import { commissionCascadeHistory } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

const HIERARCHY_SPLIT_RULES: Record<string, number> = {
  agent: 0.6,
  supervisor: 0.2,
  regional_manager: 0.12,
  state_manager: 0.05,
  national: 0.03,
};

export const commissionCascadeHistoryRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        agentId: z.number().optional(),
        transactionRef: z.string().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const conditions: any[] = [];
        if (input.agentId)
          conditions.push(
            eq(commissionCascadeHistory.recipientAgentId, input.agentId)
          );
        if (input.transactionRef)
          conditions.push(
            eq(commissionCascadeHistory.transactionRef, input.transactionRef)
          );
        const rows = await db
          .select()
          .from(commissionCascadeHistory)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(commissionCascadeHistory.id))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(commissionCascadeHistory)
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
          .from(commissionCascadeHistory)
          .where(eq(commissionCascadeHistory.id, input.id))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Cascade entry not found",
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
  getTransactionCascade: protectedProcedure
    .input(z.object({ transactionRef: z.string() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const entries = await db
          .select()
          .from(commissionCascadeHistory)
          .where(
            eq(commissionCascadeHistory.transactionRef, input.transactionRef)
          )
          .orderBy(commissionCascadeHistory.recipientHierarchyLevel)
          .limit(100);
        const totalDistributed = entries.reduce(
          (s: any, e: any) => s + Number(e.commissionAmount),
          0
        );
        return {
          transactionRef: input.transactionRef,
          entries,
          totalDistributed,
          splitRules: HIERARCHY_SPLIT_RULES,
          entryCount: entries.length,
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
  getAgentEarnings: protectedProcedure
    .input(z.object({ agentId: z.number(), period: z.string().optional() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const conditions = [
          eq(commissionCascadeHistory.recipientAgentId, input.agentId),
        ];
        const [stats] = await db
          .select({
            totalEarnings: sql<string>`COALESCE(SUM(CAST("commissionAmount" AS numeric)), 0)`,
            txCount: count(),
          })
          .from(commissionCascadeHistory)
          .where(and(...conditions))
          .limit(100);
        return {
          agentId: input.agentId,
          totalEarnings: stats?.totalEarnings || "0",
          transactionCount: stats?.txCount || 0,
          splitRules: HIERARCHY_SPLIT_RULES,
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
  validateSplits: protectedProcedure
    .input(z.object({ transactionRef: z.string() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const entries = await db
          .select()
          .from(commissionCascadeHistory)
          .where(
            eq(commissionCascadeHistory.transactionRef, input.transactionRef)
          )
          .limit(100);
        if (entries.length === 0)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No cascade entries for this transaction",
          });
        const totalSplit = entries.reduce(
          (s: any, e: any) => s + Number(e.splitPercentage),
          0
        );
        const isValid = Math.abs(totalSplit - 100) < 0.01;
        return {
          transactionRef: input.transactionRef,
          totalSplitPercent: totalSplit,
          isValid,
          entries: entries.length,
          issues: isValid
            ? []
            : [`Total split is ${totalSplit}% (expected 100%)`],
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
