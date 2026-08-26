import { TRPCError } from "@trpc/server";
import { eq, desc, and, count } from "drizzle-orm";
import { z } from "zod";

import { agentBankAccounts } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { resolveAgentScope } from "../middleware/agentAuth";

const listAccounts = protectedProcedure
  .input(
    z.object({
      agentId: z.number().optional(),
      page: z.number().optional(),
      limit: z.number().optional(),
    })
  )
  .query(async ({ input, ctx }) => {
    try {
      const db = (await getDb())!;
      const lim = input.limit ?? 10;
      const offset = ((input.page ?? 1) - 1) * lim;
      // F7-1: session-scoped — non-admin callers see only their own accounts.
      const scope = await resolveAgentScope(
        ctx.req,
        ctx.user.role,
        input.agentId ?? null
      );
      if (!scope.ok && ctx.user.role !== "admin") {
        throw new TRPCError({ code: scope.code, message: scope.message });
      }
      const conditions =
        ctx.user.role === "admin" && !scope.ok
          ? []
          : [
              eq(
                agentBankAccounts.agentId,
                scope.ok ? scope.agentId : (input.agentId ?? -1)
              ),
            ];
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
      // Legacy hint only — ownership is session-resolved (F7-1).
      agentId: z.number().optional(),
      bankName: z.string(),
      bankCode: z.string(),
      accountNumber: z.string(),
      accountName: z.string(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    try {
      const scope = await resolveAgentScope(
        ctx.req,
        ctx.user.role,
        input.agentId
      );
      if (!scope.ok) {
        throw new TRPCError({ code: scope.code, message: scope.message });
      }
      const db = (await getDb())!;
      if (!/^[0-9]{10}$/.test(input.accountNumber))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid NUBAN — must be 10 digits",
        });
      const [row] = await db
        .insert(agentBankAccounts)
        .values({
          agentId: scope.agentId,
          bankName: input.bankName,
          bankCode: input.bankCode,
          accountNumber: input.accountNumber,
          accountName: input.accountName,
        })
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
  .mutation(async ({ input, ctx }) => {
    try {
      const db = (await getDb())!;
      // F7-1: verify ownership against the session before deleting.
      const [account] = await db
        .select()
        .from(agentBankAccounts)
        .where(eq(agentBankAccounts.id, input.id))
        .limit(1);
      if (!account)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bank account not found",
        });
      const scope = await resolveAgentScope(
        ctx.req,
        ctx.user.role,
        account.agentId
      );
      if (!scope.ok || scope.agentId !== account.agentId)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Account does not belong to this agent",
        });
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
        // F7-1: the unfiltered dump is admin-only; everyone else is pinned
        // to their own agent record via the session.
        const scope = await resolveAgentScope(ctx.req, ctx.user.role, null);
        if (!scope.ok && ctx.user.role !== "admin") {
          throw new TRPCError({ code: scope.code, message: scope.message });
        }
        const rows = await db
          .select()
          .from(agentBankAccounts)
          .where(
            scope.ok
              ? eq(agentBankAccounts.agentId, scope.agentId)
              : undefined
          )
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
        // Legacy hint only — ownership is session-resolved (F7-1).
        agentId: z.number().optional(),
        bankName: z.string(),
        bankCode: z.string(),
        accountNumber: z.string(),
        accountName: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const scope = await resolveAgentScope(
          ctx.req,
          ctx.user.role,
          input.agentId
        );
        if (!scope.ok) {
          throw new TRPCError({ code: scope.code, message: scope.message });
        }
        const db = (await getDb())!;
        const [row] = await db
          .insert(agentBankAccounts)
          .values({
            agentId: scope.agentId,
            bankName: input.bankName,
            bankCode: input.bankCode,
            accountNumber: input.accountNumber,
            accountName: input.accountName,
          })
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
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        const [account] = await db
          .select()
          .from(agentBankAccounts)
          .where(eq(agentBankAccounts.id, input.id))
          .limit(1);
        if (!account)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Bank account not found",
          });
        // F7-1: ownership from session, not caller input.
        const scope = await resolveAgentScope(
          ctx.req,
          ctx.user.role,
          account.agentId
        );
        if (!scope.ok || scope.agentId !== account.agentId)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Account does not belong to this agent",
          });
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
    .mutation(async ({ input, ctx }) => {
      try {
        // Account verification marks a payout destination as trusted — staff only.
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can verify bank accounts",
          });
        }
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
