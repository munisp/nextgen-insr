import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { eq, desc, and, sql, count, gte } from "drizzle-orm";
import {
  agents,
  kycSessions,
  premiumTopUpRequests,
  posTerminals,
  trainingEnrollments,
  auditLog,
} from "@schema";
import { TRPCError } from "@trpc/server";

export const agentOnboardingWizardRouter = router({
  getProgress: protectedProcedure
    .input(z.object({ agentId: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.id, input.agentId))
          .limit(1);
        if (!agent)
          return { step: 0, steps: [], completedSteps: 0, totalSteps: 5 };
        const [kyc] = await db
          .select({ cnt: count() })
          .from(kycSessions)
          .where(
            and(
              eq(kycSessions.agentId, input.agentId),
              eq(kycSessions.status, "completed")
            )
          )
          .limit(100);
        const [floatReq] = await db
          .select({ cnt: count() })
          .from(premiumTopUpRequests)
          .where(eq(premiumTopUpRequests.agentId, input.agentId))
          .limit(100);
        const [terminal] = await db
          .select({ cnt: count() })
          .from(posTerminals)
          .where(eq(posTerminals.agentId, input.agentId))
          .limit(100);
        const [training] = await db
          .select({ cnt: count() })
          .from(trainingEnrollments)
          .where(eq(trainingEnrollments.agentId, input.agentId))
          .limit(100);
        const steps = [
          { name: "Profile", completed: !!agent.name, order: 1 },
          {
            name: "KYC Verification",
            completed: Number(kyc.cnt) > 0,
            order: 2,
          },
          {
            name: "Float Setup",
            completed: Number(floatReq.cnt) > 0,
            order: 3,
          },
          {
            name: "Terminal Assignment",
            completed: Number(terminal.cnt) > 0,
            order: 4,
          },
          { name: "Training", completed: Number(training.cnt) > 0, order: 5 },
        ];
        const completedSteps = steps.filter(s => s.completed).length;
        const currentStep = steps.find(s => !s.completed)?.order ?? 5;
        return {
          step: currentStep,
          steps,
          completedSteps,
          totalSteps: 5,
          agentName: agent.name,
          status: completedSteps === 5 ? "completed" : "in_progress",
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
  listPendingAgents: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(agents)
          .where(eq(agents.isActive, false))
          .orderBy(desc(agents.createdAt))
          .limit(input?.limit ?? 50);
        return { agents: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getStats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [total] = await db.select({ value: count() }).from(agents).limit(100);
    const [active] = await db
      .select({ value: count() })
      .from(agents)
      .where(eq(agents.isActive, true))
      .limit(100);
    const [pending] = await db
      .select({ value: count() })
      .from(agents)
      .where(eq(agents.isActive, false))
      .limit(100);
    return {
      totalAgents: Number(total.value),
      activeAgents: Number(active.value),
      pendingOnboarding: Number(pending.value),
      completionRate:
        Number(total.value) > 0
          ? Math.round((Number(active.value) / Number(total.value)) * 100)
          : 0,
    };
  }),
  approveAgent: protectedProcedure
    .input(z.object({ agentId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .update(agents)
          .set({ isActive: true })
          .where(eq(agents.id, input.agentId));
        await db.insert(auditLog).values({
          action: "agent_onboarding_approved",
          resource: "agents",
          resourceId: String(input.agentId),
          status: "success",
          metadata: {},
        });
        return { success: true, agentId: input.agentId };
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
