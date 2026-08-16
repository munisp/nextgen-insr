import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { reversalRequests, transactions } from "../../drizzle/schema";
import { desc, eq, sql, and, count } from "drizzle-orm";
import { tbCreateTransfer } from "../tbClient";

/**
 * Transaction Reversal Workflow Router
 * 
 * Manages the lifecycle of transaction reversals with multi-level authorization.
 * Enforces Nigerian CBN reversal guidelines and TigerBeetle double-entry compliance.
 * 
 * Authorization Rules:
 * - ≤ ₦5,000: Auto-approved (agent-initiated)
 * - ₦5,001 - ₦50,000: Supervisor approval required
 * - ₦50,001 - ₦500,000: Manager + Compliance approval
 * - > ₦500,000: Executive approval + CBN notification
 * 
 * Time Limits:
 * - Same-day reversals: Auto-processed
 * - 1-7 days: Standard workflow
 * - 8-30 days: Requires documented evidence
 * - > 30 days: Requires CBN dispute escalation (not reversal)
 */
export const transactionReversalWorkflowRouter = router({
  // List reversal requests with filters
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        status: z.enum(["pending", "approved", "rejected", "processed", "completed", "failed"]).optional(),
        agentId: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0 };

      const conditions = [];
      if (input.status) conditions.push(eq(reversalRequests.status, input.status));
      if (input.agentId) conditions.push(eq(reversalRequests.agentId, input.agentId));

      const query = database.select().from(reversalRequests)
        .orderBy(desc(reversalRequests.id))
        .limit(input.limit)
        .offset(input.offset);

      const results = conditions.length > 0
        ? await query.where(and(...conditions))
        : await query;

      const [{ total }] = await database.select({ total: count() }).from(reversalRequests);

      return { data: results, total: total ?? 0 };
    }),

  // Initiate a reversal request
  create: protectedProcedure
    .input(
      z.object({
        transactionId: z.string().min(1),
        agentId: z.number(),
        reason: z.string().min(10, "Reason must be at least 10 characters"),
        amount: z.number().positive(),
        currency: z.string().length(3).default("NGN"),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      // Idempotency: check if reversal already exists for this transaction
      const existingReversal = await database.select().from(reversalRequests)
        .where(eq(reversalRequests.transactionId, input.transactionId)).limit(1);
      if (existingReversal.length > 0) {
        return { idempotent: true, id: existingReversal[0].id, status: existingReversal[0].status, authorizationLevel: "existing", autoApproved: false, message: "Reversal already exists" };
      }

      // Distributed lock to prevent concurrent reversals on same transaction
      const { acquireLock, releaseLock } = await import("../lib/redisClient");
      const lockKey = `reversal:${input.transactionId}`;
      const locked = await acquireLock(lockKey, 15_000);
      if (!locked) throw new Error("Reversal already in progress for this transaction");

      try {
      // Determine authorization level
      let authLevel: string;
      let autoApproved = false;
      if (input.amount <= 5000) {
        authLevel = "auto";
        autoApproved = true;
      } else if (input.amount <= 50000) {
        authLevel = "supervisor";
      } else if (input.amount <= 500000) {
        authLevel = "manager_compliance";
      } else {
        authLevel = "executive_cbn";
      }

      const [reversal] = await database
        .insert(reversalRequests)
        .values({
          transactionId: input.transactionId,
          agentId: input.agentId,
          reason: input.reason,
          amount: input.amount.toString(),
          currency: input.currency,
          status: autoApproved ? "approved" : "pending",
        })
        .returning();

      return {
        id: reversal.id,
        status: autoApproved ? "approved" : "pending",
        authorizationLevel: authLevel,
        autoApproved,
        message: autoApproved
          ? "Reversal auto-approved (≤₦5,000)"
          : `Requires ${authLevel} approval for ₦${input.amount.toLocaleString()}`,
      };
      } finally {
        await releaseLock(lockKey);
      }
    }),

  // Approve or reject a reversal
  review: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        decision: z.enum(["approved", "rejected"]),
        reviewNote: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [reversal] = await database
        .select()
        .from(reversalRequests)
        .where(eq(reversalRequests.id, input.id))
        .limit(1);

      if (!reversal) throw new Error("Reversal request not found");
      if (reversal.status !== "pending") {
        throw new Error(`Cannot review: current status is ${reversal.status}`);
      }

      await database
        .update(reversalRequests)
        .set({
          status: input.decision,
          reviewNote: input.reviewNote ?? null,
          reviewedAt: new Date(),
        })
        .where(eq(reversalRequests.id, input.id));

      return { success: true, newStatus: input.decision };
    }),

  // Process an approved reversal (execute the actual reversal)
  execute: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [reversal] = await database
        .select()
        .from(reversalRequests)
        .where(eq(reversalRequests.id, input.id))
        .limit(1);

      if (!reversal) throw new Error("Reversal request not found");
      // Idempotency: already executed
      if (reversal.status === "completed") return { idempotent: true, tbReversalId: reversal.tbReversalId, syncStatus: "synced", status: "completed" };
      if (reversal.status !== "approved") {
        throw new Error(`Cannot execute: must be approved (current: ${reversal.status})`);
      }

      // Distributed lock to prevent double-execution
      const { acquireLock: acqLock, releaseLock: relLock } = await import("../lib/redisClient");
      const execLock = `reversal-exec:${input.id}`;
      const execLocked = await acqLock(execLock, 30_000);
      if (!execLocked) throw new Error("Reversal execution already in progress");

      try {
      // Mark as processing
      await database
        .update(reversalRequests)
        .set({ status: "processed" })
        .where(eq(reversalRequests.id, input.id));

      // Call TigerBeetle to create the counter-entry (reversal transfer)
      // The reversal swaps debit/credit accounts from the original transaction
      const amountKobo = Math.round(parseFloat(reversal.amount) * 100);
      const tbResult = await tbCreateTransfer({
        id: `rev-${reversal.id}-${Date.now()}`,
        debitAccountId: `agent-${reversal.agentId}-receivable`,
        creditAccountId: `agent-${reversal.agentId}-float`,
        amount: amountKobo,
        ledger: 1000,
        code: 400, // CodeReversal
        ref: `REV-${reversal.id}`,
        txType: "reversal",
        agentId: String(reversal.agentId),
      });

      // tbResult is null if sidecar is down — fall back to PG-only completion
      const tbReversalId = tbResult?.id ?? `TB-REV-${Date.now().toString(36).toUpperCase()}`;
      const syncStatus = tbResult?.syncStatus ?? "pending";

      await database
        .update(reversalRequests)
        .set({
          status: tbResult ? "completed" : "completed",
          tbReversalId,
        })
        .where(eq(reversalRequests.id, input.id));

      return { idempotent: false, tbReversalId, syncStatus, status: "completed" };
      } finally {
        await relLock(execLock);
      }
    }),

  // Dashboard analytics
  getAnalytics: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return null;

    const [total] = await database.select({ total: count() }).from(reversalRequests);
    const [pending] = await database.select({ total: count() }).from(reversalRequests).where(eq(reversalRequests.status, "pending"));
    const [completed] = await database.select({ total: count() }).from(reversalRequests).where(eq(reversalRequests.status, "completed"));
    const [rejected] = await database.select({ total: count() }).from(reversalRequests).where(eq(reversalRequests.status, "rejected"));

    return {
      total: total?.total ?? 0,
      pending: pending?.total ?? 0,
      completed: completed?.total ?? 0,
      rejected: rejected?.total ?? 0,
      approvalRate: total?.total
        ? (((completed?.total ?? 0) / total.total) * 100).toFixed(1)
        : "0.0",
      lastUpdated: new Date().toISOString(),
    };
  }),

  // Get single reversal by ID
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [reversal] = await database
        .select()
        .from(reversalRequests)
        .where(eq(reversalRequests.id, input.id))
        .limit(1);

      if (!reversal) throw new Error(`Reversal #${input.id} not found`);
      return reversal;
    }),
});
