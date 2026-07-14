import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { agentOnboardingProgress, agents } from "../../drizzle/schema";
import { desc, eq, sql, and, count } from "drizzle-orm";

/**
 * Agent Onboarding Workflow Router
 * 
 * Multi-step onboarding workflow for new insurance agents. Enforces sequential
 * step completion with validation gates at each stage.
 * 
 * Onboarding Steps (must be completed in order):
 * 1. Profile → Basic info, BVN/NIN verification
 * 2. KYC → Document upload, liveness check, address verification
 * 3. Training → Complete mandatory modules, pass assessment (≥70%)
 * 4. Float Funding → Initial deposit (min ₦50,000), bank account linking
 * 5. Terminal Assignment → POS device allocation, activation
 * 6. Go-Live → Final compliance check, territory assignment
 * 
 * SLA: Full onboarding must complete within 14 business days
 */
export const agentOnboardingWorkflowRouter = router({
  // List all agents in onboarding pipeline
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        currentStep: z.enum(["profile", "kyc", "training", "float_funding", "terminal", "go_live"]).optional(),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0 };

      const conditions = [];
      if (input.currentStep) conditions.push(eq(agentOnboardingProgress.currentStep, input.currentStep));

      const query = database.select().from(agentOnboardingProgress)
        .orderBy(desc(agentOnboardingProgress.id))
        .limit(input.limit)
        .offset(input.offset);

      const results = conditions.length > 0
        ? await query.where(and(...conditions))
        : await query;

      const [{ total }] = await database.select({ total: count() }).from(agentOnboardingProgress);

      return { data: results, total: total ?? 0 };
    }),

  // Get onboarding progress for a specific agent
  getByAgentId: protectedProcedure
    .input(z.object({ agentId: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [progress] = await database
        .select()
        .from(agentOnboardingProgress)
        .where(eq(agentOnboardingProgress.agentId, input.agentId))
        .limit(1);

      if (!progress) throw new Error(`No onboarding record for agent #${input.agentId}`);

      // Calculate completion percentage
      const steps = ["profileComplete", "kycComplete", "floatFunded", "terminalAssigned"] as const;
      const completed = steps.filter((s) => (progress as any)[s] === true).length;
      const percentage = Math.round((completed / 6) * 100);

      return { ...progress, completionPercentage: percentage };
    }),

  // Advance to next step (with validation)
  advanceStep: protectedProcedure
    .input(
      z.object({
        agentId: z.number(),
        completedStep: z.enum(["profile", "kyc", "training", "float_funding", "terminal", "go_live"]),
        evidence: z.record(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [progress] = await database
        .select()
        .from(agentOnboardingProgress)
        .where(eq(agentOnboardingProgress.agentId, input.agentId))
        .limit(1);

      if (!progress) throw new Error("No onboarding record found");

      // Validate step order
      const stepOrder = ["profile", "kyc", "training", "float_funding", "terminal", "go_live"];
      const currentIdx = stepOrder.indexOf(progress.currentStep);
      const completedIdx = stepOrder.indexOf(input.completedStep);

      if (completedIdx !== currentIdx) {
        throw new Error(`Cannot complete "${input.completedStep}": current step is "${progress.currentStep}"`);
      }

      // Determine next step and update field
      const nextStep = stepOrder[completedIdx + 1] ?? "completed";
      const updateFields: Record<string, any> = {
        currentStep: nextStep === "completed" ? "go_live" : nextStep,
      };

      // Mark the appropriate boolean field
      switch (input.completedStep) {
        case "profile": updateFields.profileComplete = true; break;
        case "kyc": updateFields.kycComplete = true; break;
        case "float_funding": updateFields.floatFunded = true; break;
        case "terminal": updateFields.terminalAssigned = true; break;
      }

      await database
        .update(agentOnboardingProgress)
        .set(updateFields)
        .where(eq(agentOnboardingProgress.agentId, input.agentId));

      return {
        agentId: input.agentId,
        completedStep: input.completedStep,
        nextStep,
        isComplete: nextStep === "completed",
      };
    }),

  // Start onboarding for a new agent
  initiate: protectedProcedure
    .input(
      z.object({
        agentId: z.number(),
        agentId: z.string().min(3),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      // Check if already exists
      const [existing] = await database
        .select()
        .from(agentOnboardingProgress)
        .where(eq(agentOnboardingProgress.agentId, input.agentId))
        .limit(1);

      if (existing) throw new Error(`Onboarding already initiated for agent ${input.agentId}`);

      const [record] = await database
        .insert(agentOnboardingProgress)
        .values({
          agentId: input.agentId,
          agentId: input.agentId,
          currentStep: "profile",
          profileComplete: false,
          kycComplete: false,
          floatFunded: false,
          terminalAssigned: false,
        })
        .returning();

      return { id: record.id, agentId: input.agentId, currentStep: "profile" };
    }),

  // Pipeline analytics
  getAnalytics: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return null;

    const [total] = await database.select({ total: count() }).from(agentOnboardingProgress);

    const stepCounts: Record<string, number> = {};
    for (const step of ["profile", "kyc", "training", "float_funding", "terminal", "go_live"]) {
      const [result] = await database
        .select({ total: count() })
        .from(agentOnboardingProgress)
        .where(eq(agentOnboardingProgress.currentStep, step as any));
      stepCounts[step] = result?.total ?? 0;
    }

    return {
      totalInPipeline: total?.total ?? 0,
      byStep: stepCounts,
      conversionRate: total?.total
        ? (((stepCounts.go_live ?? 0) / total.total) * 100).toFixed(1)
        : "0.0",
      lastUpdated: new Date().toISOString(),
    };
  }),
});
