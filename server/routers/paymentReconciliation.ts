// Sprint 87: Upgraded from mock data to real DB queries — paymentReconciliation
import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { z } from "zod";

import { floatReconciliations, paymentDiscrepancies, transactions } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

const getReconciliationReport = protectedProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
    })
  )
  .query(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const lim = input.limit ?? 10;
      const offset = ((input.page ?? 1) - 1) * lim;
      const rows = await db
        .select()
        .from(floatReconciliations)
        .orderBy(desc(floatReconciliations.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(floatReconciliations)
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
// PAY-6: REAL discrepancy surface — previously a verbatim copy of the report
// query with no discrepancy filter. Now returns only OPEN findings produced
// by runReconciliation.
const getDiscrepancies = protectedProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
      status: z.enum(["open", "resolved", "all"]).optional(),
    })
  )
  .query(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const lim = input.limit ?? 10;
      const offset = ((input.page ?? 1) - 1) * lim;
      const status = input.status ?? "open";
      const where = status === "all" ? undefined : eq(paymentDiscrepancies.status, status);
      const rows = await db
        .select()
        .from(paymentDiscrepancies)
        .where(where)
        .orderBy(desc(paymentDiscrepancies.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(paymentDiscrepancies)
        .where(where);
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
const getStats = protectedProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    })
  )
  .query(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const [{ total }] = await db
        .select({ total: count() })
        .from(floatReconciliations)
        .limit(100);
      const recent = await db
        .select()
        .from(floatReconciliations)
        .orderBy(desc(floatReconciliations.id))
        .limit(5);
      return {
        totalRecords: total,
        recentItems: recent,
        summary: { active: total, lastUpdated: new Date().toISOString() },
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
const getMatchRules = protectedProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
    })
  )
  .query(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const lim = input.limit ?? 10;
      const offset = ((input.page ?? 1) - 1) * lim;
      const rows = await db
        .select()
        .from(floatReconciliations)
        .orderBy(desc(floatReconciliations.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(floatReconciliations)
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
// PAY-6: REAL reconciliation run. Previously this inserted/selected a row and
// returned "runReconciliation completed" without comparing anything. Now it
// compares the PG transaction log against ledger-sync state and writes one
// durable payment_discrepancies row per finding (idempotent per run: an
// already-open finding for the same ref is not duplicated).
const runReconciliation = protectedProcedure
  .input(
    z.object({
      staleMinutes: z.number().min(1).max(10080).optional(),
    }).optional()
  )
  .mutation(async ({ input, ctx }) => {
    try {
      const db = (await getDb())!;
      const staleBefore = new Date(Date.now() - (input?.staleMinutes ?? 30) * 60_000);
      const runId = `RECON-RUN-${Date.now()}`;
      let inserted = 0;

      // Finding class 1: settled PG transactions whose TigerBeetle leg never
      // confirmed (metadata.tbSyncStatus pending/failed) — PG↔TB divergence.
      const stale = await db
        .select({
          id: transactions.id,
          ref: transactions.ref,
          agentId: transactions.agentId,
          amount: transactions.amount,
          metadata: transactions.metadata,
        })
        .from(transactions)
        .where(sql`status = 'success' AND "deletedAt" IS NULL AND "createdAt" < ${staleBefore.toISOString()}
              AND COALESCE(metadata->>'tbSyncStatus','pending') IN ('pending','failed')`)
        .limit(500);
      for (const row of stale) {
        const [dupe] = await db
          .select({ id: paymentDiscrepancies.id })
          .from(paymentDiscrepancies)
          .where(and(
            eq(paymentDiscrepancies.kind, "tb_sync_unconfirmed"),
            eq(paymentDiscrepancies.ref, row.ref),
            eq(paymentDiscrepancies.status, "open"),
          ))
          .limit(1);
        if (dupe) continue;
        await db.insert(paymentDiscrepancies).values({
          runId,
          kind: "tb_sync_unconfirmed",
          ref: row.ref,
          agentId: row.agentId,
          actualAmount: String(row.amount),
          detail: `Transaction ${row.ref} is settled in PG but its TigerBeetle leg is '${(row.metadata as any)?.tbSyncStatus ?? "pending"}' (older than ${input?.staleMinutes ?? 30}m).`,
        });
        inserted++;
      }

      return {
        success: true,
        runId,
        scanned: stale.length,
        newDiscrepancies: inserted,
        comparedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });

// PAY-6: REAL resolution — a guarded status transition open → resolved with
// operator identity and a mandatory note. Resolving a nonexistent or already
// resolved discrepancy is an explicit error, never a fake success.
const resolveDiscrepancy = protectedProcedure
  .input(
    z.object({
      id: z.number(),
      note: z.string().min(5),
    })
  )
  .mutation(async ({ input, ctx }) => {
    try {
      const db = (await getDb())!;
      const resolved = await db
        .update(paymentDiscrepancies)
        .set({
          status: "resolved",
          resolvedBy: ctx.user?.id != null ? String(ctx.user.id) : "system",
          resolvedAt: new Date(),
          resolutionNote: input.note,
        })
        .where(and(
          eq(paymentDiscrepancies.id, input.id),
          eq(paymentDiscrepancies.status, "open"),
        ))
        .returning();
      if (resolved.length === 0) {
        const [existing] = await db
          .select()
          .from(paymentDiscrepancies)
          .where(eq(paymentDiscrepancies.id, input.id))
          .limit(1);
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Discrepancy ${input.id} not found` });
        }
        throw new TRPCError({ code: "CONFLICT", message: `Discrepancy ${input.id} is already ${existing.status}` });
      }
      return { success: true, discrepancy: resolved[0] };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
const updateMatchRules = protectedProcedure
  .input(
    z.object({ id: z.number(), data: z.record(z.string(), z.any()).optional() })
  )
  .mutation(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const [existing] = await db
        .select()
        .from(floatReconciliations)
        .where(eq(floatReconciliations.id, input.id))
        .limit(100);
      if (!existing)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "updateMatchRules: record not found",
        });
      if (input.data) {
        const [updated] = await db
          .update(floatReconciliations)
          .set(input.data)
          .where(eq(floatReconciliations.id, input.id))
          .returning();
        return { success: true, ...updated, message: "Record updated" };
      }
      return { success: true, ...existing, message: "No changes applied" };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });

export const paymentReconciliationRouter = router({
  getReconciliationReport,
  getDiscrepancies,
  getStats,
  getMatchRules,
  runReconciliation,
  resolveDiscrepancy,
  updateMatchRules,
});
