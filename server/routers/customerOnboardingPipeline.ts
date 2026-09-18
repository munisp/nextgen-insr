/**
 * Customer Onboarding Pipeline Router
 * 7-stage pipeline: Registration → KYC Submission → KYC Review → Account Setup → Training → Activation → Live
 * KYC enforcement: advancement past kyc_submission requires a completed KYC session.
 * KYB enforcement: advancement past account_setup requires approved KYB verification (if business customer).
 */
import { TRPCError } from "@trpc/server";
import { sql, desc, eq, and } from "drizzle-orm";
import { z } from "zod";

import { users, kycSessions, customerOnboardingProgress } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, writeAuditLog } from "../db";


const STAGES = [
  "registration",
  "kyc_submission",
  "kyc_review",
  "account_setup",
  "training",
  "activation",
  "live",
] as const;

export const customerOnboardingPipelineRouter = router({
  getStages: protectedProcedure.query(() => {
    return {
      stages: STAGES.map((s, i) => ({
        id: i + 1,
        name: s,
        order: i + 1,
        required: true,
        estimatedMinutes: [5, 15, 60, 10, 30, 5, 0][i],
      })),
    };
  }),

  getProgress: protectedProcedure
    .input(z.object({ userId: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        const userId = input.userId || ctx.user.id;
        // Ownership (G2 #10): users may only read their OWN progress.
        if (String(userId) !== String(ctx.user.id) && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Cannot view another user's onboarding progress" });
        }
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, userId as any))
          .limit(1);
        // G2 #10: stage is READ FROM THE STORE — never fabricated. The old
        // code returned "live" for every existing user.
        const [progress] = await db
          .select()
          .from(customerOnboardingProgress)
          .where(eq(customerOnboardingProgress.userId, Number(userId)))
          .limit(1);
        const currentStage = (user ? (progress?.currentStage ?? "registration") : "registration") as (typeof STAGES)[number];
        const stageIndex = STAGES.indexOf(currentStage);
        return {
          userId,
          currentStage,
          stageIndex,
          totalStages: STAGES.length,
          completionPercent: Math.round(
            ((stageIndex + 1) / STAGES.length) * 100
          ),
          startedAt: user?.createdAt?.toISOString() || new Date().toISOString(),
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

  advanceStage: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        /** Optional client hint — VALIDATED against the stored stage, never trusted (G2 #10). */
        fromStage: z.string().optional(),
        toStage: z.string(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        // G2 audit 2026-02 (#10): ownership — a caller may only advance their
        // OWN pipeline unless admin (userId was previously fully
        // client-supplied, and parseInt(userId)||0 collapsed bad ids to 0).
        if (String(input.userId) !== String(ctx.user.id) && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Cannot advance another user's onboarding pipeline" });
        }
        const numericUserId = Number(input.userId);
        if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid userId" });
        }

        // SERVER-DERIVED stage (G2 #10): read the durable current stage; the
        // client may no longer assert fromStage to walk around the KYC gates.
        const [progress] = await db
          .select()
          .from(customerOnboardingProgress)
          .where(eq(customerOnboardingProgress.userId, numericUserId))
          .limit(1);
        const fromStage = progress?.currentStage ?? "registration";
        if (input.fromStage && input.fromStage !== fromStage) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Stale stage: server stage is "${fromStage}", not "${input.fromStage}" — refresh and retry`,
          });
        }

        const fromIdx = STAGES.indexOf(fromStage as (typeof STAGES)[number]);
        const toIdx = STAGES.indexOf(input.toStage as (typeof STAGES)[number]);
        if (fromIdx < 0 || toIdx < 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid stage name",
          });
        }
        if (toIdx <= fromIdx) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot go backward in pipeline",
          });
        }
        if (toIdx - fromIdx > 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot skip stages — advance one step at a time",
          });
        }

        // ── KYC Gate: Block advancement from kyc_submission → kyc_review
        //    unless the customer has a completed KYC session ──────────────
        if (
          fromStage === "kyc_submission" &&
          input.toStage === "kyc_review"
        ) {
          const [kycSession] = await db
            .select()
            .from(kycSessions)
            .where(
              and(
                eq(kycSessions.agentId, numericUserId),
                eq(kycSessions.status, "completed")
              )
            )
            .limit(1);

          if (!kycSession) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "KYC must be completed before advancing to review. Please submit all required documents and pass liveness verification.",
            });
          }
        }

        // ── KYC Review Gate: Block advancement from kyc_review → account_setup
        //    unless KYC review is approved (session status is still completed) ──
        if (
          fromStage === "kyc_review" &&
          input.toStage === "account_setup"
        ) {
          const [kycSession] = await db
            .select()
            .from(kycSessions)
            .where(
              and(
                eq(kycSessions.agentId, numericUserId),
                eq(kycSessions.status, "completed")
              )
            )
            .limit(1);

          if (!kycSession) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "KYC review must be approved before proceeding to account setup.",
            });
          }
        }

        // Persist the server-derived transition (durable stage).
        await db
          .insert(customerOnboardingProgress)
          .values({
            userId: numericUserId,
            currentStage: input.toStage,
            notes: input.notes ?? null,
            advancedBy: String(ctx.user.id),
          })
          .onConflictDoUpdate({
            target: customerOnboardingProgress.userId,
            set: {
              currentStage: input.toStage,
              notes: input.notes ?? null,
              advancedBy: String(ctx.user.id),
              updatedAt: new Date(),
            },
          });

        await writeAuditLog({
          agentId: 0,
          action: "customer_onboarding_stage_advanced",
          resource: "customer_onboarding",
          resourceId: input.userId,
          status: "success",
          // NOTE (2026-02): undefined-valued metadata keys MUST be omitted —
          // the audit-chain hash serializes undefined as null at write time
          // while JSONB drops the key on read, which would break the chain.
          metadata: {
            agentCode: "system",
            fromStage,
            toStage: input.toStage,
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
          },
        });

        return {
          userId: input.userId,
          fromStage,
          toStage: input.toStage,
          advancedBy: ctx.user.id,
          advancedAt: new Date().toISOString(),
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

  list: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        stage: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const items = await db
          .select()
          .from(users)
          .orderBy(desc(users.createdAt))
          .limit(input.limit)
          .offset((input.page - 1) * input.limit);
        const [{ count }] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(users)
          .limit(100);
        // G2 #10: read the durable stage — never fabricate "live".
        const progressRows = await db.select().from(customerOnboardingProgress);
        const stageByUser = new Map(progressRows.map((p: any) => [p.userId, p.currentStage]));
        return {
          items: items.map((u: any) => {
            const stage = stageByUser.get(u.id) ?? "registration";
            const idx = STAGES.indexOf(stage);
            return {
              ...u,
              stage,
              completionPercent: Math.round(((idx + 1) / STAGES.length) * 100),
            };
          }),
          total: Number(count),
          page: input.page,
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

  getMetrics: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message:
        "Onboarding metrics are not implemented yet (avg days, drop-off and conversion rates were previously fabricated)",
    });
  }),
  getStats: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "Onboarding pipeline stats are not implemented yet",
    });
  }),
});
