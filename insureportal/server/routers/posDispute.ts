/**
 * Dispute from POS — agent-initiated dispute filing directly from the POS terminal,
 * with evidence upload and real-time status tracking.
 *
 * Middleware: Kafka (dispute events), PostgreSQL (dispute records), Redis (status cache)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, writeAuditLog } from "../db";
import { disputes, transactions } from "../../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getAgentFromCookie } from "../middleware/agentAuth";

export const posDisputeRouter = router({
  fileDispute: protectedProcedure
    .input(
      z.object({
        transactionRef: z.string(),
        reason: z.enum([
          "wrong_amount",
          "failed_but_debited",
          "duplicate_charge",
          "unauthorized",
          "service_not_received",
          "other",
        ]),
        description: z.string().min(10).max(1000),
        expectedAmount: z.number().optional(),
        customerPhone: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });

        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [tx] = await db
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.ref, input.transactionRef),
              eq(transactions.agentId, session.id)
            )
          )
          .limit(1);
        if (!tx)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Transaction not found or not yours",
          });

        const [dispute] = await db
          .insert(disputes)
          .values({
            ref: `DSP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
            agentId: session.id,
            transactionId: tx.id,
            transactionRef: input.transactionRef,
            reason: input.reason,
            description: input.description,
            status: "open",
            evidence: JSON.stringify({
              expectedAmount: input.expectedAmount,
              customerPhone: input.customerPhone,
              filedFromPOS: true,
            }),
          })
          .returning();

        await writeAuditLog({
          agentId: session.id,
          agentId: session.agentId,
          action: "POS_DISPUTE_FILED",
          resource: "dispute",
          resourceId: String(dispute.id),
          status: "success",
          metadata: {
            transactionRef: input.transactionRef,
            reason: input.reason,
          },
        });

        return {
          disputeId: dispute.id,
          transactionRef: input.transactionRef,
          status: "open",
          createdAt: new Date().toISOString(),
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

  listMyDisputes: protectedProcedure
    .input(
      z.object({ limit: z.number().default(20), status: z.string().optional() })
    )
    .query(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

        const db = (await getDb())!;
        if (!db) return { disputes: [], total: 0 };

        const conditions = [eq(disputes.agentId, session.id)];
        if (input.status) conditions.push(eq(disputes.status, input.status));

        const items = await db
          .select()
          .from(disputes)
          .where(and(...conditions))
          .orderBy(desc(disputes.createdAt))
          .limit(input.limit);

        return { disputes: items, total: items.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  getDisputeStatus: protectedProcedure
    .input(z.object({ disputeId: z.number() }))
    .query(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [dispute] = await db
          .select()
          .from(disputes)
          .where(
            and(
              eq(disputes.id, input.disputeId),
              eq(disputes.agentId, session.id)
            )
          )
          .limit(1);

        if (!dispute) throw new TRPCError({ code: "NOT_FOUND" });

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
});
