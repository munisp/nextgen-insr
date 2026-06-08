/**
 * Agent Onboarding Router
 * 5-step wizard: Profile → KYC → Float → Terminal → Training → Activated
 * Tracks progress in agent_onboarding_progress table.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  agentOnboardingProgress,
  agents,
  kycSessions,
  floatTopUpRequests,
} from "../../drizzle/schema";
import { eq, desc, count, and } from "drizzle-orm";
import { writeAuditLog } from "../db";
import { enqueueEmail, buildAlertEmail } from "../lib/emailQueue";

export const agentOnboardingRouter = router({
  // ── Get onboarding progress for an agent ─────────────────────────────────
  getProgress: protectedProcedure
    .input(z.object({ agentCode: z.string() }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("Database connection unavailable");

        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.agentCode, input.agentCode))
          .limit(1);
        if (!agent) return null;

        const [progress] = await db
          .select()
          .from(agentOnboardingProgress)
          .where(eq(agentOnboardingProgress.agentId, agent.id))
          .limit(1);

        if (!progress) {
          // Auto-create progress record
          const [created] = await db
            .insert(agentOnboardingProgress)
            .values({
              agentId: agent.id,
              agentCode: input.agentCode,
              currentStep: "profile",
            })
            .returning();
          return { ...created, agent };
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
        agentCode: z.string(),
        name: z.string().min(2).max(128),
        phone: z.string().min(11).max(20),
        email: z.string().email().optional(),
        location: z.string().max(128).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.agentCode, input.agentCode))
          .limit(1);
        if (!agent) throw new TRPCError({ code: "NOT_FOUND" });

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
          .where(eq(agents.agentCode, input.agentCode));

        // Update onboarding progress
        const [progress] = await db
          .update(agentOnboardingProgress)
          .set({
            profileComplete: true,
            currentStep: "kyc",
            updatedAt: new Date(),
          })
          .where(eq(agentOnboardingProgress.agentCode, input.agentCode))
          .returning();

        await writeAuditLog({
          agentId: agent.id,
          agentCode: input.agentCode,
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
    .input(z.object({ agentCode: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.agentCode, input.agentCode))
          .limit(1);
        if (!agent) throw new TRPCError({ code: "NOT_FOUND" });

        // Check if KYC session exists and is approved
        const [kycSession] = await db
          .select()
          .from(kycSessions)
          .where(
            and(
              eq(kycSessions.agentId, agent.id),
              eq(kycSessions.status, "completed")
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
          .where(eq(agentOnboardingProgress.agentCode, input.agentCode))
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
    .input(z.object({ agentCode: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.agentCode, input.agentCode))
          .limit(1);
        if (!agent) throw new TRPCError({ code: "NOT_FOUND" });

        const floatBalance = parseFloat(agent.floatBalance as string);
        if (floatBalance < 10000) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Minimum float balance of ₦10,000 required to proceed",
          });
        }

        const [progress] = await db
          .update(agentOnboardingProgress)
          .set({
            floatFunded: true,
            currentStep: "terminal",
            updatedAt: new Date(),
          })
          .where(eq(agentOnboardingProgress.agentCode, input.agentCode))
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
  completeTerminal: protectedProcedure
    .input(
      z.object({
        agentCode: z.string(),
        terminalSerial: z.string().min(1).max(64),
        terminalModel: z.string().max(64).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await db
          .update(agents)
          .set({
            terminalSerial: input.terminalSerial,
            terminalModel: input.terminalModel ?? "PAX A920 MAX",
            terminalEnabled: true,
            updatedAt: new Date(),
          })
          .where(eq(agents.agentCode, input.agentCode));

        const [progress] = await db
          .update(agentOnboardingProgress)
          .set({
            terminalAssigned: true,
            currentStep: "training",
            updatedAt: new Date(),
          })
          .where(eq(agentOnboardingProgress.agentCode, input.agentCode))
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
  completeTraining: protectedProcedure
    .input(z.object({ agentCode: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.agentCode, input.agentCode))
          .limit(1);
        if (!agent) throw new TRPCError({ code: "NOT_FOUND" });

        // Activate the agent
        await db
          .update(agents)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(agents.agentCode, input.agentCode));

        const [progress] = await db
          .update(agentOnboardingProgress)
          .set({
            trainingComplete: true,
            currentStep: "activated",
            activatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(agentOnboardingProgress.agentCode, input.agentCode))
          .returning();

        // Send activation email
        if (agent.email) {
          const { subject, html, text } = buildAlertEmail({
            title: "Welcome to InsurePortal — Your Account is Active!",
            message: `Congratulations ${agent.name}! Your InsurePortal agent account (${input.agentCode}) has been fully activated. You can now process transactions on your terminal.`,
            severity: "low",
          });
          enqueueEmail({ to: agent.email, subject, html, text });
        }

        await writeAuditLog({
          agentId: agent.id,
          agentCode: input.agentCode,
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
    .input(z.object({ agentCode: z.string(), note: z.string().max(1000) }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        await db
          .update(agentOnboardingProgress)
          .set({ notes: input.note, updatedAt: new Date() })
          .where(eq(agentOnboardingProgress.agentCode, input.agentCode));
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
                i.agentCode.includes(input.search!) ||
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
          .where(eq(agentOnboardingProgress.agentId, input.agentId))
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
  advanceStep: protectedProcedure
    .input(
      z.object({
        agentId: z.number(),
        stepNumber: z.number().min(1).max(5),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const stepFields: Record<
          number,
          Partial<typeof agentOnboardingProgress.$inferInsert>
        > = {
          1: { profileComplete: true, currentStep: "kyc" },
          2: { kycComplete: true, currentStep: "float" },
          3: { floatFunded: true, currentStep: "terminal" },
          4: { terminalAssigned: true, currentStep: "training" },
          5: { trainingComplete: true, activatedAt: new Date() },
        };
        const update = stepFields[input.stepNumber];
        if (!update)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid step number",
          });
        if (input.notes) update.notes = input.notes;
        update.updatedAt = new Date();
        const [updated] = await db
          .update(agentOnboardingProgress)
          .set(update)
          .where(eq(agentOnboardingProgress.agentId, input.agentId))
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
        const [existing] = await db
          .select()
          .from(agentOnboardingProgress)
          .where(eq(agentOnboardingProgress.agentId, input.agentId))
          .limit(1);
        if (existing)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Onboarding already initiated",
          });
        const [record] = await db
          .insert(agentOnboardingProgress)
          .values({
            agentId: agent.id,
            agentCode: agent.agentCode,
            currentStep: "profile",
          })
          .returning();
        return record;
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
