import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { agentBankAccounts } from "@schema";
import { eq, desc, and, count } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const listAccounts = protectedProcedure
  .input(
    z.object({
      agentId: z.number().optional(),
      page: z.number().optional(),
      limit: z.number().optional(),
    })
  )
  .query(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const lim = input.limit ?? 10;
      const offset = ((input.page ?? 1) - 1) * lim;
      const conditions = input.agentId
        ? [eq(agentBankAccounts.agentId, input.agentId)]
        : [];
      const rows = await db
        .select()
        .from(agentBankAccounts)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(agentBankAccounts.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(agentBankAccounts)
        .where(conditions.length ? and(...conditions) : undefined)
        .limit(100);
      return { items: rows, total, page: input.page ?? 1, limit: lim };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });

const getAccount = protectedProcedure
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
      return row;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });

const addAccount = protectedProcedure
  .input(
    z.object({
      agentId: z.number(),
      bankName: z.string(),
      bankCode: z.string(),
      accountNumber: z.string(),
      accountName: z.string(),
    })
  )
  .mutation(async ({ input }) => {
    try {
      const db = (await getDb())!;
      if (!/^[0-9]{10}$/.test(input.accountNumber))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid NUBAN — must be 10 digits",
        });
      const [row] = await db
        .insert(agentBankAccounts)
        .values(input as any)
        .returning();
      return { ...row, message: "Bank account added" };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });

const removeAccount = protectedProcedure
  .input(z.object({ id: z.number() }))
  .mutation(async ({ input }) => {
    try {
      const db = (await getDb())!;
      await db
        .delete(agentBankAccounts)
        .where(eq(agentBankAccounts.id, input.id));
      return { success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });

export const bankAccountManagementRouter = router({
  listAccounts,
  getAccount,
  addAccount,
  removeAccount,
  list: protectedProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(agentBankAccounts)
          .orderBy(desc(agentBankAccounts.id))
          .limit(50);
        return { items: rows };
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
        bankName: z.string(),
        bankCode: z.string(),
        accountNumber: z.string(),
        accountName: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [row] = await db
          .insert(agentBankAccounts)
          .values(input as any)
          .returning();
        return { ...row, success: true };
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
          .delete(agentBankAccounts)
          .where(eq(agentBankAccounts.id, input.id));
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
  verify: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .update(agentBankAccounts)
          .set({ verified: true })
          .where(eq(agentBankAccounts.id, input.id));
        return { success: true, message: "Account verified" };
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
