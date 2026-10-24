/**
 * memberInsights.ts — W11-B3a (2026-10-24): member heuristic-intelligence
 * surface (Phase 3), mounted as `memberInsights`. READ-ONLY suggestions
 * computed from the caller's REAL data (server/lib/memberInsights.ts):
 *
 *   - nextBestActions:    ranked suggestions (renewal due ≤14d > unresolved
 *                         failed_refund_pending capture > recurring payment
 *                         due soon > KYC incomplete). NO autonomous action
 *                         is ever taken — payload carries ids/refs only.
 *   - recurringCandidates: the caller's detected recurring payees (>=3
 *                         occurrences at 30±5d intervals) with dueSoon flag.
 *                         There is NO per-member accept/dismiss state table
 *                         in this phase (W11-B3a adds no tables) — the
 *                         response is detections only; clients may persist
 *                         dismissal locally. Documented honestly.
 *   - amountAnomalyCheck: conservative soft-confirm when an amount exceeds
 *                         3× the caller's own median for that payee AND the
 *                         ₦5,000 floor. FAILS CLOSED: insufficient history
 *                         → anomalous:false (never a false alarm).
 *
 * Identity: caller resolved SESSION-SIDE ONLY (customers.keycloakSub =
 * String(ctx.user.id), resolveMemberCustomer); no customerId is ever
 * accepted from input and every query is scoped to the resolved id, so no
 * cross-member row is readable. No member profile → honest empty results
 * (never an enumeration oracle). No DB → INTERNAL_SERVER_ERROR.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { resolveMemberCustomer } from "../lib/memberFunds";
import type { DrizzleDb } from "../lib/memberGuards";
import {
  computeNextBestActions,
  detectRecurring,
  evaluateAmountAnomaly,
  listCallerTransactions,
  payeeHistoryKobo,
} from "../lib/memberInsights";
import { payeeNaturalKey } from "../lib/memberPayees";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

async function db(): Promise<DrizzleDb> {
  const d = await getDb();
  if (!d)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable",
    });
  return d;
}

export const memberInsightsRouter = router({
  /** Ranked, explainable next-best actions for the caller (read-only). */
  nextBestActions: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const customer = await resolveMemberCustomer(d, ctx.user.id);
    if (!customer) return { actions: [] };
    return {
      actions: await computeNextBestActions(d, Number(ctx.user.id), customer.id),
    };
  }),

  /**
   * The caller's detected recurring payments (explicit list). No
   * accept/dismiss server state exists in this phase — detections only.
   */
  recurringCandidates: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const customer = await resolveMemberCustomer(d, ctx.user.id);
    if (!customer) return { candidates: [], state: "detections_only" as const };
    const txs = await listCallerTransactions(d, customer.id);
    return {
      candidates: detectRecurring(txs),
      state: "detections_only" as const,
    };
  }),

  /**
   * Soft-confirm check: is this amount anomalous for the caller's history
   * with this payee? Member-facing UX signal only — it never blocks.
   */
  amountAnomalyCheck: protectedProcedure
    .input(
      z.object({
        rail: z.enum(["bill", "airtime", "momo"]),
        identifiers: z.object({
          billerCode: z.string().trim().max(64).optional(),
          meterNumber: z.string().trim().max(64).optional(),
          network: z.string().trim().max(64).optional(),
          phone: z.string().trim().max(32).optional(),
          provider: z.string().trim().max(64).optional(),
          walletNumber: z.string().trim().max(64).optional(),
        }),
        amountKobo: z.number().int().min(1).max(1_000_000_000),
      })
    )
    .query(async ({ input, ctx }) => {
      const d = await db();
      const customer = await resolveMemberCustomer(d, ctx.user.id);
      // Fail-closed: unknown caller or incomplete identifier tuple → never
      // an alarm (an anomaly check that cannot see history says nothing).
      if (!customer) {
        return { anomalous: false, multiple: null, reason: "insufficient_history" };
      }
      const naturalKey = payeeNaturalKey(input.rail, input.identifiers);
      if (!naturalKey) {
        return { anomalous: false, multiple: null, reason: "insufficient_history" };
      }
      const history = await payeeHistoryKobo(d, customer.id, naturalKey);
      return evaluateAmountAnomaly(history, input.amountKobo);
    }),
});
