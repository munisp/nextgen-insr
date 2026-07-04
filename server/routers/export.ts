// @ts-check
/**
 * Export router — streams transaction history as CSV.
 * Admin-only: requires agent.role === 'admin'.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "../db";
import { transactions, agents } from "../../drizzle/schema";
import { and, gte, lte, eq, desc } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getAgentFromCookie } from "../middleware/agentAuth";

export const exportRouter = router({
  /**
   * Returns a CSV string of all transactions within the given date range.
   * Filtered by agentId if provided; otherwise returns all agents (admin only).
   */
  transactionsCsv: protectedProcedure
    .input(
      z.object({
        from: z.string().optional(), // ISO date string e.g. "2026-01-01"
        to: z.string().optional(), // ISO date string e.g. "2026-03-31"
        agentId: z.string().optional(), // filter by agent (optional for admin)
        limit: z.number().default(10000),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const agent = await getAgentFromCookie(ctx.req);
        if (!agent) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });
        }

        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        // Build filter conditions
        const conditions = [];

        // Non-admins can only export their own transactions
        if (agent.role !== "admin") {
          conditions.push(eq(transactions.agentId, agent.id));
        } else if (input.agentId) {
          // Admin filtering by specific agent
          const agentRows = await db
            .select({ id: agents.id })
            .from(agents)
            .where(eq(agents.agentId, input.agentId))
            .limit(1);
          if (agentRows.length > 0) {
            conditions.push(eq(transactions.agentId, agentRows[0].id));
          }
        }

        if (input.from) {
          conditions.push(gte(transactions.createdAt, new Date(input.from)));
        }
        if (input.to) {
          // Include the full "to" day by setting time to end of day
          const toDate = new Date(input.to);
          toDate.setHours(23, 59, 59, 999);
          conditions.push(lte(transactions.createdAt, toDate));
        }

        const rows = await db
          .select({
            ref: transactions.ref,
            type: transactions.type,
            amount: transactions.amount,
            fee: transactions.fee,
            commission: transactions.commission,
            status: transactions.status,
            customerName: transactions.customerName,
            customerPhone: transactions.customerPhone,
            customerAccount: transactions.customerAccount,
            destinationBank: transactions.destinationBank,
            destinationAccount: transactions.destinationAccount,
            channel: transactions.channel,
            fraudScore: transactions.fraudScore,
            createdAt: transactions.createdAt,
            agentId: transactions.agentId,
          })
          .from(transactions)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(transactions.createdAt))
          .limit(input.limit);

        // Build agent ID lookup map
        const agentMap: Record<number, string> = {};
        const uniqueAgentIds = [...new Set(rows.map(r => r.agentId))];
        for (const aid of uniqueAgentIds) {
          const agentRows = await db
            .select({ agentId: agents.agentId })
            .from(agents)
            .where(eq(agents.id, aid))
            .limit(1);
          if (agentRows.length > 0) {
            agentMap[aid] = agentRows[0].agentId;
          }
        }

        // Build CSV
        const headers = [
          "Ref",
          "Agent Code",
          "Type",
          "Amount (NGN)",
          "Fee (NGN)",
          "Commission (NGN)",
          "Status",
          "Customer Name",
          "Customer Phone",
          "Customer Account",
          "Destination Bank",
          "Destination Account",
          "Channel",
          "Fraud Score",
          "Date/Time",
        ];

        const csvRows = rows.map((r: any) => [
          r.ref,
          agentMap[r.agentId] ?? "",
          r.type,
          Number(r.amount).toFixed(2),
          Number(r.fee).toFixed(2),
          Number(r.commission).toFixed(2),
          r.status,
          r.customerName ?? "",
          r.customerPhone ?? "",
          r.customerAccount ?? "",
          r.destinationBank ?? "",
          r.destinationAccount ?? "",
          r.channel,
          Number(r.fraudScore).toFixed(4),
          r.createdAt ? new Date(r.createdAt).toISOString() : "",
        ]);

        const csv = [headers, ...csvRows]
          .map((row: any) =>
            row
              .map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`)
              .join(",")
          )
          .join("\n");

        return {
          csv,
          rowCount: rows.length,
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

  /**
   * Returns a summary of each agent's daily volume and commission.
   * Used by the settlement cron and the Admin Panel analytics tab.
   */
  dailySummary: protectedProcedure
    .input(z.object({ date: z.string() })) // ISO date "2026-03-30"
    .query(async ({ input, ctx }) => {
      try {
        const agent = await getAgentFromCookie(ctx.req);
        if (!agent || agent.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Admin access required",
          });
        }

        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        const dayStart = new Date(input.date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(input.date);
        dayEnd.setHours(23, 59, 59, 999);

        const rows = await db
          .select({
            agentId: transactions.agentId,
            type: transactions.type,
            amount: transactions.amount,
            commission: transactions.commission,
            status: transactions.status,
          })
          .from(transactions)
          .where(
            and(
              gte(transactions.createdAt, dayStart),
              lte(transactions.createdAt, dayEnd),
              eq(transactions.status, "success")
            )
          );

        // Aggregate by agent
        const summary: Record<
          number,
          {
            agentId: string;
            txCount: number;
            totalVolume: number;
            totalCommission: number;
          }
        > = {};

        for (const row of rows) {
          if (!summary[row.agentId]) {
            summary[row.agentId] = {
              agentId: "",
              txCount: 0,
              totalVolume: 0,
              totalCommission: 0,
            };
          }
          summary[row.agentId].txCount++;
          summary[row.agentId].totalVolume += Number(row.amount);
          summary[row.agentId].totalCommission += Number(row.commission);
        }

        // Attach agent IDs
        for (const agentId of Object.keys(summary)) {
          const agentRows = await db
            .select({ agentId: agents.agentId })
            .from(agents)
            .where(eq(agents.id, Number(agentId)))
            .limit(1);
          if (agentRows.length > 0) {
            summary[Number(agentId)].agentId = agentRows[0].agentId;
          }
        }

        return Object.values(summary as any).sort(
          (a: any, b: any) => b.totalVolume - a.totalVolume
        );
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
