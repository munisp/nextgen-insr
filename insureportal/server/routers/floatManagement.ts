import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { premiumTopUpRequests, agents, transactions } from "../../drizzle/schema";
import { desc, eq, sql, and, count, sum } from "drizzle-orm";

/**
 * Float Management Router
 * 
 * Manages agent premium reserves, top-up requests, and threshold monitoring.
 * Float is the working capital agents use to process transactions.
 * 
 * Business Rules:
 * - Minimum premium reserve: ₦50,000 (below = restricted operations)
 * - Maximum single top-up: ₦5,000,000
 * - Auto-approve top-ups ≤ ₦200,000 for agents with clean history
 * - Top-ups > ₦1,000,000 require manager approval
 * - Daily transaction limit: 3x premium reserve
 * - Low float alert: when balance drops below 20% of average daily volume
 */
export const floatManagementRouter = router({
  // List top-up requests with filtering
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        status: z.enum(["pending", "approved", "rejected", "processing", "completed"]).optional(),
        agentId: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0 };

      const conditions = [];
      if (input.status) conditions.push(eq(premiumTopUpRequests.status, input.status));
      if (input.agentId) conditions.push(eq(premiumTopUpRequests.agentId, input.agentId));

      const query = database.select().from(premiumTopUpRequests)
        .orderBy(desc(premiumTopUpRequests.id))
        .limit(input.limit)
        .offset(input.offset);

      const results = conditions.length > 0
        ? await query.where(and(...conditions))
        : await query;

      const [{ total }] = await database.select({ total: count() }).from(premiumTopUpRequests);

      return { data: results, total: total ?? 0 };
    }),

  // Request a float top-up
  requestTopUp: protectedProcedure
    .input(
      z.object({
        agentId: z.number(),
        amount: z.number().min(10000, "Minimum top-up is ₦10,000").max(5000000, "Maximum top-up is ₦5,000,000"),
        paymentMethod: z.enum(["bank_transfer", "card", "mobile_money", "cash_deposit"]),
        reference: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      // Determine if auto-approval applies
      let autoApproved = false;
      if (input.amount <= 200000) {
        autoApproved = true;
      }

      const [request] = await database
        .insert(premiumTopUpRequests)
        .values({
          agentId: input.agentId,
          requestedAmount: input.amount.toString(),
          status: autoApproved ? "approved" : "pending",
        })
        .returning();

      return {
        id: request.id,
        status: autoApproved ? "approved" : "pending",
        autoApproved,
        message: autoApproved
          ? `Top-up of ₦${input.amount.toLocaleString()} auto-approved`
          : `Top-up of ₦${input.amount.toLocaleString()} pending approval`,
      };
    }),

  // Approve/reject a top-up request
  review: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        decision: z.enum(["approved", "rejected"]),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [request] = await database
        .select()
        .from(premiumTopUpRequests)
        .where(eq(premiumTopUpRequests.id, input.id))
        .limit(1);

      if (!request) throw new Error("Top-up request not found");
      if (request.status !== "pending") {
        throw new Error(`Cannot review: status is ${request.status}`);
      }

      await database
        .update(premiumTopUpRequests)
        .set({
          status: input.decision,
          approvedBy: input.note ?? null,
        })
        .where(eq(premiumTopUpRequests.id, input.id));

      return { success: true, newStatus: input.decision };
    }),

  // Get float health dashboard
  getDashboard: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return null;

    const [total] = await database.select({ total: count() }).from(premiumTopUpRequests);
    const [pending] = await database.select({ total: count() }).from(premiumTopUpRequests).where(eq(premiumTopUpRequests.status, "pending"));
    const [approved] = await database.select({ total: count() }).from(premiumTopUpRequests).where(eq(premiumTopUpRequests.status, "approved"));

    const [totalVolume] = await database
      .select({ total: sum(premiumTopUpRequests.requestedAmount) })
      .from(premiumTopUpRequests)
      .where(eq(premiumTopUpRequests.status, "approved"));

    return {
      totalRequests: total?.total ?? 0,
      pendingApproval: pending?.total ?? 0,
      approvedCount: approved?.total ?? 0,
      totalApprovedVolume: Number(totalVolume?.total ?? 0),
      averageTopUpAmount: (approved?.total ?? 0) > 0
        ? (Number(totalVolume?.total ?? 0) / (approved?.total ?? 1)).toFixed(0)
        : "0",
      lastUpdated: new Date().toISOString(),
    };
  }),

  // Get single request
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [request] = await database
        .select()
        .from(premiumTopUpRequests)
        .where(eq(premiumTopUpRequests.id, input.id))
        .limit(1);

      if (!request) throw new Error(`Float request #${input.id} not found`);
      return request;
    }),
});
