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

import { floatReconciliations, agents, auditLog } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const agentFloatInsuranceClaimsRouter = router({
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return {
        totalClaims: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        totalAmount: "0",
      };
    const [total] = await db
      .select({ value: count() })
      .from(floatReconciliations)
      .limit(100);
    return {
      totalClaims: Number(total.value),
      pending: 0,
      approved: Number(total.value),
      rejected: 0,
      totalAmount: "0",
    };
  }),
  listClaims: protectedProcedure
    .input(
      z
        .object({
          agentId: z.number().optional(),
          limit: z.number().default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { claims: [], total: 0 };
        const conditions: any[] = [];
        if (input?.agentId)
          conditions.push(eq(floatReconciliations.agentId, input.agentId));
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const rows = await db
          .select()
          .from(floatReconciliations)
          .where(where)
          .orderBy(desc(floatReconciliations.date))
          .limit(input?.limit ?? 20);
        return { claims: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  fileClaim: protectedProcedure
    .input(
      z.object({ agentId: z.number(), amount: z.string(), reason: z.string() })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const [claim] = await db
          .insert(floatReconciliations)
          .values({
            agentId: input.agentId,
            expectedBalance: input.amount,
            actualBalance: "0",
            discrepancy: input.amount,
            date: new Date(),
            status: "pending",
          })
          .returning();
        await db.insert(auditLog).values({
          action: "float_claim_filed",
          resource: "float_claims",
          resourceId: String(claim.id),
          status: "success",
          metadata: { agentId: input.agentId, amount: input.amount },
        });
        return { success: true, claim };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  approveClaim: protectedProcedure
    .input(z.object({ claimId: z.number().int().positive(), notes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");

        // I-wave (AB-8): approval was open to ANY authenticated user with no
        // role check and no segregation-of-duties. Now: admin/supervisor
        // only, and the claimant (selling agent) can never approve their own
        // claim — SoD fail-closed on unverifiable identity (same convention
        // as H-wave KYC approval).
        const role = ctx.user?.role;
        if (role !== "admin" && role !== "supervisor") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Float-claim approval requires an admin or supervisor role",
          });
        }
        const [claimRow] = await db
          .select()
          .from(floatReconciliations)
          .where(eq(floatReconciliations.id, input.claimId))
          .limit(1);
        if (!claimRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });
        }
        const [claimant] = await db
          .select({ email: agents.email })
          .from(agents)
          .where(eq(agents.id, claimRow.agentId))
          .limit(1);
        if (!claimant?.email) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Cannot approve: claimant agent has no email on file, so segregation-of-duties (self-approval) cannot be ruled out",
          });
        }
        if (
          ctx.user?.email &&
          claimant.email.toLowerCase() === ctx.user.email.toLowerCase()
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Segregation of duties: the claimant/selling agent cannot approve their own float claim",
          });
        }

        // DD-TSSTATE: expected-state guard applied atomically — only a
        // pending (or escalated) claim can transition to resolved; approving
        // an already-resolved claim fails loudly instead of fabricating a
        // second approval + duplicate audit row.
        const [updated] = await db
          .update(floatReconciliations)
          .set({
            status: "resolved",
            resolvedAt: new Date(),
            resolvedBy: Number(ctx.user?.id) || null,
            notes: input.notes ?? undefined,
          })
          .where(
            and(
              eq(floatReconciliations.id, input.claimId),
              or(
                eq(floatReconciliations.status, "pending"),
                eq(floatReconciliations.status, "escalated")
              )
            )
          )
          .returning();
        if (!updated) {
          const [existing] = await db
            .select({ status: floatReconciliations.status })
            .from(floatReconciliations)
            .where(eq(floatReconciliations.id, input.claimId))
            .limit(1);
          if (!existing) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Claim not found",
            });
          }
          throw new TRPCError({
            code: "CONFLICT",
            message: `Claim ${input.claimId} cannot be approved from status '${existing.status}'`,
          });
        }
        await db.insert(auditLog).values({
          action: "float_claim_approved",
          resource: "float_claims",
          resourceId: String(input.claimId),
          status: "success",
          metadata: {
            approverUserId: ctx.user?.id ?? null,
            approverEmail: ctx.user?.email ?? null,
            approverRole: ctx.user?.role ?? null,
            claimantAgentId: claimRow.agentId,
          },
        });
        return { success: true, claim: updated };
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
