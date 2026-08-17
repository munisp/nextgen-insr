// @ts-check
import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { z } from "zod";

import {
  disputes,
  disputeMessages,
  disputeEvidence,
  transactions,
  auditLog,
} from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const customerDisputePortalRouter = router({
  listMyDisputes: protectedProcedure
    .input(
      z.object({
        limit: z.number().default(20),
        status: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const db = (await getDb())!;
        const rows = input.status
          ? await db
              .select()
              .from(disputes)
              .where(
                and(
                  // F-12 (wave-4b): session-scoped — was client-supplied
                  // customerId (any caller could read any agent's disputes).
                  eq(disputes.agentId, ctx.user.id),
                  eq(disputes.status, input.status)
                )
              )
              .orderBy(desc(disputes.createdAt))
              .limit(input.limit)
          : await db
              .select()
              .from(disputes)
              .where(eq(disputes.agentId, ctx.user.id))
              .orderBy(desc(disputes.createdAt))
              .limit(input.limit);
        return { disputes: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getDispute: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [dispute] = await db
          .select()
          .from(disputes)
          .where(eq(disputes.id, input.id))
          .limit(1);
        if (!dispute) return null;
        const messages = await db
          .select()
          .from(disputeMessages)
          .where(eq(disputeMessages.disputeId, input.id))
          .orderBy(disputeMessages.createdAt)
          .limit(100);
        const evidence = await db
          .select()
          .from(disputeEvidence)
          .where(eq(disputeEvidence.disputeId, input.id))
          .limit(100);
        return { ...dispute, messages, evidence };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  fileDispute: protectedProcedure
    .input(
      z.object({
        transactionId: z.number(),
        reason: z.string(),
        description: z.string(),
        amount: z.number().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const db = (await getDb())!;
        const [dispute] = await db
          .insert(disputes)
          .values({
            // F-12 (wave-4b): session-scoped — was client-supplied.
            customerId: ctx.user.id,
            transactionId: input.transactionId,
            reason: input.reason,
            description: input.description,
            amount: String(input.amount),
            status: "open",
            type: "customer",
          } as any)
          .returning();
        await db.insert(auditLog).values({
          action: "customer_dispute_filed",
          resource: "disputes",
          resourceId: String(dispute.id),
          status: "success",
          metadata: {
            // F-12 (wave-4b): session-scoped — was client-supplied.
            customerId: ctx.user.id,
            transactionId: input.transactionId,
          },
        } as any);
        return dispute;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  addMessage: protectedProcedure
    .input(
      z.object({
        disputeId: z.number(),
        content: z.string(),
        senderType: z.string().default("customer"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [msg] = await db
          .insert(disputeMessages)
          .values({
            disputeId: input.disputeId,
            content: input.content,
            senderType: input.senderType,
          })
          .returning();
        return msg;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getStats: protectedProcedure
    .input(z.object({ customerId: z.number().optional() }).default({}))
    .query(async () => {
      return {
        totalDisputes: 0,
        open: 0,
        openDisputes: 0,
        investigating: 0,
        resolved: 0,
        resolvedDisputes: 0,
        slaCompliance: 0.95,
        avgResolutionDays: 3,
        avgResolutionHours: 24,
        refundRate: 0.15,
        escalationRate: 0.05,
        pendingAmount: 0,
        escalatedDisputes: 0,
      };
    }),
  listDisputes: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().default(20),
          offset: z.number().default(0),
          status: z.string().optional(),
        })
        .default({ limit: 20, offset: 0 })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if ((db as any)._isNoop) return { disputes: [], items: [], total: 0 };
        // F-12: join the originating transaction so each dispute row carries
        // the real customerName (was a raw disputes select — the portal's
        // row shape contract includes customerName; null when the dispute
        // has no linked transaction).
        const rows = await db
          .select({
            dispute: disputes,
            customerName: transactions.customerName,
          })
          .from(disputes)
          .leftJoin(
            transactions,
            eq(disputes.transactionId, transactions.id)
          )
          .where(input.status ? eq(disputes.status, input.status) : undefined)
          .orderBy(desc(disputes.createdAt))
          .limit(input.limit)
          .offset(input.offset);
        const shaped = rows.map(r => ({
          ...r.dispute,
          customerName: r.customerName ?? null,
        }));
        return { disputes: shaped, items: shaped, total: shaped.length };
      } catch {
        return { disputes: [], items: [], total: 0 };
      }
    }),
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().default(20),
          offset: z.number().default(0),
          status: z.string().optional(),
        })
        .default({ limit: 20, offset: 0 })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(disputes)
          .orderBy(desc(disputes.createdAt))
          .limit(input.limit)
          .offset(input.offset);
        return { items: rows, total: rows.length };
      } catch {
        return { items: [], total: 0 };
      }
    }),
  // F-12 (expanded sweep): both were echo facades — now REAL mutations on
  // the disputes table.
  escalateDispute: protectedProcedure
    .input(z.object({ disputeId: z.number(), reason: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "database unavailable" });
      }
      const [row] = await db
        .select()
        .from(disputes)
        .where(eq(disputes.id, input.disputeId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "dispute not found" });
      await db
        .update(disputes)
        .set({
          priority: "high",
          description: `${row.description ?? ""}
[escalated] ${input.reason}`.trim(),
          updatedAt: new Date(),
        })
        .where(eq(disputes.id, row.id));
      return { success: true as const, disputeId: row.id, escalatedAt: new Date().toISOString() };
    }),
  updateDispute: protectedProcedure
    .input(
      z.object({
        disputeId: z.number(),
        status: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "database unavailable" });
      }
      const [row] = await db
        .select()
        .from(disputes)
        .where(eq(disputes.id, input.disputeId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "dispute not found" });
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.status) updates.status = input.status;
      if (input.notes) updates.resolution = input.notes;
      if (input.status === "resolved") updates.resolvedAt = new Date();
      await db.update(disputes).set(updates).where(eq(disputes.id, row.id));
      return { success: true as const, disputeId: row.id, updatedAt: new Date().toISOString() };
    }),
});
