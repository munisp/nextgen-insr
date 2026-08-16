// @ts-check
// Sprint 87: Chart of accounts hierarchy, balance validation
import { TRPCError } from "@trpc/server";
import { eq, desc, and, count, sql } from "drizzle-orm";
import { z } from "zod";

import { gl_accounts } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"];
const NORMAL_BALANCE: Record<string, string> = {
  asset: "debit",
  liability: "credit",
  equity: "credit",
  revenue: "credit",
  expense: "debit",
};

export const gl_accountsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        accountType: z.string().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const conditions = input.accountType
          ? [eq(gl_accounts.accountType, input.accountType)]
          : [];
        const rows = await db
          .select()
          .from(gl_accounts)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(gl_accounts.accountCode)
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(gl_accounts)
          .where(conditions.length ? and(...conditions) : undefined)
          .limit(100);
        return {
          items: rows.map((r: any) => ({
            ...r,
            normalBalance: NORMAL_BALANCE[r.accountType] || "debit",
          })),
          total,
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
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [row] = await db
          .select()
          .from(gl_accounts)
          .where(eq(gl_accounts.id, input.id))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "GL account not found",
          });
        return {
          ...row,
          normalBalance: NORMAL_BALANCE[row.accountType] || "debit",
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
  create: protectedProcedure
    .input(
      z.object({
        accountCode: z.string().min(4),
        accountName: z.string().min(3),
        accountType: z.enum([
          "asset",
          "liability",
          "equity",
          "revenue",
          "expense",
        ]),
        parentId: z.number().optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [existing] = await db
          .select()
          .from(gl_accounts)
          .where(eq(gl_accounts.accountCode, input.accountCode))
          .limit(100);
        if (existing)
          throw new TRPCError({
            code: "CONFLICT",
            message: `Account code ${input.accountCode} already exists`,
          });
        const [row] = await db
          .insert(gl_accounts)
          .values(input as any)
          .returning();
        return { ...row, normalBalance: NORMAL_BALANCE[input.accountType] };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getTrialBalance: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const accounts = await db.select().from(gl_accounts).limit(100);
    const totalDebits = accounts
      .filter((a: any) => ["asset", "expense"].includes(a.accountType))
      .reduce((s, a: any) => s + Number(a.balance || 0), 0);
    const totalCredits = accounts
      .filter((a: any) =>
        ["liability", "equity", "revenue"].includes(a.accountType)
      )
      .reduce((s, a: any) => s + Number(a.balance || 0), 0);
    return {
      totalDebits: totalDebits.toFixed(2),
      totalCredits: totalCredits.toFixed(2),
      isBalanced: Math.abs(totalDebits - totalCredits) < 0.01,
      difference: Math.abs(totalDebits - totalCredits).toFixed(2),
      accountCount: accounts.length,
    };
  }),
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db.delete(gl_accounts).where(eq(gl_accounts.id, input.id));
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
