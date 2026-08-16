import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  reconciliationBatches,
  reconciliationItems,
  settlementReconciliation,
  transactions,
} from "../../drizzle/schema";
import { desc, eq, sql, and, gte, lte, count, sum, isNull } from "drizzle-orm";

/**
 * Reconciliation Engine Router
 * 
 * Handles transaction matching between internal ledger and external payment
 * providers (banks, mobile money, card networks). Detects discrepancies,
 * manages batch reconciliation workflows, and auto-resolves within tolerance.
 * 
 * Business Rules:
 * - Auto-resolve discrepancies ≤ ₦10 (rounding tolerance)
 * - Escalate discrepancies > ₦10,000 to finance team
 * - Flag duplicate references within 24h window
 * - SLA: All items must be reconciled within 48 hours
 */
export const reconciliationEngineRouter = router({
  // List reconciliation batches with status filtering
  listBatches: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        status: z.enum(["pending", "in_progress", "completed", "failed"]).optional(),
        sourceType: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0 };

      const conditions = [];
      if (input.status) conditions.push(eq(reconciliationBatches.sourceType, input.status));
      if (input.sourceType) conditions.push(eq(reconciliationBatches.sourceType, input.sourceType));

      const query = database
        .select()
        .from(reconciliationBatches)
        .orderBy(desc(reconciliationBatches.id))
        .limit(input.limit)
        .offset(input.offset);

      const results = conditions.length > 0
        ? await query.where(and(...conditions))
        : await query;

      const [{ total }] = await database.select({ total: count() }).from(reconciliationBatches);

      return { data: results, total: total ?? 0 };
    }),

  // List individual reconciliation items within a batch
  listItems: protectedProcedure
    .input(
      z.object({
        batchId: z.number(),
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
        matchStatus: z.enum(["matched", "unmatched", "discrepancy", "auto_resolved"]).optional(),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0 };

      const conditions = [eq(reconciliationItems.batchId, input.batchId)];

      const results = await database
        .select()
        .from(reconciliationItems)
        .where(and(...conditions))
        .orderBy(desc(reconciliationItems.id))
        .limit(input.limit)
        .offset(input.offset);

      const [{ total }] = await database
        .select({ total: count() })
        .from(reconciliationItems)
        .where(eq(reconciliationItems.batchId, input.batchId));

      return { data: results, total: total ?? 0 };
    }),

  // Get settlement reconciliation records (agent-level)
  listSettlements: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        status: z.enum(["pending", "matched", "discrepancy", "resolved", "escalated"]).optional(),
        agentId: z.number().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0 };

      const conditions = [];
      if (input.status) {
        // settlement_reconciliation enum has no "escalated"; surface it as discrepancy
        const st = input.status === "escalated" ? "discrepancy" : input.status;
        conditions.push(eq(settlementReconciliation.status, st));
      }
      if (input.agentId) conditions.push(eq(settlementReconciliation.agentId, input.agentId));

      const query = database
        .select()
        .from(settlementReconciliation)
        .orderBy(desc(settlementReconciliation.id))
        .limit(input.limit)
        .offset(input.offset);

      const results = conditions.length > 0
        ? await query.where(and(...conditions))
        : await query;

      const [{ total }] = await database.select({ total: count() }).from(settlementReconciliation);

      return { data: results, total: total ?? 0 };
    }),

  // Dashboard summary: KPIs for reconciliation health
  getSummary: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return null;

    const [batchStats] = await database
      .select({ total: count() })
      .from(reconciliationBatches);

    const [settlementStats] = await database
      .select({
        total: count(),
        totalDiscrepancy: sum(settlementReconciliation.discrepancy),
      })
      .from(settlementReconciliation);

    const [pendingCount] = await database
      .select({ total: count() })
      .from(settlementReconciliation)
      .where(eq(settlementReconciliation.status, "pending"));

    const [discrepancyCount] = await database
      .select({ total: count() })
      .from(settlementReconciliation)
      .where(eq(settlementReconciliation.status, "discrepancy"));

    return {
      totalBatches: batchStats?.total ?? 0,
      totalSettlements: settlementStats?.total ?? 0,
      totalDiscrepancyAmount: Number(settlementStats?.totalDiscrepancy ?? 0),
      pendingReconciliations: pendingCount?.total ?? 0,
      unresolvedDiscrepancies: discrepancyCount?.total ?? 0,
      reconciliationRate: settlementStats?.total
        ? ((settlementStats.total - (pendingCount?.total ?? 0)) / settlementStats.total * 100).toFixed(1)
        : "0.0",
      lastUpdated: new Date().toISOString(),
    };
  }),

  // Auto-reconcile: match transactions within tolerance threshold
  autoReconcile: protectedProcedure
    .input(
      z.object({
        batchId: z.number().optional(),
        toleranceNgn: z.number().min(0).max(100).default(10),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      // Find all pending settlements with discrepancy within tolerance
      const pendingItems = await database
        .select()
        .from(settlementReconciliation)
        .where(eq(settlementReconciliation.status, "pending"));

      let autoResolved = 0;
      let escalated = 0;

      for (const item of pendingItems) {
        const discrepancy = Math.abs(Number(item.discrepancy));

        if (discrepancy <= input.toleranceNgn) {
          // Auto-resolve: within rounding tolerance
          await database
            .update(settlementReconciliation)
            .set({
              status: "resolved",
              resolutionNote: `Auto-resolved: discrepancy ₦${discrepancy.toFixed(2)} within tolerance ₦${input.toleranceNgn}`,
            })
            .where(eq(settlementReconciliation.id, item.id));
          autoResolved++;
        } else if (discrepancy > 10000) {
          // Escalate: large discrepancy requires manual review
          await database
            .update(settlementReconciliation)
            .set({
              // settlement_reconciliation status enum has no "escalated"; large unresolved
              // items are discrepancies flagged for manual review via resolutionNote
              status: "discrepancy",
              resolutionNote: `Auto-escalated: discrepancy ₦${discrepancy.toFixed(2)} exceeds ₦10,000 threshold`,
            })
            .where(eq(settlementReconciliation.id, item.id));
          escalated++;
        } else {
          // Mark as discrepancy for manual review
          await database
            .update(settlementReconciliation)
            .set({ status: "discrepancy" })
            .where(eq(settlementReconciliation.id, item.id));
        }
      }

      return {
        processed: pendingItems.length,
        autoResolved,
        escalated,
        pendingReview: pendingItems.length - autoResolved - escalated,
      };
    }),

  // Manually resolve a discrepancy
  resolveDiscrepancy: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        resolution: z.enum(["accepted", "adjusted", "written_off", "refunded"]),
        note: z.string().min(10, "Resolution note must be at least 10 characters"),
        adjustedAmount: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [record] = await database
        .select()
        .from(settlementReconciliation)
        .where(eq(settlementReconciliation.id, input.id))
        .limit(1);

      if (!record) throw new Error("Settlement record not found");
      if (record.status === "resolved") throw new Error("Already resolved");

      await database
        .update(settlementReconciliation)
        .set({
          status: "resolved",
          resolutionNote: `[${input.resolution.toUpperCase()}] ${input.note}`,
        })
        .where(eq(settlementReconciliation.id, input.id));

      return { success: true, id: input.id, resolution: input.resolution };
    }),

  // Get reconciliation by ID with full details
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [record] = await database
        .select()
        .from(settlementReconciliation)
        .where(eq(settlementReconciliation.id, input.id))
        .limit(1);

      if (!record) throw new Error(`Reconciliation #${input.id} not found`);
      return record;
    }),
});
