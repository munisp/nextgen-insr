/**
 * Split Payments — divide a transaction amount across multiple payment methods
 * or multiple recipients (e.g., cash + card, or split bill among friends).
 *
 * Middleware: Kafka (split events), PostgreSQL (split records), TigerBeetle (ledger)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, writeAuditLog } from "../db";
import { transactions, agents } from "@schema";
import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getAgentFromCookie } from "../middleware/agentAuth";

const splitItemSchema = z.object({
  recipientPhone: z.string().optional(),
  recipientName: z.string().optional(),
  amount: z.number().positive(),
  method: z.enum(["cash", "card", "transfer", "mobile_money"]).default("cash"),
});

export const splitPaymentsRouter = router({
  createSplit: protectedProcedure
    .input(
      z.object({
        totalAmount: z.number().positive().max(10_000_000),
        splits: z.array(splitItemSchema).min(2).max(10),
        narration: z.string().max(256).optional(),
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

        const splitTotal = input.splits.reduce((sum, s) => sum + s.amount, 0);
        if (Math.abs(splitTotal - input.totalAmount) > 0.01)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Split amounts (${splitTotal}) must equal total (${input.totalAmount})`,
          });

        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [agent] = await db
          .select({ premiumReserve: agents.premiumReserve })
          .from(agents)
          .where(eq(agents.id, session.id))
          .limit(1);
        if (!agent || Number(agent.premiumReserve) < input.totalAmount)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Insufficient premium reserve",
          });

        const groupRef = `SPL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        const results = [];

        for (let i = 0; i < input.splits.length; i++) {
          const split = input.splits[i];
          const ref = `${groupRef}-${i + 1}`;

          const [tx] = await db
            .insert(transactions)
            .values({
              ref,
              agentId: session.id,
              type: "Transfer",
              amount: String(split.amount),
              status: "success",
              channel: "App",
              customerPhone: split.recipientPhone ?? null,
              customerName: split.recipientName ?? null,
              metadata: {
                splitGroupRef: groupRef,
                splitIndex: i,
                splitMethod: split.method,
                narration: input.narration,
              },
            })
            .returning();

          results.push({
            ref,
            amount: split.amount,
            method: split.method,
            transactionId: tx.id,
          });
        }

        await db
          .update(agents)
          .set({
            premiumReserve: sql`CAST(${agents.premiumReserve} AS numeric) - ${String(input.totalAmount)}`,
          })
          .where(eq(agents.id, session.id));

        await writeAuditLog({
          agentId: session.id,
          action: "SPLIT_PAYMENT_CREATED",
          resource: "split_payment",
          resourceId: groupRef,
          status: "success",
          metadata: {
            totalAmount: input.totalAmount,
            splitCount: input.splits.length,
          },
        });

        return {
          groupRef,
          totalAmount: input.totalAmount,
          splits: results,
          status: "completed",
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

  getHistory: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }))
    .query(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

        const db = (await getDb())!;
        if (!db) return { splits: [] };

        const rows = await db.execute(
          sql`SELECT resource_id, metadata, "createdAt" FROM audit_log
              WHERE action = 'SPLIT_PAYMENT_CREATED' AND "agentId" = ${session.id}
              ORDER BY "createdAt" DESC LIMIT ${input.limit}`
        );

        return { splits: rows.rows ?? [] };
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
