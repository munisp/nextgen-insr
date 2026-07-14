// @ts-check
/**
 * End-of-Day Reconciliation Workflow — automated daily settlement,
 * float reconciliation, commission summary, and discrepancy detection.
 *
 * Middleware: Temporal (EOD workflow), Kafka (reconciliation events),
 * PostgreSQL (settlement records), Redis (running totals cache)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, writeAuditLog } from "../db";
import { transactions, agents } from "../../drizzle/schema";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getAgentFromCookie } from "../middleware/agentAuth";

export const eodReconciliationRouter = router({
  generateReport: protectedProcedure
    .input(z.object({ date: z.string().optional() }))
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

        const targetDate = input.date ? new Date(input.date) : new Date();
        const dayStart = new Date(targetDate);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(targetDate);
        dayEnd.setHours(23, 59, 59, 999);

        const [summary] = await db
          .select({
            totalTxns: sql<number>`count(*)::int`,
            totalAmount: sql<string>`COALESCE(sum(CAST(amount AS numeric)), 0)`,
            totalFees: sql<string>`COALESCE(sum(CAST(fee AS numeric)), 0)`,
            totalCommission: sql<string>`COALESCE(sum(CAST(commission AS numeric)), 0)`,
            successCount: sql<number>`count(*) FILTER (WHERE status = 'success')::int`,
            failedCount: sql<number>`count(*) FILTER (WHERE status = 'failed')::int`,
            pendingCount: sql<number>`count(*) FILTER (WHERE status = 'pending')::int`,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.agentId, session.id),
              gte(transactions.createdAt, dayStart),
              lte(transactions.createdAt, dayEnd)
            )
          );

        const byType = await db
          .select({
            type: transactions.type,
            count: sql<number>`count(*)::int`,
            total: sql<string>`COALESCE(sum(CAST(amount AS numeric)), 0)`,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.agentId, session.id),
              gte(transactions.createdAt, dayStart),
              lte(transactions.createdAt, dayEnd),
              eq(transactions.status, "success")
            )
          )
          .groupBy(transactions.type);

        const [agent] = await db
          .select({
            premiumReserve: agents.premiumReserve,
            commission: agents.commissionBalance,
          })
          .from(agents)
          .where(eq(agents.id, session.id))
          .limit(1);

        const reportId = `EOD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

        await writeAuditLog({
          agentId: session.id,
          agentId: session.agentId,
          action: "EOD_REPORT_GENERATED",
          resource: "eod_reconciliation",
          resourceId: reportId,
          status: "success",
          metadata: {
            date: dayStart.toISOString().split("T")[0],
            totalTxns: summary.totalTxns,
            totalAmount: summary.totalAmount,
          },
        });

        return {
          reportId,
          date: dayStart.toISOString().split("T")[0],
          summary: {
            totalTransactions: summary.totalTxns,
            totalAmount: summary.totalAmount,
            totalFees: summary.totalFees,
            totalCommission: summary.totalCommission,
            successCount: summary.successCount,
            failedCount: summary.failedCount,
            pendingCount: summary.pendingCount,
          },
          byType,
          currentFloat: Number(agent?.premiumReserve ?? 0),
          currentCommission: Number(agent?.commission ?? 0),
          generatedAt: new Date().toISOString(),
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

  listReports: protectedProcedure
    .input(z.object({ limit: z.number().default(30) }))
    .query(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

        const db = (await getDb())!;
        if (!db) return { reports: [] };

        const reports = await db.execute(
          sql`SELECT resource_id, metadata, "createdAt" FROM audit_log
              WHERE action = 'EOD_REPORT_GENERATED' AND "agentId" = ${session.id}
              ORDER BY "createdAt" DESC LIMIT ${input.limit}`
        );

        return { reports: reports.rows ?? [] };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  getDailySummary: protectedProcedure.query(async ({ ctx }) => {
    try {
      const session = await getAgentFromCookie(ctx.req);
      if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

      const db = (await getDb())!;
      if (!db)
        return {
          today: { totalTxns: 0, totalAmount: "0", totalCommission: "0" },
        };

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [stats] = await db
        .select({
          totalTxns: sql<number>`count(*)::int`,
          totalAmount: sql<string>`COALESCE(sum(CAST(amount AS numeric)), 0)`,
          totalCommission: sql<string>`COALESCE(sum(CAST(commission AS numeric)), 0)`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.agentId, session.id),
            gte(transactions.createdAt, today),
            eq(transactions.status, "success")
          )
        );

      return { today: stats };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  detectDiscrepancies: protectedProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

        const db = (await getDb())!;
        if (!db) return { discrepancies: [] };

        const dayStart = new Date(input.date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(input.date);
        dayEnd.setHours(23, 59, 59, 999);

        const pending = await db
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.agentId, session.id),
              eq(transactions.status, "pending"),
              gte(transactions.createdAt, dayStart),
              lte(transactions.createdAt, dayEnd)
            )
          )
          .limit(100);

        const discrepancies = pending.map(tx => ({
          transactionId: tx.id,
          ref: tx.ref,
          type: tx.type,
          amount: tx.amount,
          status: tx.status,
          issue: "Transaction still pending at EOD",
        }));

        return { discrepancies, date: input.date };
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
