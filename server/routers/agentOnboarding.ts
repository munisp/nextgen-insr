/**
 * Agent Onboarding Router
 * 5-step wizard: Profile → KYC → Float → Terminal → Training → Activated
 * Tracks progress in agent_onboarding_progress table.
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, count, and } from "drizzle-orm";
import { z } from "zod";

import {
  agentOnboardingProgress,
  agents,
  kycSessions,
  premiumTopUpRequests,
} from "../../drizzle/schema";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb , writeAuditLog } from "../db";
import { resolveAgentScope } from "../middleware/agentAuth";
import { assertAgentActivationEligible } from "../lib/agentLifecycle";
import { enqueueEmail, buildAlertEmail } from "../lib/emailQueue";

export const agentOnboardingRouter = router({
  // ── Get onboarding progress for an agent ─────────────────────────────────
  getProgress: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("Database connection unavailable");

        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.agentId, input.agentId))
          .limit(1);
        if (!agent) return null;

        const [progress] = await db
          .select()
          .from(agentOnboardingProgress)
          .where(eq(agentOnboardingProgress.agentId, agent.agentId))
          .limit(1);

        if (!progress) {
          // Auto-create progress record (race-safe: migration 0079 adds a
          // unique index on agent_onboarding_progress.agentId; a concurrent
          // insert wins and we fall back to the winner's row).
          const created = await db
            .insert(agentOnboardingProgress)
            .values({
              agentId: input.agentId,
              currentStep: "profile",
            })
            .onConflictDoNothing()
            .returning();
          if (created.length > 0) return { ...created[0], agent };
          const [winner] = await db
            .select()
            .from(agentOnboardingProgress)
            .where(eq(agentOnboardingProgress.agentId, agent.agentId))
            .limit(1);
          return winner ? { ...winner, agent } : null;
        }

        return { ...progress, agent };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Complete profile step ─────────────────────────────────────────────────
  completeProfile: protectedProcedure
    .input(
      z.object({
        agentId: z.string(),
        name: z.string().min(2).max(128),
        phone: z.string().min(11).max(20),
        email: z.string().email().optional(),
        location: z.string().max(128).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.agentId, input.agentId))
          .limit(1);
        if (!agent) throw new TRPCError({ code: "NOT_FOUND" });

        // G3 (audit #23): the profile being rewritten must belong to the
        // caller — an agent session edits only its own record; an admin may
        // edit any (impersonation-audited). Phone is the USSD identity, so
        // this check is what stands between an attacker and an identity
        // hijack.
        const scope = await resolveAgentScope(ctx.req, ctx.user?.role, agent.id);
        if (!scope.ok) {
          throw new TRPCError({ code: scope.code, message: scope.message });
        }
        // Keep one-identity-per-MSISDN when the phone changes (audit #26).
        if (input.phone !== agent.phone) {
          const [phoneTaken] = await db
            .select({ id: agents.id })
            .from(agents)
            .where(eq(agents.phone, input.phone))
            .limit(1);
          if (phoneTaken && phoneTaken.id !== agent.id) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Another agent already uses this phone number",
            });
          }
        }

        // Update agent profile
        await db
          .update(agents)
          .set({
            name: input.name,
            phone: input.phone,
            email: input.email,
            location: input.location,
            updatedAt: new Date(),
          })
          .where(eq(agents.agentId, input.agentId));

        // Update onboarding progress
        const [progress] = await db
          .update(agentOnboardingProgress)
          .set({
            profileComplete: true,
            currentStep: "kyc",
            updatedAt: new Date(),
          })
          .where(eq(agentOnboardingProgress.agentId, String(input.agentId)))
          .returning();

        await writeAuditLog({
          agentId: agent.id,
          metadata: { agentCode: input.agentId },
          action: "onboarding_profile_complete",
          resource: "agent_onboarding",
          resourceId: String(agent.id),
          status: "success",
        });

        return progress;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Complete KYC step ─────────────────────────────────────────────────────
  completeKyc: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.agentId, input.agentId))
          .limit(1);
        if (!agent) throw new TRPCError({ code: "NOT_FOUND" });

        // G3 (audit #7): steps are ordered — KYC cannot complete before the
        // profile step genuinely completed.
        const [prog0] = await db
          .select()
          .from(agentOnboardingProgress)
          .where(eq(agentOnboardingProgress.agentId, String(input.agentId)))
          .limit(1);
        if (!prog0?.profileComplete) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Profile step must be completed before KYC",
          });
        }

        // Check if KYC session exists and is approved.
        // G3 (audit #25): approveSession sets status "approved" — the gate
        // previously checked "completed", a value NO writer produces, making
        // the honest path unsatisfiable and pushing operators to the
        // advanceStep bypass. Accept only the real approval signal.
        const [kycSession] = await db
          .select()
          .from(kycSessions)
          .where(
            and(
              eq(kycSessions.agentId, agent.id),
              eq(kycSessions.status, "approved")
            )
          )
          .limit(1);

        if (!kycSession) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "KYC must be completed and approved before proceeding",
          });
        }

        const [progress] = await db
          .update(agentOnboardingProgress)
          .set({
            kycComplete: true,
            currentStep: "float",
            updatedAt: new Date(),
          })
          .where(eq(agentOnboardingProgress.agentId, String(input.agentId)))
          .returning();

        return progress;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Complete float funding step ───────────────────────────────────────────
  completeFloat: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.agentId, input.agentId))
          .limit(1);
        if (!agent) throw new TRPCError({ code: "NOT_FOUND" });

        // G3 (audit #7): float funding requires a genuinely completed KYC
        // step (itself backed by an approved KYC session).
        const [progF] = await db
          .select()
          .from(agentOnboardingProgress)
          .where(eq(agentOnboardingProgress.agentId, String(input.agentId)))
          .limit(1);
        if (!progF?.kycComplete) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "KYC step must be completed before float funding",
          });
        }

        const premiumReserve = parseFloat(agent.premiumReserve as string);
        if (premiumReserve < 10000) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Minimum premium reserve of ₦10,000 required to proceed",
          });
        }

        const [progress] = await db
          .update(agentOnboardingProgress)
          .set({
            floatFunded: true,
            currentStep: "terminal",
            updatedAt: new Date(),
          })
          .where(eq(agentOnboardingProgress.agentId, String(input.agentId)))
          .returning();

        return progress;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Complete terminal assignment step ─────────────────────────────────────
  // G3 (audit #6): hardware assignment is staff-only, requires the float
  // step (which requires approved KYC), and enforces serial uniqueness.
  completeTerminal: adminProcedure
    .input(
      z.object({
        agentId: z.string(),
        terminalSerial: z.string().min(1).max(64),
        terminalModel: z.string().max(64).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [agentT] = await db
          .select()
          .from(agents)
          .where(eq(agents.agentId, input.agentId))
          .limit(1);
        if (!agentT) throw new TRPCError({ code: "NOT_FOUND" });

        const [progT] = await db
          .select()
          .from(agentOnboardingProgress)
          .where(eq(agentOnboardingProgress.agentId, String(input.agentId)))
          .limit(1);
        if (!progT?.floatFunded) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Float step must be completed before terminal assignment",
          });
        }

        // Serial uniqueness (app-layer; DB unique index in migration 0079).
        const [serialTaken] = await db
          .select({ id: agents.id })
          .from(agents)
          .where(eq(agents.terminalSerial, input.terminalSerial))
          .limit(1);
        if (serialTaken && serialTaken.id !== agentT.id) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Terminal serial already assigned to another agent",
          });
        }

        await db
          .update(agents)
          .set({
            terminalSerial: input.terminalSerial,
            terminalModel: input.terminalModel ?? "PAX A920 MAX",
            terminalEnabled: true,
            updatedAt: new Date(),
          })
          .where(eq(agents.agentId, input.agentId));

        const [progress] = await db
          .update(agentOnboardingProgress)
          .set({
            terminalAssigned: true,
            currentStep: "training",
            updatedAt: new Date(),
          })
          .where(eq(agentOnboardingProgress.agentId, String(input.agentId)))
          .returning();

        return progress;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Complete training step and activate agent ─────────────────────────────
  // G3 (audit #4): activation is a staff decision gated on ALL prior steps
  // genuinely complete plus durable verification evidence — previously any
  // authenticated caller could activate any agent with zero prior steps.
  completeTraining: adminProcedure
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.agentId, input.agentId))
          .limit(1);
        if (!agent) throw new TRPCError({ code: "NOT_FOUND" });

        const [prog] = await db
          .select()
          .from(agentOnboardingProgress)
          .where(eq(agentOnboardingProgress.agentId, String(input.agentId)))
          .limit(1);
        if (
          !prog?.profileComplete ||
          !prog.kycComplete ||
          !prog.floatFunded ||
          !prog.terminalAssigned
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "All prior onboarding steps (profile, KYC, float, terminal) must be complete before activation",
          });
        }

        // Durable verification evidence (phone OTP or approved KYC) —
        // fail-closed.
        const evidence = await assertAgentActivationEligible(agent.id);

        // Activate the agent
        await db
          .update(agents)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(agents.agentId, input.agentId));

        await writeAuditLog({
          agentId: agent.id,
          metadata: {
            agentCode: input.agentId,
            actor: `user:${ctx.user?.id}`,
            evidence,
          },
          action: "onboarding_agent_activated",
          resource: "agent_onboarding",
          resourceId: String(agent.id),
          status: "success",
        });

        const [progress] = await db
          .update(agentOnboardingProgress)
          .set({
            trainingComplete: true,
            currentStep: "activated",
            activatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(agentOnboardingProgress.agentId, String(input.agentId)))
          .returning();

        // Send activation email
        if (agent.email) {
          const { subject, html, text } = buildAlertEmail({
            title: "Welcome to InsurePortal POS — Your Account is Active!",
            message: `Congratulations ${agent.name}! Your InsurePortal POS agent account (${input.agentId}) has been fully activated. You can now process transactions on your terminal.`,
            severity: "low",
          });
          enqueueEmail({ to: agent.email, subject, html, text });
        }

        await writeAuditLog({
          agentId: agent.id,
          metadata: { agentCode: input.agentId },
          action: "agent_activated_via_onboarding",
          resource: "agent",
          resourceId: String(agent.id),
          status: "success",
        });

        return progress;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── List all agents in onboarding (admin view) ────────────────────────────
  listPending: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        step: z
          .enum([
            "profile",
            "kyc",
            "float",
            "terminal",
            "training",
            "activated",
          ])
          .optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db || (db as any)._isNoop) return { items: [], total: 0 };
        const offset = (input.page - 1) * input.limit;
        const where = input.step
          ? eq(agentOnboardingProgress.currentStep, input.step)
          : undefined;
        const [items, [{ c: total }]] = await Promise.all([
          db
            .select()
            .from(agentOnboardingProgress)
            .where(where)
            .orderBy(desc(agentOnboardingProgress.createdAt))
            .limit(input.limit)
            .offset(offset),
          db.select({ c: count() }).from(agentOnboardingProgress).where(where),
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

  // ── Add notes to onboarding record ───────────────────────────────────────
  addNote: protectedProcedure
    .input(z.object({ agentId: z.string(), note: z.string().max(1000) }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        await db
          .update(agentOnboardingProgress)
          .set({ notes: input.note, updatedAt: new Date() })
          .where(eq(agentOnboardingProgress.agentId, String(input.agentId)));
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── List all onboarding records with pagination/search ────────────────────
  list: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(15),
        search: z.string().optional(),
        status: z
          .enum(["not_started", "in_progress", "completed", "on_hold"])
          .optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db || (db as any)._isNoop) return { items: [], total: 0 };
        const offset = (input.page - 1) * input.limit;
        const rows = await db
          .select()
          .from(agentOnboardingProgress)
          .orderBy(desc(agentOnboardingProgress.createdAt))
          .limit(input.limit)
          .offset(offset);

        const stepOrder = ["profile", "kyc", "float", "terminal", "training"];
        const items = rows.map((r: any) => {
          const stepNum = stepOrder.indexOf(r.currentStep) + 1;
          const allDone =
            r.profileComplete &&
            r.kycComplete &&
            r.floatFunded &&
            r.terminalAssigned &&
            r.trainingComplete;
          const overallStatus = allDone
            ? "completed"
            : stepNum > 1
              ? "in_progress"
              : "not_started";
          return { ...r, currentStep: stepNum, overallStatus };
        });

        const filtered = input.search
          ? items.filter(
              (i: any) =>
                i.agentId.includes(input.search!) ||
                (i.agentName ?? "")
                  .toLowerCase()
                  .includes(input.search!.toLowerCase())
            )
          : items;
        const statusFiltered = input.status
          ? filtered.filter((i: any) => i.overallStatus === input.status)
          : filtered;
        return {
          items: statusFiltered.slice(0, input.limit),
          total: statusFiltered.length,
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

  // ── Detail: steps breakdown for one agent ────────────────────────────────
  detail: protectedProcedure
    .input(z.object({ agentId: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("Database connection unavailable");
        const [progress] = await db
          .select()
          .from(agentOnboardingProgress)
          .where(eq(agentOnboardingProgress.agentId, String(input.agentId)))
          .limit(1);
        if (!progress) return null;
        const stepDefs = [
          {
            stepNumber: 1,
            name: "profile",
            complete: progress.profileComplete,
          },
          { stepNumber: 2, name: "kyc", complete: progress.kycComplete },
          { stepNumber: 3, name: "float", complete: progress.floatFunded },
          {
            stepNumber: 4,
            name: "terminal",
            complete: progress.terminalAssigned,
          },
          {
            stepNumber: 5,
            name: "training",
            complete: progress.trainingComplete,
          },
        ];
        const currentIdx = stepDefs.findIndex(s => !s.complete);
        const steps = stepDefs.map((s, idx) => ({
          stepNumber: s.stepNumber,
          name: s.name,
          status: s.complete
            ? "completed"
            : idx === currentIdx
              ? "in_progress"
              : "pending",
          notes: idx === currentIdx ? (progress.notes ?? undefined) : undefined,
          completedAt: s.complete ? progress.updatedAt : undefined,
        }));
        return { progress, steps };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Stats ─────────────────────────────────────────────────────────────────
  stats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return { total: 0, inProgress: 0, completed: 0, avgDaysToComplete: null };
    const rows = await db.select().from(agentOnboardingProgress).limit(100);
    const completed = rows.filter(
      (r: any) =>
        r.profileComplete &&
        r.kycComplete &&
        r.floatFunded &&
        r.terminalAssigned &&
        r.trainingComplete
    );
    const inProgress = rows.filter(
      (r: any) =>
        !completed.includes(r) &&
        (r.profileComplete ||
          r.kycComplete ||
          r.floatFunded ||
          r.terminalAssigned)
    );
    const completedWithTime = completed.filter((r: any) => r.activatedAt);
    const avgMs =
      completedWithTime.length > 0
        ? completedWithTime.reduce(
            (sum: any, r: any) =>
              sum + (r.activatedAt!.getTime() - r.createdAt.getTime()),
            0
          ) / completedWithTime.length
        : null;
    return {
      total: rows.length,
      inProgress: inProgress.length,
      completed: completed.length,
      avgDaysToComplete: avgMs ? avgMs / 86400000 : null,
    };
  }),

  // ── Advance a step ────────────────────────────────────────────────────────
  // G3 (audit #5): advanceStep used to flip kycComplete/floatFunded/
  // terminalAssigned/trainingComplete by step NUMBER with zero verification —
  // a complete bypass of every real gate. Those flags are now ONLY settable
  // by their evidence-backed completion endpoints. advanceStep survives as a
  // staff notes/profile-step utility (admin-only) and refuses to forge
  // verified steps.
  advanceStep: adminProcedure
    .input(
      z.object({
        agentId: z.number(),
        stepNumber: z.number().min(1).max(5),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        if (input.stepNumber !== 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Steps 2-5 require evidence: use completeKyc / completeFloat / completeTerminal / completeTraining — advanceStep cannot mark verified steps complete",
          });
        }
        const update: Partial<typeof agentOnboardingProgress.$inferInsert> = {
          profileComplete: true,
          currentStep: "kyc",
        };
        if (input.notes) update.notes = input.notes;
        update.updatedAt = new Date();
        const [updated] = await db
          .update(agentOnboardingProgress)
          .set(update)
          .where(eq(agentOnboardingProgress.agentId, String(input.agentId)))
          .returning();
        await writeAuditLog({
          metadata: { agentCode: String(input.agentId), actor: `user:${ctx.user?.id}`, step: input.stepNumber },
          action: "onboarding_step_advanced",
          resource: "agent_onboarding",
          resourceId: String(input.agentId),
          status: "success",
        });
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

  // ── Initiate onboarding for an agent ─────────────────────────────────────
  initiate: protectedProcedure
    .input(z.object({ agentId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.id, input.agentId))
          .limit(1);
        if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
        // G3 (audit #22): the duplicate check previously queried the NUMERIC
        // PK string while the insert wrote the agent CODE — different
        // keyspaces, so the CONFLICT guard could never fire. Check the same
        // key we insert; the DB unique index (migration 0079) is the race-safe
        // backstop.
        const [existing] = await db
          .select()
          .from(agentOnboardingProgress)
          .where(eq(agentOnboardingProgress.agentId, agent.agentId))
          .limit(1);
        if (existing)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Onboarding already initiated",
          });
        const inserted = await db
          .insert(agentOnboardingProgress)
          .values({
            agentId: agent.agentId,
            currentStep: "profile",
          })
          .onConflictDoNothing()
          .returning();
        if (inserted.length === 0)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Onboarding already initiated",
          });
        return inserted[0];
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
