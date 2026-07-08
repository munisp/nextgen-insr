// @ts-check

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { eq, desc, sql, count, and } from "drizzle-orm";
import {
  workflowDefinitions,
  workflowInstances,
  auditLog,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

export const temporalWorkflowsRouter = router({
  listWorkflows: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(200).default(50),
          status: z
            .enum(["pending", "running", "completed", "failed", "cancelled"])
            .optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const conditions = [];
        if (input?.status)
          conditions.push(eq(workflowInstances.status, input.status));
        const rows =
          conditions.length > 0
            ? await db
                .select()
                .from(workflowInstances)
                .where(and(...conditions))
                .orderBy(desc(workflowInstances.startedAt))
                .limit(input?.limit ?? 50)
            : await db
                .select()
                .from(workflowInstances)
                .orderBy(desc(workflowInstances.startedAt))
                .limit(input?.limit ?? 50);
        return { workflows: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getWorkflow: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [instance] = await db
          .select()
          .from(workflowInstances)
          .where(eq(workflowInstances.id, input.id))
          .limit(1);
        if (!instance) throw new Error("Workflow not found");
        return instance;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  startWorkflow: protectedProcedure
    .input(
      z.object({
        definitionId: z.number(),
        input: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [def] = await db
          .select()
          .from(workflowDefinitions)
          .where(eq(workflowDefinitions.id, input.definitionId))
          .limit(1);
        if (!def) throw new Error("Workflow definition not found");
        const [instance] = await db
          .insert(workflowInstances)
          .values({
            definitionId: input.definitionId,
            status: "running",
            input: input.input ?? {},
          } as any)
          .returning();
        await db.insert(auditLog).values({
          action: "workflow_started",
          resource: "workflow_instances",
          resourceId: String(instance.id),
          status: "success",
          metadata: {
            definitionId: input.definitionId,
            workflowName: def.name,
          },
        });
        return {
          workflowId: instance.id,
          definitionId: input.definitionId,
          status: "running",
          startedAt: instance.startedAt,
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
  cancelWorkflow: protectedProcedure
    .input(z.object({ id: z.number(), reason: z.string().max(500).optional() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .update(workflowInstances)
          .set({ status: "cancelled" })
          .where(eq(workflowInstances.id, input.id));
        await db.insert(auditLog).values({
          action: "workflow_cancelled",
          resource: "workflow_instances",
          resourceId: String(input.id),
          status: "success",
          metadata: { reason: input.reason ?? "manual" },
        });
        return { workflowId: input.id, status: "cancelled" };
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
    const [total] = await db
      .select({ value: count() })
      .from(workflowInstances)
      .limit(100);
    const [running] = await db
      .select({ value: count() })
      .from(workflowInstances)
      .where(eq(workflowInstances.status, "running"))
      .limit(100);
    const [defs] = await db
      .select({ value: count() })
      .from(workflowDefinitions)
      .limit(100);
    return {
      totalInstances: Number(total.value),
      runningInstances: Number(running.value),
      totalDefinitions: Number(defs.value),
    };
  }),

  health: protectedProcedure.query(async () => {
    return { data: [], total: 0 };
  }),

  list: protectedProcedure.query(async () => {
    return { data: [], total: 0 };
  }),

  summary: protectedProcedure.query(async () => {
    return { data: [], total: 0 };
  }),

  terminate: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      return { success: true };
    }),

  workflowTypes: protectedProcedure.query(async () => {
    return { data: [], total: 0 };
  }),
});
