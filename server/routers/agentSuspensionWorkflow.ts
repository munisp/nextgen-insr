// Sprint 87: Regenerated — agentSuspensionWorkflow with real DB queries
import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { z } from "zod";

import { agentSuspensionLog, agents } from "../../drizzle/schema";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  assertAgentActivationEligible,
  deactivateAgentCascade,
  reactivateAgent,
  writeSuspensionLog,
} from "../lib/agentLifecycle";

const list = protectedProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
    })
  )
  .query(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const lim = input.limit ?? 10;
      const offset = ((input.page ?? 1) - 1) * lim;
      const rows = await db
        .select()
        .from(agentSuspensionLog)
        .orderBy(desc(agentSuspensionLog.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(agentSuspensionLog)
        .limit(100);
      return { items: rows, total, page: input.page ?? 1, limit: lim };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
// G3 (audit #14): implemented for real — admin-only, full deactivation
// cascade (tokens revoked, sockets dropped, float locked, terminal disabled)
// plus a durable agent_suspension_log row. Fails closed on any store error.
const suspend = adminProcedure
  .input(
    z.object({
      id: z.number().optional(),
      data: z.record(z.string(), z.any()).optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    const agentPk = input.id ?? Number(input.data?.agentId);
    const reason =
      (typeof input.data?.reason === "string" && input.data.reason) ||
      "Suspended via suspension workflow";
    if (!Number.isFinite(agentPk) || agentPk <= 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "id (agent PK) is required",
      });
    }
    const db = (await getDb())!;
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentPk))
      .limit(1);
    if (!agent || agent.deletedAt) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
    }
    if (agent.id === ctx.user?.id) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot suspend your own account",
      });
    }
    const previousStatus = agent.isActive ? "active" : "suspended";
    if (agent.isActive) {
      await deactivateAgentCascade({
        agentPk: agent.id,
        agentCode: agent.agentId,
        reason,
        actor: { id: ctx.user?.id, label: `user:${ctx.user?.id}` },
        action: "AGENT_SUSPENDED",
      });
    }
    await writeSuspensionLog({
      agentPk: agent.id,
      action: "suspend",
      reason,
      performedBy: ctx.user?.id ?? 0,
      previousStatus,
      newStatus: "suspended",
    });
    return { success: true, agentId: agent.id, status: "suspended" };
  });
// G3 (audit #14): lift reactivates for real — gated on verification
// evidence, and deliberately does NOT unlock float/terminal (those need
// explicit admin unlocks). Durable agent_suspension_log row.
const lift = adminProcedure
  .input(
    z.object({
      id: z.number().optional(),
      data: z.record(z.string(), z.any()).optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    const agentPk = input.id ?? Number(input.data?.agentId);
    const reason =
      (typeof input.data?.reason === "string" && input.data.reason) ||
      "Suspension lifted via suspension workflow";
    if (!Number.isFinite(agentPk) || agentPk <= 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "id (agent PK) is required",
      });
    }
    const db = (await getDb())!;
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentPk))
      .limit(1);
    if (!agent || agent.deletedAt) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
    }
    const previousStatus = agent.isActive ? "active" : "suspended";
    if (!agent.isActive) {
      // Fail-closed: no verification evidence, no reinstatement.
      await assertAgentActivationEligible(agent.id);
      await reactivateAgent({
        agentPk: agent.id,
        agentCode: agent.agentId,
        actor: { id: ctx.user?.id, label: `user:${ctx.user?.id}` },
        action: "AGENT_ACTIVATED",
      });
    }
    await writeSuspensionLog({
      agentPk: agent.id,
      action: "reactivate",
      reason,
      performedBy: ctx.user?.id ?? 0,
      previousStatus,
      newStatus: "active",
    });
    return { success: true, agentId: agent.id, status: "active" };
  });

// F-12 (wave-4b): escalate restored (dropped by the round-57 assembly
// restore — runtime ReferenceError in contract tests). Fail loud.
const escalate = protectedProcedure
  .input(
    z.object({
      id: z.number().optional(),
      data: z.record(z.string(), z.any()).optional(),
    })
  )
  .mutation(() => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "escalate: no escalation store",
    });
  });

const getStats = protectedProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    })
  )
  .query(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const [{ total }] = await db
        .select({ total: count() })
        .from(agentSuspensionLog)
        .limit(100);
      const recent = await db
        .select()
        .from(agentSuspensionLog)
        .orderBy(desc(agentSuspensionLog.id))
        .limit(5);
      return {
        totalRecords: total,
        recentItems: recent,
        summary: { active: total, lastUpdated: new Date().toISOString() },
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });

export const agentSuspensionWorkflowRouter = router({
  list,
  suspend,
  lift,
  escalate,
  getStats,
});
