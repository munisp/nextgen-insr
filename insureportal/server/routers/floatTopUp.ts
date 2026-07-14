/**
 * premiumTopUp router — agent-facing procedures for submitting float top-up requests.
 *
 * Phase 48: Float top-up requests > ₦50,000 require supervisor approval
 * before admin can credit the agent's float.
 *
 * Approval flow:
 *  1. Agent submits request → supervisorApprovalRequired=true if amount > ₦50,000
 *  2. Supervisor (assigned to that agent) approves via supervisor.approveFloatTopUp
 *  3. Admin then credits the float via agentMgmt.approveTopUp (unchanged)
 *  4. Admin can override-approve any top-up regardless of supervisor approval status
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "../db";
import {
  premiumTopUpRequests,
  agents,
  supervisorAgents,
} from "@schema";
import { eq, desc, and } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getAgentFromCookie } from "../middleware/agentAuth";
import { writeAuditLog } from "../db";
import { floatTopupRequestsTotal } from "../metrics";
// ── Middleware Integration (Sprint 44) ──────────────────────────────
import { publishEvent, type KafkaTopic } from "../kafkaClient";
import { cacheSet, cacheGet } from "../redisClient";
import { tbCreateTransfer } from "../tbClient";
import { fluvioProduce } from "../fluvio";
import { permifyCheck } from "../_core/permify";

const SUPERVISOR_APPROVAL_THRESHOLD = 50_000;

export const premiumTopUpRouter = router({
  // ── Submit a top-up request ───────────────────────────────────────────────
  submit: protectedProcedure
    .input(
      z.object({
        amount: z.number().positive().max(10_000_000),
        notes: z.string().max(256).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });

        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        // Check for existing pending request
        const existing = await db
          .select()
          .from(premiumTopUpRequests)
          .where(eq(premiumTopUpRequests.agentId, session.id))
          .orderBy(desc(premiumTopUpRequests.createdAt))
          .limit(1);
        if (existing[0] && existing[0].status === "pending") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "You already have a pending top-up request. Please wait for approval.",
          });
        }

        // Phase 48: determine if supervisor approval is required
        const requiresSupervisor = input.amount > SUPERVISOR_APPROVAL_THRESHOLD;

        const result = await db
          .insert(premiumTopUpRequests)
          .values({
            agentId: session.id,
            requestedAmount: String(input.amount),
            status: "pending",
            notes: input.notes ?? null,
            supervisorApprovalRequired: requiresSupervisor,
          })
          .returning();

        await writeAuditLog({
          agentId: session.id,
          action: "FLOAT_TOPUP_REQUESTED",
          resource: "float_topup",
          resourceId: String(result[0].id),
          status: "success",
          metadata: { amount: input.amount, requiresSupervisor },
        });

        // Notify supervisor(s) assigned to this agent if threshold exceeded
        if (requiresSupervisor) {
          try {
            const { notifyOwner } = await import("../_core/notification");
            await notifyOwner({
              title: `Large Float Top-Up Requires Supervisor Approval — ₦${input.amount.toLocaleString()}`,
              content: `Agent ${session.agentId} (${session.name}) has requested a float top-up of ₦${input.amount.toLocaleString()} (above ₦${SUPERVISOR_APPROVAL_THRESHOLD.toLocaleString()} threshold). Please review in the Supervisor Dashboard → Pending Float Approvals.`,
            });
          } catch {
            // Non-critical
          }
        }

        floatTopupRequestsTotal.labels("submitted").inc();

        return {
          success: true,
          requestId: result[0].id,
          requiresSupervisorApproval: requiresSupervisor,
          message: requiresSupervisor
            ? `Top-up request submitted. Supervisor approval required for amounts above ₦${SUPERVISOR_APPROVAL_THRESHOLD.toLocaleString()}.`
            : "Top-up request submitted. Awaiting admin approval.",
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

  // ── List agent's own requests ─────────────────────────────────────────────
  myRequests: protectedProcedure.query(async ({ ctx }) => {
    try {
      const session = await getAgentFromCookie(ctx.req);
      if (!session)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Agent session required",
        });
      const db = (await getDb())!;
      if (!db) throw new Error("Database connection unavailable");
      const rows = await db
        .select()
        .from(premiumTopUpRequests)
        .where(eq(premiumTopUpRequests.agentId, session.id))
        .orderBy(desc(premiumTopUpRequests.createdAt))
        .limit(20);
      return rows.map((r: any) => ({
        ...r,
        requestedAmount: Number(r.requestedAmount),
      }));
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  // ── Supervisor: list pending large top-ups for assigned agents ────────────
  supervisorPendingTopUps: protectedProcedure.query(async ({ ctx }) => {
    try {
      const session = await getAgentFromCookie(ctx.req);
      if (!session)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Agent session required",
        });
      if (session.role !== "supervisor" && session.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Supervisor or admin privileges required",
        });
      }

      const db = (await getDb())!;
      if (!db) throw new Error("Database connection unavailable");

      // For supervisors: only show top-ups for their assigned agents
      // For admins: show all supervisor-required top-ups
      let agentIds: number[] = [];
      if (session.role === "supervisor") {
        const assignments = await db
          .select({ agentId: supervisorAgents.agentId })
          .from(supervisorAgents)
          .where(eq(supervisorAgents.supervisorUserId, session.id));
        agentIds = assignments.map((a: any) => a.agentId);
        if (agentIds.length === 0) return [];
      }

      const rows = await db
        .select({
          id: premiumTopUpRequests.id,
          agentId: premiumTopUpRequests.agentId,
          requestedAmount: premiumTopUpRequests.requestedAmount,
          status: premiumTopUpRequests.status,
          supervisorApprovalRequired:
            premiumTopUpRequests.supervisorApprovalRequired,
          supervisorApprovedBy: premiumTopUpRequests.supervisorApprovedBy,
          supervisorApprovedAt: premiumTopUpRequests.supervisorApprovedAt,
          notes: premiumTopUpRequests.notes,
          createdAt: premiumTopUpRequests.createdAt,
          agentUserId: agents.agentId,
          agentName: agents.name,
          agentFloat: agents.premiumReserve,
          agentTier: agents.tier,
        })
        .from(premiumTopUpRequests)
        .leftJoin(agents, eq(premiumTopUpRequests.agentId, agents.id))
        .where(
          and(
            eq(premiumTopUpRequests.supervisorApprovalRequired, true),
            eq(premiumTopUpRequests.status, "pending")
          )
        )
        .orderBy(desc(premiumTopUpRequests.createdAt));

      // Filter by assigned agents for supervisors
      const filtered =
        session.role === "supervisor"
          ? rows.filter(
              (r: any) => r.agentId !== null && agentIds.includes(r.agentId)
            )
          : rows;

      return filtered.map((r: any) => ({
        ...r,
        requestedAmount: Number(r.requestedAmount),
        agentFloat: Number(r.agentFloat ?? 0),
      }));
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  // ── Supervisor: approve a large top-up ───────────────────────────────────
  supervisorApproveTopUp: protectedProcedure
    .input(
      z.object({
        requestId: z.number().int().positive(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });
        if (session.role !== "supervisor" && session.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Supervisor or admin privileges required",
          });
        }

        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        const rows = await db
          .select()
          .from(premiumTopUpRequests)
          .where(eq(premiumTopUpRequests.id, input.requestId))
          .limit(1);
        const req = rows[0];
        if (!req)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Request not found",
          });
        if (req.status !== "pending") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Request already ${req.status}`,
          });
        }

        // Verify supervisor is assigned to this agent (skip for admin)
        if (session.role === "supervisor") {
          const assignment = await db
            .select()
            .from(supervisorAgents)
            .where(
              and(
                eq(supervisorAgents.supervisorUserId, session.id),
                eq(supervisorAgents.agentId, req.agentId)
              )
            )
            .limit(1);
          if (!assignment[0]) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You are not assigned as supervisor for this agent",
            });
          }
        }

        await db
          .update(premiumTopUpRequests)
          .set({
            supervisorApprovedBy: session.agentId,
            supervisorApprovedAt: new Date(),
            notes: input.notes
              ? `${req.notes ?? ""}\nSupervisor note: ${input.notes}`.trim()
              : req.notes,
            updatedAt: new Date(),
          })
          .where(eq(premiumTopUpRequests.id, input.requestId));

        await writeAuditLog({
          agentId: session.id,
          action: "FLOAT_TOPUP_SUPERVISOR_APPROVED",
          resource: "float_topup",
          resourceId: String(input.requestId),
          status: "success",
          metadata: {
            amount: Number(req.requestedAmount),
            targetAgentId: req.agentId,
            notes: input.notes,
          },
        });

        return {
          success: true,
          message:
            "Supervisor approval recorded. Admin can now credit the float.",
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
});
