/**
 * memberFeedback.ts — R3 batch 6 member surface (2026-10-01, R3-b6)
 *
 * Member-scoped structured feedback for the PWA
 * (customer-portal-full/client/src/services/memberFeedbackApi.ts → mounted
 * as `memberFeedback`) over the REAL customer_feedback_nps table
 * (drizzle/schema.ts:2882 — verified present, columns id/customerId/score/
 * feedback/channel/policyId/claimId/createdAt).
 *
 * Worklist claim verification (2026-10-01, R3-b6): the claim that the
 * source submitFeedback inserts an ARBITRARY `data` dict is TRUE
 * (server/routers/customerFeedbackNps.ts:200-241 — z.record(z.any())
 * passed straight into .values(), so a caller can stamp ANY customerId/
 * policyId/claimId). This router therefore does NOT delegate to the source
 * submit proc; it inserts a STRUCTURED row whose customerId is the caller's
 * resolved customers.id (customers.keycloakSub = String(ctx.user.id),
 * memberQuotes.requireSessionCustomer pattern) — never client-supplied.
 * The admin reads (getNpsScore/getFeedbackList/getSentimentAnalysis/
 * respondToFeedback/getStats) stay admin-only and are NOT exposed here.
 *
 * Identity space: customer_feedback_nps.customerId is CUSTOMERS.ID space
 * (resolved via keycloakSub). A customer profile is REQUIRED — without one
 * there is no caller scope to stamp → NOT_FOUND (fail-closed,
 * non-enumerating, memberQuotes pattern).
 *
 * PII rule: feedback is free text. The member surface can only ever read
 * the caller's OWN rows (myFeedback is scoped eq(customerId, resolved id));
 * no enumeration/admin procs exist here.
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR; no profile → NOT_FOUND.
 */
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { customerFeedbackNps, customers } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import type { DrizzleDb } from "../lib/memberGuards";

async function db(): Promise<DrizzleDb> {
  const d = await getDb();
  if (!d)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable",
    });
  return d;
}

/**
 * Resolve + REQUIRE the session customer: customers.keycloakSub =
 * String(ctx.user.id) (memberSavings/memberQuotes requireSessionCustomer
 * pattern, 2026-10-01 R3-b6 copy). Feedback rows key customers.id, so
 * without a profile there is no caller scope — NOT_FOUND (non-enumerating).
 */
async function requireSessionCustomer(d: DrizzleDb, userId: number) {
  const [customer] = await d
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.keycloakSub, String(userId)))
    .limit(1);
  if (!customer) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Customer profile not found for session user",
    });
  }
  return customer;
}

/** PII-safe member projection — never policyId/claimId linkage of others. */
const feedbackMemberProjection = {
  id: customerFeedbackNps.id,
  score: customerFeedbackNps.score,
  feedback: customerFeedbackNps.feedback,
  channel: customerFeedbackNps.channel,
  createdAt: customerFeedbackNps.createdAt,
} as const;

export const memberFeedbackRouter = router({
  /**
   * Structured member submit (replaces the source's arbitrary-`data`
   * submitFeedback). customerId is stamped server-side from the resolved
   * session customer; score is bounded 1..10; channel is an enum, not free
   * text. No policyId/claimId linkage is accepted from the member client.
   */
  submitMyFeedback: protectedProcedure
    .input(
      z.object({
        score: z.number().int().min(1).max(10),
        feedback: z.string().max(2000).optional(),
        channel: z
          .enum(["web", "mobile", "ussd", "agent", "sms"])
          .default("web"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const customer = await requireSessionCustomer(d, ctx.user.id);
      const [row] = await d
        .insert(customerFeedbackNps)
        .values({
          customerId: customer.id,
          score: input.score,
          feedback: input.feedback ?? null,
          channel: input.channel,
        })
        .returning(feedbackMemberProjection);
      return { success: true as const, feedback: row };
    }),

  /**
   * The caller's OWN feedback rows, newest first (bounded). Never returns
   * another member's feedback — the scope is the resolved customers.id.
   */
  myFeedback: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const d = await db();
      const customer = await requireSessionCustomer(d, ctx.user.id);
      const items = await d
        .select(feedbackMemberProjection)
        .from(customerFeedbackNps)
        .where(eq(customerFeedbackNps.customerId, customer.id))
        .orderBy(desc(customerFeedbackNps.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      return { items, count: items.length };
    }),
});
