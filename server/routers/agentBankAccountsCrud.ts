// @ts-check
// Sprint 87: Full domain logic — account verification, duplicate detection, primary account management
import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { z } from "zod";

import { agentBankAccounts } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

const NIGERIAN_BANKS = [
  "044",
  "050",
  "011",
  "058",
  "033",
  "215",
  "232",
  "035",
  "057",
  "082",
  "301",
  "221",
  "068",
  "070",
  "076",
];
const NUBAN_REGEX = /^[0-9]{10}$/;

function validateNUBAN(accountNumber: string): boolean {
  return NUBAN_REGEX.test(accountNumber);
}

function maskAccountNumber(num: string): string {
  return num.slice(0, 3) + "****" + num.slice(-3);
}

export const agentBankAccountsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        agentId: z.number().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        const conditions = input.agentId
          ? [eq(agentBankAccounts.agentId, input.agentId)]
          : [];
        const rows = await db
          .select()
          .from(agentBankAccounts)
          .where(and(...conditions))
          .orderBy(desc(agentBankAccounts.id))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(agentBankAccounts)
          .where(and(...conditions))
          .limit(100);
        return {
          items: rows.map(r => ({
            ...r,
            maskedAccount: maskAccountNumber(r.accountNumber),
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
          .from(agentBankAccounts)
          .where(eq(agentBankAccounts.id, input.id))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Bank account not found",
          });
        return { ...row, maskedAccount: maskAccountNumber(row.accountNumber) };
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
        agentId: z.number(),
        bankName: z.string().min(2),
        bankCode: z.string().min(3),
        accountNumber: z.string(),
        accountName: z.string().min(2),
        isDefault: z.boolean().default(false),
      })
    )
    .mutation(async ({ input }) => {
      try {
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
      const db = (await getDb())!;
      // NUBAN validation
      if (!validateNUBAN(input.accountNumber))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid NUBAN account number — must be exactly 10 digits",
        });
      // Bank code validation
      if (!NIGERIAN_BANKS.includes(input.bankCode))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown bank code: ${input.bankCode}. Use CBN-registered bank codes.`,
        });
      // Duplicate detection
      const [existing] = await db
        .select()
        .from(agentBankAccounts)
        .where(
          and(
            eq(agentBankAccounts.agentId, input.agentId),
            eq(agentBankAccounts.accountNumber, input.accountNumber),
            eq(agentBankAccounts.bankCode, input.bankCode)
          )
        )
        .limit(100);
      if (existing)
        throw new TRPCError({
          code: "CONFLICT",
          message: "This bank account is already registered for this agent",
        });
      // Max 5 accounts per agent
      const [{ total }] = await db
        .select({ total: count() })
        .from(agentBankAccounts)
        .where(eq(agentBankAccounts.agentId, input.agentId))
        .limit(100);
      if (total >= 5)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Maximum 5 bank accounts per agent. Remove one before adding a new one.",
        });
      // If setting as primary, unset existing primary
      if (input.isDefault) {
        await db
          .update(agentBankAccounts)
          .set({ isDefault: false })
          .where(eq(agentBankAccounts.agentId, input.agentId));
      }
      const [row] = await db
        .insert(agentBankAccounts)
        .values(input as any)
        .returning();
      return { ...row, maskedAccount: maskAccountNumber(row.accountNumber) };
    }),
  setPrimary: protectedProcedure
    .input(z.object({ id: z.number(), agentId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [account] = await db
          .select()
          .from(agentBankAccounts)
          .where(eq(agentBankAccounts.id, input.id))
          .limit(100);
        if (!account)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Bank account not found",
          });
        if (account.agentId !== input.agentId)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Account does not belong to this agent",
          });
        await db
          .update(agentBankAccounts)
          .set({ isDefault: false })
          .where(eq(agentBankAccounts.agentId, input.agentId));
        await db
          .update(agentBankAccounts)
          .set({ isDefault: true })
          .where(eq(agentBankAccounts.id, input.id));
        return { success: true, message: "Primary account updated" };
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
        const [account] = await db
          .select()
          .from(agentBankAccounts)
          .where(eq(agentBankAccounts.id, input.id))
          .limit(100);
        if (!account)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Bank account not found",
          });
        await db
          .delete(agentBankAccounts)
          .where(eq(agentBankAccounts.id, input.id));
        return { success: true, deleted: input.id };
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
