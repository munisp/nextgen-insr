/**
 * memberOnboarding.ts — R3 batch 6 member surface (2026-10-01, R3-b6)
 *
 * Member-scoped READ-ONLY view of the caller's own onboarding pipeline
 * progress for the PWA
 * (customer-portal-full/client/src/services/memberOnboardingApi.ts → mounted
 * as `memberOnboarding`). Source: customerOnboardingPipeline.getProgress
 * (server/routers/customerOnboardingPipeline.ts:39-81).
 *
 * Worklist claim verification (2026-10-01, R3-b6): the claim that
 * getProgress is ownership-hardened (G2 #10) is TRUE — the source rejects a
 * caller-supplied userId that differs from the session user unless admin
 * (customerOnboardingPipeline.ts:46-48, FORBIDDEN). Even so, this member
 * variant does NOT delegate: the source proc still ACCEPTS an input userId
 * (relying on the runtime check) and uses a non-null-asserted `(await
 * getDb())!`. The member surface takes NO input at all — the userId is
 * rebound to ctx.user.id so there is nothing to smuggle — and goes through
 * the fail-closed db() helper. The stage math + STAGES constant are copied
 * verbatim from the source (lines 16-24, 61-71) with this dated comment.
 *
 * Identity space: customer_onboarding_progress.userId is USERS.ID space
 * (the source keys progress by users.id, not customers.id — see
 * customerOnboardingPipeline.ts:59). Members therefore do NOT need a
 * customers row for this surface; a member with no progress row honestly
 * reports stage "registration" (source semantics, never fabricated "live").
 *
 * advanceStage / list / getMetrics / getStats are deliberately NOT exposed:
 * advanceStage is a pipeline-ops mutation (its ownership check exists but
 * stage advancement is staff tooling), list/getMetrics/getStats are
 * platform-wide admin reads (worklist B6-2).
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR. Read-only; this router writes
 * nothing.
 */
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { customerOnboardingProgress, users } from "../../drizzle/schema";
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
 * 2026-10-01 (R3-b6): copied verbatim from customerOnboardingPipeline.ts
 * (lines 16-24) — the stage list is module-private there; keep identical so
 * the member surface and the staff pipeline report the same stage order.
 */
const STAGES = [
  "registration",
  "kyc_submission",
  "kyc_review",
  "account_setup",
  "training",
  "activation",
  "live",
] as const;

/** 2026-10-01 (R3-b6): copied from getStages (source lines 27-37). */
const STAGE_META = STAGES.map((s, i) => ({
  id: i + 1,
  name: s,
  order: i + 1,
  required: true,
  estimatedMinutes: [5, 15, 60, 10, 30, 5, 0][i],
}));

export const memberOnboardingRouter = router({
  /**
   * The caller's own pipeline progress (member variant of
   * customerOnboardingPipeline.getProgress with the userId rebound to the
   * session and stage metadata inlined so the PWA needs no second call).
   * Honest "registration" default when no durable progress row exists — the
   * store is the only source of truth (G2 #10).
   */
  myProgress: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const userId = ctx.user.id;
    const [user] = await d
      .select({ id: users.id, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const [progress] = await d
      .select({ currentStage: customerOnboardingProgress.currentStage })
      .from(customerOnboardingProgress)
      .where(eq(customerOnboardingProgress.userId, userId))
      .limit(1);
    const currentStage = (user
      ? (progress?.currentStage ?? "registration")
      : "registration") as (typeof STAGES)[number];
    const stageIndex = STAGES.indexOf(currentStage);
    return {
      currentStage,
      stageIndex,
      totalStages: STAGES.length,
      completionPercent: Math.round(((stageIndex + 1) / STAGES.length) * 100),
      stages: STAGE_META,
      startedAt:
        user?.createdAt?.toISOString() ?? new Date().toISOString(),
    };
  }),
});
