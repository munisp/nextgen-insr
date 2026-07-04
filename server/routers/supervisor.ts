// @ts-check
/**
 * Supervisor Router — read-only view of assigned agents for supervisors
 *
 * Role: supervisor (read-only across assigned agents)
 * Admin can also call all procedures.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  agents,
  transactions,
  supervisorAgents,
  users,
  fraudAlerts,
} from "../../drizzle/schema";
import { eq, desc, and, sql, gte } from "drizzle-orm";

async function requireDb() {
  const db = (await getDb())!;
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database unavailable",
    });
  return db!;
}

// Supervisor or admin guard
const supervisorProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "supervisor" && ctx.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Supervisor access required",
    });
  }
  return next({ ctx });
});

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
  return next({ ctx });
});

export const supervisorRouter = router({
  // Get current user's supervisor profile and assigned agent IDs
  myProfile: supervisorProcedure.input(z.object({})).query(async ({ ctx }) => {
    try {
      const db = await requireDb();
      const assignments = await db
        .select({ agentId: supervisorAgents.agentId })
        .from(supervisorAgents)
        .where(eq(supervisorAgents.supervisorUserId, ctx.user.id));

      return {
        userId: ctx.user.id,
        name: ctx.user.name,
        email: ctx.user.email,
        assignedAgentIds: assignments.map(a => a.agentId),
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

  // Get assigned agents with premium reserve and 7-day transaction summary
  myAgents: supervisorProcedure.input(z.object({})).query(async ({ ctx }) => {
    try {
      const db = await requireDb();
      const assignments = await db
        .select({ agentId: supervisorAgents.agentId })
        .from(supervisorAgents)
        .where(eq(supervisorAgents.supervisorUserId, ctx.user.id));

      if (assignments.length === 0) return [];

      const agentIds = assignments.map(a => a.agentId);
      const agentRows = await db
        .select()
        .from(agents)
        .where(
          sql`${agents.id} = ANY(ARRAY[${sql.join(
            agentIds.map(id => sql`${id}`),
            sql`, `
          )}]::int[])`
        );

      // 7-day transaction stats per agent
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const stats = await db
        .select({
          agentId: transactions.agentId,
          txCount: sql<number>`count(*)::int`,
          totalVolume: sql<number>`coalesce(sum(${transactions.amount}), 0)::numeric`,
          successCount: sql<number>`count(*) filter (where ${transactions.status} = 'completed')::int`,
        })
        .from(transactions)
        .where(
          and(
            sql`${transactions.agentId} = ANY(ARRAY[${sql.join(
              agentIds.map(id => sql`${id}`),
              sql`, `
            )}]::int[])`,
            gte(transactions.createdAt, since)
          )
        )
        .groupBy(transactions.agentId);

      const statsMap = new Map(stats.map(s => [s.agentId, s]));

      return agentRows.map(agent => {
        const s = statsMap.get(agent.id);
        return {
          ...agent,
          txCount7d: s?.txCount ?? 0,
          totalVolume7d: Number(s?.totalVolume ?? 0),
          successRate7d:
            s && s.txCount > 0
              ? Math.round((s.successCount / s.txCount) * 100)
              : null,
        };
      });
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  // Get recent transactions for a specific assigned agent
  agentTransactions: supervisorProcedure
    .input(
      z.object({
        agentId: z.number(),
        limit: z.number().min(1).max(100).default(30),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const db = await requireDb();
        // Verify assignment (admins bypass) — throws FORBIDDEN if not assigned
        if (ctx.user.role !== "admin") {
          // role-check: throw below
          const [assignment] = await db
            .select()
            .from(supervisorAgents)
            .where(
              and(
                eq(supervisorAgents.supervisorUserId, ctx.user.id),
                eq(supervisorAgents.agentId, input.agentId)
              )
            );
          if (!assignment)
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Agent not assigned to you",
            });
        }

        return db
          .select()
          .from(transactions)
          .where(eq(transactions.agentId, input.agentId))
          .orderBy(desc(transactions.createdAt))
          .limit(input.limit);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Get active fraud alerts for assigned agents
  myAlerts: supervisorProcedure.input(z.object({})).query(async ({ ctx }) => {
    try {
      const db = await requireDb();
      const assignments = await db
        .select({ agentId: supervisorAgents.agentId })
        .from(supervisorAgents)
        .where(eq(supervisorAgents.supervisorUserId, ctx.user.id));

      if (assignments.length === 0) return [];
      const agentIds = assignments.map(a => a.agentId);

      return db
        .select()
        .from(fraudAlerts)
        .where(
          and(
            sql`${fraudAlerts.agentId} = ANY(ARRAY[${sql.join(
              agentIds.map(id => sql`${id}`),
              sql`, `
            )}]::int[])`,
            sql`${fraudAlerts.status} = 'active'`
          )
        )
        .orderBy(desc(fraudAlerts.createdAt))
        .limit(50);
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  // ── Admin: manage supervisor assignments ─────────────────────────────────

  listSupervisors: adminProcedure.input(z.object({})).query(async () => {
    const db = await requireDb();
    return db
      .select()
      .from(users)
      .where(eq(users.role, "supervisor"))
      .limit(100);
  }),

  assignAgent: adminProcedure
    .input(
      z.object({
        supervisorUserId: z.number().optional(),
        supervisorCode: z.string().optional(),
        agentId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await requireDb();
        let supervisorUserId = input.supervisorUserId;
        // Resolve supervisorCode → agent row id if code provided
        if (!supervisorUserId && input.supervisorCode) {
          const [supAgent] = await db
            .select({ id: agents.id, role: agents.role })
            .from(agents)
            .where(eq(agents.agentId, input.supervisorCode))
            .limit(1);
          if (!supAgent)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: `Supervisor with code ${input.supervisorCode} not found`,
            });
          if (supAgent.role !== "supervisor" && supAgent.role !== "admin") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Agent ${input.supervisorCode} is not a supervisor`,
            });
          }
          supervisorUserId = supAgent.id;
        }
        if (!supervisorUserId)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "supervisorUserId or supervisorCode required",
          });
        // Idempotent insert
        const existing = await db
          .select()
          .from(supervisorAgents)
          .where(
            and(
              eq(supervisorAgents.supervisorUserId, supervisorUserId),
              eq(supervisorAgents.agentId, input.agentId)
            )
          );
        if (existing.length > 0) return { ok: true, alreadyAssigned: true };

        await db.insert(supervisorAgents).values({
          supervisorUserId,
          agentId: input.agentId,
        });
        return { ok: true, alreadyAssigned: false };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  unassignAgent: adminProcedure
    .input(
      z.object({
        supervisorUserId: z.number(),
        agentId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await requireDb();
        await db
          .delete(supervisorAgents)
          .where(
            and(
              eq(supervisorAgents.supervisorUserId, input.supervisorUserId),
              eq(supervisorAgents.agentId, input.agentId)
            )
          );
        return { ok: true };
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
