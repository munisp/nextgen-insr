// @ts-check

/**
 * Settlement Reconciliation Router
 * Matches merchant settlement batches against transaction records.
 * Status flow: pending → matched | discrepancy → resolved
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  settlementReconciliation,
  merchantSettlements,
  transactions,
  agents,
} from "../../drizzle/schema";
import { eq, desc, and, count, gte, lte, sql } from "drizzle-orm";
import { writeAuditLog } from "../db";
// ── Middleware Integration (Sprint 44) ──────────────────────────────
import { publishEvent, type KafkaTopic } from "../kafkaClient";
import { cacheSet, cacheGet } from "../redisClient";
import { tbCreateTransfer } from "../tbClient";
import { fluvioProduce } from "../fluvio";
import { permifyCheck } from "../_core/permify";

export const settlementReconciliationRouter = router({
  // ── List reconciliation records ───────────────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        status: z
          .enum(["pending", "matched", "discrepancy", "resolved"])
          .optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { items: [], total: 0 };
        const offset = (input.page - 1) * input.limit;
        const where = input.status
          ? eq(settlementReconciliation.status, input.status)
          : undefined;
        const [items, [{ c: total }]] = await Promise.all([
          db
            .select()
            .from(settlementReconciliation)
            .where(where)
            .orderBy(desc(settlementReconciliation.createdAt))
            .limit(input.limit)
            .offset(offset),
          db.select({ c: count() }).from(settlementReconciliation).where(where),
        ]);
        return { items, total: Number(total) };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Run reconciliation for a settlement date ──────────────────────────────
  reconcileDate: protectedProcedure
    .input(
      z.object({
        settlementDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const dayStart = new Date(`${input.settlementDate}T00:00:00Z`);
        const dayEnd = new Date(`${input.settlementDate}T23:59:59Z`);

        // Get all merchant settlements for this date period
        const settlementsForDate = await db
          .select()
          .from(merchantSettlements)
          .where(eq(merchantSettlements.period, input.settlementDate));

        const results = [];
        for (const settlement of settlementsForDate) {
          // Sum completed transactions for this merchant on this date
          const txResult = await db
            .select({
              total: sql<string>`COALESCE(SUM("amount"), 0)`,
              txCount: count(),
            })
            .from(transactions)
            .where(
              and(
                eq(transactions.agentId, settlement.merchantId),
                gte(transactions.createdAt, dayStart),
                lte(transactions.createdAt, dayEnd),
                eq(transactions.status, "success")
              )
            );

          const txTotal = parseFloat(txResult[0]?.total ?? "0");
          const settlementAmount = parseFloat(settlement.netAmount as string);
          const discrepancy = Math.abs(txTotal - settlementAmount);
          const variancePct =
            settlementAmount > 0 ? (discrepancy / settlementAmount) * 100 : 0;
          const status = variancePct < 0.01 ? "matched" : "discrepancy";

          // Upsert reconciliation record
          const [existing] = await db
            .select()
            .from(settlementReconciliation)
            .where(
              and(
                eq(
                  settlementReconciliation.settlementDate,
                  input.settlementDate
                ),
                eq(
                  settlementReconciliation.agentId,
                  String(settlement.merchantId)
                )
              )
            )
            .limit(1);

          let record;
          if (existing) {
            [record] = await db
              .update(settlementReconciliation)
              .set({
                expectedAmount: String(txTotal),
                actualAmount: String(settlementAmount),
                discrepancy: String(discrepancy),
                status,
              })
              .where(eq(settlementReconciliation.id, existing.id))
              .returning();
          } else {
            [record] = await db
              .insert(settlementReconciliation)
              .values({
                settlementDate: input.settlementDate,
                agentId: String(settlement.merchantId),
                expectedAmount: String(txTotal),
                actualAmount: String(settlementAmount),
                discrepancy: String(discrepancy),
                status,
              })
              .returning();
          }
          results.push(record);
        }

        await writeAuditLog({
          action: "settlement_reconciliation_run",
          resource: "settlement_reconciliation",
          resourceId: input.settlementDate,
          status: "success",
          metadata: {
            recordsProcessed: results.length,
            date: input.settlementDate,
          },
        });

        return { processed: results.length, records: results };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Resolve a discrepancy ─────────────────────────────────────────────────
  resolve: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        resolution: z.string().min(1).max(1000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [record] = await db
          .select()
          .from(settlementReconciliation)
          .where(eq(settlementReconciliation.id, input.id))
          .limit(1);
        if (!record) throw new TRPCError({ code: "NOT_FOUND" });
        if (record.status !== "discrepancy") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only discrepancy records can be resolved",
          });
        }

        const [updated] = await db
          .update(settlementReconciliation)
          .set({
            status: "resolved",
            resolutionNote: input.resolution,
            resolvedBy: ctx.user.id,
            resolvedAt: new Date(),
          })
          .where(eq(settlementReconciliation.id, input.id))
          .returning();

        return updated;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Summary stats ─────────────────────────────────────────────────────────
  stats: protectedProcedure.query(async () => {
    try {
      const db = (await getDb())!;
      if (!db)
        return {
          total: 0,
          matched: 0,
          discrepancy: 0,
          resolved: 0,
          pending: 0,
        };
      const rows = await db.select().from(settlementReconciliation).limit(100);
      return {
        total: rows.length,
        matched: rows.filter((r: any) => r.status === "matched").length,
        discrepancy: rows.filter((r: any) => r.status === "discrepancy").length,
        resolved: rows.filter((r: any) => r.status === "resolved").length,
        pending: rows.filter((r: any) => r.status === "pending").length,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),
});
