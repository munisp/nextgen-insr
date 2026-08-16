/**
 * j20SchedulerRouter.ts
 *
 * tRPC router for managing J20 Platform Health & SLA schedules.
 * Exposes schedule creation, toggling, status, and report generation.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import {
  createJ20Schedule,
  toggleJ20Schedule,
  getJ20ScheduleStatus,
  generateJ20PdfReport,
  sendJ20Notification,
  J20_SCHEDULES,
  bootstrapJ20Schedules,
} from "../j20-scheduler";
import { getTemporalClient } from "../temporal";

export const j20SchedulerRouter = router({

  /** Get status of all J20 schedules */
  getScheduleStatus: protectedProcedure.query(async () => {
    return getJ20ScheduleStatus();
  }),

  /** Get all available schedule configurations */
  getScheduleConfigs: protectedProcedure.query(() => {
    return Object.entries(J20_SCHEDULES).map(([key, config]) => ({
      key,
      scheduleId: config.scheduleId,
      cronExpression: config.cronExpression,
      description: config.description,
      generatePdf: config.generatePdf,
      notifySlack: config.notifySlack,
      notifyEmail: config.notifyEmail,
    }));
  }),

  /** Create a J20 schedule */
  createSchedule: adminProcedure
    .input(z.object({
      scheduleKey: z.enum(["OPS_PROBE", "HOURLY_SLA", "DAILY_EXECUTIVE"]),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        return createJ20Schedule(input.scheduleKey, ctx.user.id);
      } catch (err: unknown) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: (err as Error).message,
        });
      }
    }),

  /** Bootstrap all default J20 schedules */
  bootstrapAllSchedules: adminProcedure.mutation(async () => {
    try {
      await bootstrapJ20Schedules();
      return { success: true, message: "All J20 schedules bootstrapped" };
    } catch (err: unknown) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: (err as Error).message,
      });
    }
  }),

  /** Pause or resume a J20 schedule */
  toggleSchedule: adminProcedure
    .input(z.object({
      scheduleId: z.string(),
      enabled: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      try {
        return toggleJ20Schedule(input.scheduleId, input.enabled);
      } catch (err: unknown) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: (err as Error).message,
        });
      }
    }),

  /** Trigger J20 immediately (manual run) */
  triggerNow: protectedProcedure
    .input(z.object({
      includeAllServices: z.boolean().default(true),
      generateReport: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const temporal = await getTemporalClient();
      if (!temporal) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Temporal client unavailable" });
      const workflowId = `J20-manual-${Date.now()}-u${ctx.user.id}`;

      await temporal.workflow.start("J20_PlatformHealthMonitoringWorkflow", {
        taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? "insureportal-journeys",
        workflowId,
        args: [{
          triggeredBy: ctx.user.id,
          idempotencyKey: workflowId,
          scheduled: false,
        }],
      });

      return { success: true, workflowId, message: "J20 health check triggered" };
    }),

  /** Generate PDF report for a completed J20 execution */
  generateReport: protectedProcedure
    .input(z.object({ workflowId: z.string() }))
    .mutation(async ({ input }) => {
      try {
        return generateJ20PdfReport(input.workflowId);
      } catch (err: unknown) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: (err as Error).message,
        });
      }
    }),

  /** Send health notification manually */
  sendNotification: adminProcedure
    .input(z.object({
      workflowId: z.string(),
      channels: z.object({
        slack: z.boolean().default(true),
        email: z.boolean().default(false),
      }),
    }))
    .mutation(async ({ input }) => {
      // Get execution result
      const { getDb } = await import("../db");
      const { journeyExecutions } = await import("../../drizzle/schema.journeys");
      const { eq } = await import("drizzle-orm");

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const exec = await db.select().from(journeyExecutions)
        .where(eq(journeyExecutions.workflowId, input.workflowId))
        .limit(1);

      if (!exec.length) throw new TRPCError({ code: "NOT_FOUND", message: "Execution not found" });

      const result = exec[0].resultSnapshot as Record<string, unknown> | null;

      await sendJ20Notification({
        workflowId: input.workflowId,
        overallStatus: result?.overallStatus as string ?? "unknown",
        slaBreaches: result?.slaBreaches as Array<{ service: string; metric: string; threshold: number; actual: number }> ?? [],
        channels: input.channels,
      });

      return { success: true };
    }),

  /** Get last N J20 execution results */
  getRecentResults: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const { journeyExecutions } = await import("../../drizzle/schema.journeys");
      const { eq, desc } = await import("drizzle-orm");

      const db = await getDb();
      if (!db) return [];

      return db.select().from(journeyExecutions)
        .where(eq(journeyExecutions.journeyId, "J20"))
        .orderBy(desc(journeyExecutions.startedAt))
        .limit(input.limit);
    }),
});
