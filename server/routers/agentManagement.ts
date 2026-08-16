/**
 * agentManagement router — admin-only procedures for managing agents.
 * Requires agent_session cookie with role === "admin".
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, asc } from "drizzle-orm";
import { z } from "zod";

import { agents, premiumTopUpRequests } from "../../drizzle/schema";
import { logger } from '../_core/logger';
import { protectedProcedure, router } from "../_core/trpc";
import { getDb ,
  writeAuditLog,
  updateAgentFloat,
  getAgentById,
  withTransaction,
} from "../db";
import { getAgentFromCookie } from "../middleware/agentAuth";

async function requireAdmin(req: any) {
  const session = await getAgentFromCookie(req);
  if (!session)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Agent session required",
    });
  // Re-fetch from DB to get latest role
  const db = (await getDb())!;
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable",
    });
  const result = await db
    .select()
    .from(agents)
    .where(eq(agents.id, session.id))
    .limit(1);
  const agent = result[0];
  if (!agent || agent.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin privileges required",
    });
  }
  return { session, agent };
}

export const agentManagementRouter = router({
  // ── List all agents ───────────────────────────────────────────────────────
  listAll: protectedProcedure.query(async ({ ctx }) => {
    try {
      await requireAdmin(ctx.req);
      const db = (await getDb())!;
      if (!db) throw new Error("Database connection unavailable");
      const rows = await db
        .select()
        .from(agents)
        .orderBy(asc(agents.agentId));
      return rows.map((a: any) => ({
        id: a.id,
        agentId: a.agentId,
        name: a.name,
        phone: a.phone,
        email: a.email,
        location: a.location,
        tier: a.tier,
        role: a.role,
        isActive: a.isActive,
        premiumReserve: Number(a.premiumReserve),
        floatLimit: Number(a.floatLimit),
        commissionBalance: Number(a.commissionBalance),
        loyaltyPoints: a.loyaltyPoints,
        streak: a.streak,
        rank: a.rank,
        terminalModel: a.terminalModel,
        terminalSerial: a.terminalSerial,
        lastLoginAt: a.lastLoginAt,
        createdAt: a.createdAt,
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

  // ── Set agent role ────────────────────────────────────────────────────────
  setRole: protectedProcedure
    .input(
      z.object({
        agentId: z.number().int().positive(),
        role: z.enum(["agent", "supervisor", "admin"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const { session } = await requireAdmin(ctx.req);
        if (input.agentId === session.id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot change your own role",
          });
        }
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        await db
          .update(agents)
          .set({ role: input.role })
          .where(eq(agents.id, input.agentId));
        await writeAuditLog({
          agentId: session.id,
          action: "AGENT_ROLE_CHANGED",
          resource: "agent",
          resourceId: String(input.agentId),
          status: "success",
          metadata: { agentCode: session.agentId, newRole: input.role },
        });
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

  // ── Toggle agent active status ────────────────────────────────────────────
  setActive: protectedProcedure
    .input(
      z.object({
        agentId: z.number().int().positive(),
        isActive: z.boolean(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const { session } = await requireAdmin(ctx.req);
        if (input.agentId === session.id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot deactivate your own account",
          });
        }
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        await db
          .update(agents)
          .set({ isActive: input.isActive })
          .where(eq(agents.id, input.agentId));
        await writeAuditLog({
          agentId: session.id,
          metadata: { agentCode: session.agentId },
          action: input.isActive ? "AGENT_ACTIVATED" : "AGENT_SUSPENDED",
          resource: "agent",
          resourceId: String(input.agentId),
          status: "success",
        });
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

  // ── List float top-up requests ────────────────────────────────────────────
  listTopUpRequests: protectedProcedure
    .input(
      z.object({
        status: z
          .enum(["pending", "approved", "rejected", "all"])
          .default("pending"),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        await requireAdmin(ctx.req);
        const db = (await getDb())!;
        if (!db) throw new Error("Database connection unavailable");
        const rows = await db
          .select({
            id: premiumTopUpRequests.id,
            agentNumericId: premiumTopUpRequests.agentId,
            requestedAmount: premiumTopUpRequests.requestedAmount,
            status: premiumTopUpRequests.status,
            approvedBy: premiumTopUpRequests.approvedBy,
            notes: premiumTopUpRequests.notes,
            createdAt: premiumTopUpRequests.createdAt,
            updatedAt: premiumTopUpRequests.updatedAt,
            agentId: agents.agentId,
            agentName: agents.name,
            agentFloat: agents.premiumReserve,
            agentTier: agents.tier,
          })
          .from(premiumTopUpRequests)
          .leftJoin(agents, eq(premiumTopUpRequests.agentId, agents.id))
          .orderBy(desc(premiumTopUpRequests.createdAt));
        const filtered =
          input.status === "all"
            ? rows
            : rows.filter((r: any) => r.status === input.status);
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

  // ── Approve float top-up ──────────────────────────────────────────────────
  approveTopUp: protectedProcedure
    .input(
      z.object({
        requestId: z.number().int().positive(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const { session } = await requireAdmin(ctx.req);
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        const result = await db
          .select()
          .from(premiumTopUpRequests)
          .where(eq(premiumTopUpRequests.id, input.requestId))
          .limit(1);
        const req = result[0];
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
        // P0-A: Wrap float credit + status update in an atomic DB transaction
        await withTransaction(async tx => {
          // Credit agent float (updates agents.premiumReserve)
          await tx
            .update(require("../../drizzle/schema").agents)
            .set({
              premiumReserve: require("drizzle-orm")
                .sql`"premiumReserve" + ${Number(req.requestedAmount)}`,
              updatedAt: new Date(),
            })
            .where(
              require("drizzle-orm").eq(
                require("../../drizzle/schema").agents.id,
                req.agentId
              )
            );
          // Update request status
          await tx
            .update(premiumTopUpRequests)
            .set({
              status: "approved",
              approvedBy: session.agentId,
              notes: input.notes ?? null,
              updatedAt: new Date(),
            })
            .where(eq(premiumTopUpRequests.id, input.requestId));
        });
        await writeAuditLog({
          agentId: session.id,
          action: "FLOAT_TOPUP_APPROVED",
          resource: "float_topup",
          resourceId: String(input.requestId),
          status: "success",
          metadata: {
            agentCode: session.agentId,
            amount: Number(req.requestedAmount),
            targetAgentId: req.agentId,
          },
        });

        // ── Fluvio float event (fire-and-forget) ──────────────────────────────
        import("../lib/fluvioClient.js")
          .then(({ publishFloatEvent }) =>
            publishFloatEvent({
              agentId: req.agentId,
              previousBalance: 0, // actual previous balance not tracked here; use 0 as sentinel
              newBalance: Number(req.requestedAmount),
              delta: Number(req.requestedAmount),
              reason: "float_topup_approved",
              ref: `FLT-${input.requestId}`,
            })
          )
          .catch((e: unknown) =>
            logger.error("[Fluvio] Float event failed:: " + e)
          );

        // ── VAPID push notification to agent (fire-and-forget) ──────────────────
        (async () => {
          try {
            const { notifyFloatApproval } = await import("../push.js");
            const db2 = await getDb();
            if (!db2) return;
            const agentRows = await db2
              .select()
              .from(agents)
              .where(eq(agents.id, req.agentId))
              .limit(1);
            const targetAgent = agentRows[0];
            if (targetAgent) {
              await notifyFloatApproval({
                agentId: targetAgent.agentId,
                amount: Number(req.requestedAmount),
                newBalance:
                  Number(targetAgent.premiumReserve) +
                  Number(req.requestedAmount),
              });
            }
          } catch (e) {
            logger.error("[Push] Float approval notification failed:: " + e);
          }
        })();

        return { success: true, amountCredited: Number(req.requestedAmount) };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Reject float top-up ───────────────────────────────────────────────────
  rejectTopUp: protectedProcedure
    .input(
      z.object({
        requestId: z.number().int().positive(),
        reason: z.string().min(5),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const { session } = await requireAdmin(ctx.req);
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        const result = await db
          .select()
          .from(premiumTopUpRequests)
          .where(eq(premiumTopUpRequests.id, input.requestId))
          .limit(1);
        const req = result[0];
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
        await db
          .update(premiumTopUpRequests)
          .set({
            status: "rejected",
            approvedBy: session.agentId,
            notes: input.reason,
            updatedAt: new Date(),
          })
          .where(eq(premiumTopUpRequests.id, input.requestId));
        await writeAuditLog({
          agentId: session.id,
          action: "FLOAT_TOPUP_REJECTED",
          resource: "float_topup",
          resourceId: String(input.requestId),
          status: "success",
          metadata: { agentCode: session.agentId, reason: input.reason, targetAgentId: req.agentId },
        });
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

  // ── Agent submits a float top-up request (agent-side, no admin required) ──
  submitTopUpRequest: protectedProcedure
    .input(
      z.object({
        amount: z.number().positive().min(1000, "Minimum top-up is ₦1,000"),
        notes: z.string().max(500).optional(),
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
        // Prevent duplicate pending requests
        const existing = await db
          .select()
          .from(premiumTopUpRequests)
          .where(eq(premiumTopUpRequests.agentId, session.id))
          .limit(10);
        const hasPending = existing.some((r: any) => r.status === "pending");
        if (hasPending) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You already have a pending top-up request",
          });
        }
        await db.insert(premiumTopUpRequests).values({
          agentId: session.id,
          requestedAmount: String(input.amount),
          status: "pending",
          notes: input.notes ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await writeAuditLog({
          agentId: session.id,
          action: "FLOAT_TOPUP_REQUESTED",
          resource: "float_topup",
          resourceId: session.agentId,
          status: "success",
          metadata: { agentCode: session.agentId, amount: input.amount, notes: input.notes },
        });
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
});
