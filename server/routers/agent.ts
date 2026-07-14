/**
 * agent.ts — tRPC router for agent management
 *
 * Features:
 *   - Login / Logout / Me
 *   - Register (dev/admin)
 *   - List with search, filter, pagination
 *   - Get by ID / Update / Soft-delete
 *   - Bulk operations: activate, suspend, delete
 *   - Float lock/unlock
 *   - Terminal enable/disable
 *   - CBN daily limit enforcement
 */
// =============================================================================
// NAVIGATION GUIDE — Agent Router (823 lines, 17 procedures)
// =============================================================================
// Agent lifecycle management: auth, CRUD, bulk operations, tier management,
// CBN daily limit enforcement.
//
// ── Authentication ───────────────────────────────────────────────────────────
//  48. login           — Agent login (JWT)
// 152. logout          — Invalidate session
// 158. me              — Current agent profile
// 205. register        — Agent registration (dev/admin)
//
// ── CRUD Operations ──────────────────────────────────────────────────────────
// 253. list            — Agent list (search/filter/pagination)
// 381. getById         — Single agent details
// 403. update          — Update agent
// 490. delete          — Soft-delete agent
//
// ── Account Controls ─────────────────────────────────────────────────────────
// 530. setFloatLock    — Lock/unlock float
// 570. setTerminalEnabled — Enable/disable terminal
//
// ── Bulk Operations ──────────────────────────────────────────────────────────
// 616. bulkActivate   — Bulk activate agents
// 647. bulkSuspend    — Bulk suspend agents
// 681. bulkDelete     — Bulk delete agents
// 719. bulkSetTier    — Bulk tier assignment
//
// ── Limits & Stats ───────────────────────────────────────────────────────────
// 753. getDailyLimits  — CBN daily transaction limits
// 796. stats           — Agent statistics
// ─────────────────────────────────────────────────────────────────────────────
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  createAgent,
  getAgentByCode,
  getAgentById,
  updateAgentLastLogin,
  writeAuditLog,
  getDb,
} from "../db";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { agents } from "../../drizzle/schema";
import { getJwtSecret } from "../lib/envValidation";
import {
  eq,
  ilike,
  and,
  isNull,
  desc,
  asc,
  sql,
  inArray,
  or,
  ne,
} from "drizzle-orm";

// ── CBN Insurance Limits ──────────────────────────────────────────────────
const CBN_DAILY_TX_LIMIT = 3000000; // NGN 3M per day per agent
const CBN_SINGLE_TX_LIMIT = 1000000; // NGN 1M per single transaction
const CBN_MIN_FLOAT = 5000; // NGN 5K minimum float

export const agentRouter = router({
  // ── Login ─────────────────────────────────────────────────────────────────
  login: publicProcedure
    .input(
      z.object({
        agentId: z.string().min(3).max(32),
        pin: z.string().min(4).max(8),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const agent = await getAgentByCode(input.agentId.toUpperCase());
        if (!agent) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid agent ID or PIN",
          });
        }
        if (!agent.isActive) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Agent account is suspended. Contact support.",
          });
        }

        const valid = await bcrypt.compare(input.pin, agent.pinHash);
        if (!valid) {
          await writeAuditLog({
            agentId: agent.id,
            agentId: agent.agentId,
            action: "LOGIN_FAILED",
            resource: "agent",
            resourceId: String(agent.id),
            ipAddress: ctx.req.ip ?? "unknown",
            status: "failure",
          });
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid agent ID or PIN",
          });
        }

        await updateAgentLastLogin(agent.id);
        await writeAuditLog({
          agentId: agent.id,
          agentId: agent.agentId,
          action: "LOGIN_SUCCESS",
          resource: "agent",
          resourceId: String(agent.id),
          ipAddress: ctx.req.ip ?? "unknown",
          status: "success",
        });

        // Store agent session in cookie (reuse JWT_SECRET)
        const { SignJWT } = await import("jose");
        const secret = new TextEncoder().encode(getJwtSecret());
        const token = await new SignJWT({
          sub: String(agent.id),
          agentId: agent.agentId,
          name: agent.name,
          tier: agent.tier,
          role: "agent",
        })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt()
          .setExpirationTime("12h")
          .sign(secret);

        ctx.res.cookie("agent_session", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
          maxAge: 12 * 60 * 60 * 1000,
          path: "/",
        });

        return {
          success: true,
          agent: {
            id: agent.id,
            agentId: agent.agentId,
            name: agent.name,
            tier: agent.tier,
            phone: agent.phone,
            location: agent.location,
            terminalModel: agent.terminalModel,
            terminalSerial: agent.terminalSerial,
            premiumReserve: Number(agent.premiumReserve),
            floatLimit: Number(agent.floatLimit),
            commissionBalance: Number(agent.commissionBalance),
            loyaltyPoints: agent.loyaltyPoints,
            streak: agent.streak,
            rank: agent.rank,
          },
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

  // ── Logout ────────────────────────────────────────────────────────────────
  logout: protectedProcedure.mutation(({ ctx }) => {
    ctx.res.clearCookie("agent_session", { path: "/" });
    return { success: true };
  }),

  // ── Get current agent profile ─────────────────────────────────────────────
  me: protectedProcedure.query(async ({ ctx }) => {
    try {
      const cookieHeader = ctx.req.headers.cookie ?? "";
      const match = cookieHeader.match(/agent_session=([^;]+)/);
      if (!match) return null;

      try {
        const { jwtVerify } = await import("jose");
        const secret = new TextEncoder().encode(getJwtSecret());
        const { payload } = await jwtVerify(match[1], secret);
        const agentId = Number(payload.sub);
        const agent = await getAgentById(agentId);
        if (!agent) return null;
        return {
          id: agent.id,
          agentId: agent.agentId,
          name: agent.name,
          role: (agent.role ?? "agent") as "agent" | "admin" | "supervisor",
          tier: agent.tier,
          phone: agent.phone,
          location: agent.location,
          terminalModel: agent.terminalModel,
          terminalSerial: agent.terminalSerial,
          premiumReserve: Number(agent.premiumReserve),
          floatLimit: Number(agent.floatLimit),
          commissionBalance: Number(agent.commissionBalance),
          loyaltyPoints: agent.loyaltyPoints,
          streak: agent.streak,
          rank: agent.rank,
          floatLocked: agent.floatLocked ?? false,
          terminalEnabled: agent.terminalEnabled ?? true,
          terminalDisabledReason: agent.terminalDisabledReason ?? null,
        };
      } catch {
        return null;
      }
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  // ── Register demo agent (dev/admin) ──────────────────────────────────────
  register: publicProcedure
    .input(
      z.object({
        agentId: z.string().min(3).max(32),
        name: z.string().min(2),
        phone: z.string().min(10),
        pin: z.string().min(4).max(8),
        email: z.string().email().optional(),
        location: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const existing = await getAgentByCode(input.agentId.toUpperCase());
        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Agent code already exists",
          });
        }
        const pinHash = await bcrypt.hash(input.pin, 10);
        const agent = await createAgent({
          agentId: input.agentId.toUpperCase(),
          name: input.name,
          phone: input.phone,
          email: input.email ?? null,
          location: input.location ?? "Lagos, Nigeria",
          pinHash,
          premiumReserve: "0.00",
          commissionBalance: "0.00",
          loyaltyPoints: 0,
          streak: 0,
          rank: 0,
          tier: "Bronze",
          terminalSerial: `SN${Date.now()}`,
        });
        return { success: true, agentId: agent.id };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── List agents with search, filter, pagination ───────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        status: z
          .enum(["all", "active", "suspended", "pending"])
          .default("all"),
        tier: z
          .enum(["all", "Bronze", "Silver", "Gold", "Platinum"])
          .default("all"),
        location: z.string().optional(),
        sortBy: z
          .enum([
            "name",
            "createdAt",
            "premiumReserve",
            "loyaltyPoints",
            "lastLoginAt",
          ])
          .default("createdAt"),
        sortOrder: z.enum(["asc", "desc"]).default("desc"),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(20),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          return { agents: [], total: 0, page: input.page, limit: input.limit };

        const offset = (input.page - 1) * input.limit;

        const conditions = [isNull(agents.deletedAt)];
        if (input.status !== "all") {
          if (input.status === "active")
            conditions.push(eq(agents.isActive, true));
          else if (input.status === "suspended")
            conditions.push(eq(agents.isActive, false));
        }
        if (input.tier !== "all")
          conditions.push(
            eq(
              agents.tier,
              input.tier as "Bronze" | "Silver" | "Gold" | "Platinum"
            )
          );
        if (input.location)
          conditions.push(ilike(agents.location, `%${input.location}%`));
        if (input.search) {
          conditions.push(
            or(
              ilike(agents.name, `%${input.search}%`),
              ilike(agents.agentId, `%${input.search}%`),
              ilike(agents.phone, `%${input.search}%`),
              ilike(agents.email, `%${input.search}%`)
            )!
          );
        }

        const whereClause = and(...conditions);
        const orderCol =
          input.sortBy === "name"
            ? agents.name
            : input.sortBy === "premiumReserve"
              ? agents.premiumReserve
              : input.sortBy === "loyaltyPoints"
                ? agents.loyaltyPoints
                : input.sortBy === "lastLoginAt"
                  ? agents.lastLoginAt
                  : agents.createdAt;
        const orderFn = input.sortOrder === "asc" ? asc : desc;

        const [rows, [{ total }]] = await Promise.all([
          db
            .select({
              id: agents.id,
              agentId: agents.agentId,
              name: agents.name,
              phone: agents.phone,
              email: agents.email,
              location: agents.location,
              tier: agents.tier,
              isActive: agents.isActive,
              premiumReserve: agents.premiumReserve,
              floatLimit: agents.floatLimit,
              commissionBalance: agents.commissionBalance,
              loyaltyPoints: agents.loyaltyPoints,
              streak: agents.streak,
              rank: agents.rank,
              terminalModel: agents.terminalModel,
              terminalSerial: agents.terminalSerial,
              terminalEnabled: agents.terminalEnabled,
              floatLocked: agents.floatLocked,
              lastLoginAt: agents.lastLoginAt,
              createdAt: agents.createdAt,
              creditScore: agents.creditScore,
              creditRating: agents.creditRating,
            })
            .from(agents)
            .where(whereClause)
            .orderBy(orderFn(orderCol))
            .limit(input.limit)
            .offset(offset),
          db
            .select({ total: sql<string>`COUNT(*)` })
            .from(agents)
            .where(whereClause),
        ]);

        return {
          agents: rows,
          total: parseInt(total, 10),
          page: input.page,
          limit: input.limit,
          totalPages: Math.ceil(parseInt(total, 10) / input.limit),
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

  // ── Get agent by ID ───────────────────────────────────────────────────────
  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      try {
        const agent = await getAgentById(input.id);
        if (!agent || agent.deletedAt)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Agent not found",
          });
        return agent;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Update agent ──────────────────────────────────────────────────────────
  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(2).optional(),
        phone: z.string().min(10).optional(),
        email: z.string().email().optional(),
        location: z.string().optional(),
        tier: z.enum(["Bronze", "Silver", "Gold", "Platinum"]).optional(),
        floatLimit: z.number().positive().optional(),
        terminalModel: z.string().optional(),
        terminalSerial: z.string().optional(),
        role: z.enum(["agent", "supervisor", "admin"]).optional(),
        creditScore: z.number().int().min(0).max(1000).optional(),
        creditLimit: z.number().min(0).optional(),
        creditRating: z
          .enum([
            "AAA",
            "AA",
            "A",
            "BBB",
            "BB",
            "B",
            "CCC",
            "CC",
            "C",
            "D",
            "N/A",
          ])
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { id, ...updates } = input;
        const agent = await getAgentById(id);
        if (!agent || agent.deletedAt)
          throw new TRPCError({ code: "NOT_FOUND" });

        const updateData: Record<string, unknown> = { updatedAt: new Date() };
        if (updates.name !== undefined) updateData.name = updates.name;
        if (updates.phone !== undefined) updateData.phone = updates.phone;
        if (updates.email !== undefined) updateData.email = updates.email;
        if (updates.location !== undefined)
          updateData.location = updates.location;
        if (updates.tier !== undefined) updateData.tier = updates.tier;
        if (updates.floatLimit !== undefined)
          updateData.floatLimit = String(updates.floatLimit);
        if (updates.terminalModel !== undefined)
          updateData.terminalModel = updates.terminalModel;
        if (updates.terminalSerial !== undefined)
          updateData.terminalSerial = updates.terminalSerial;
        if (updates.role !== undefined) updateData.role = updates.role;
        if (updates.creditScore !== undefined)
          updateData.creditScore = updates.creditScore;
        if (updates.creditLimit !== undefined)
          updateData.creditLimit = String(updates.creditLimit);
        if (updates.creditRating !== undefined)
          updateData.creditRating = updates.creditRating;

        await db
          .update(agents)
          .set(updateData as Partial<typeof agents.$inferInsert>)
          .where(eq(agents.id, id));
        await writeAuditLog({
          agentId: id,
          agentId: agent.agentId,
          action: "AGENT_UPDATED",
          resource: "agent",
          resourceId: String(id),
          status: "success",
          metadata: updates as Record<string, unknown>,
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

  // ── Soft delete ───────────────────────────────────────────────────────────
  delete: protectedProcedure
    .input(
      z.object({ id: z.number().int().positive(), reason: z.string().min(5) })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const agent = await getAgentById(input.id);
        if (!agent || agent.deletedAt)
          throw new TRPCError({ code: "NOT_FOUND" });
        await db
          .update(agents)
          .set({
            deletedAt: new Date(),
            isActive: false,
            updatedAt: new Date(),
          })
          .where(eq(agents.id, input.id));
        await writeAuditLog({
          agentId: input.id,
          agentId: agent.agentId,
          action: "AGENT_DELETED",
          resource: "agent",
          resourceId: String(input.id),
          status: "success",
          metadata: { reason: input.reason },
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

  // ── Float lock/unlock ─────────────────────────────────────────────────────
  setFloatLock: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        locked: z.boolean(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const agent = await getAgentById(input.id);
        if (!agent || agent.deletedAt)
          throw new TRPCError({ code: "NOT_FOUND" });
        await db
          .update(agents)
          .set({ floatLocked: input.locked, updatedAt: new Date() })
          .where(eq(agents.id, input.id));
        await writeAuditLog({
          agentId: input.id,
          agentId: agent.agentId,
          action: input.locked ? "FLOAT_LOCKED" : "FLOAT_UNLOCKED",
          resource: "agent",
          resourceId: String(input.id),
          status: "success",
          metadata: { reason: input.reason },
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

  // ── Terminal enable/disable ───────────────────────────────────────────────
  setTerminalEnabled: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        enabled: z.boolean(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const agent = await getAgentById(input.id);
        if (!agent || agent.deletedAt)
          throw new TRPCError({ code: "NOT_FOUND" });
        await db
          .update(agents)
          .set({
            terminalEnabled: input.enabled,
            terminalDisabledReason: input.enabled
              ? null
              : (input.reason ?? "Disabled by admin"),
            updatedAt: new Date(),
          })
          .where(eq(agents.id, input.id));
        await writeAuditLog({
          agentId: input.id,
          agentId: agent.agentId,
          action: input.enabled ? "TERMINAL_ENABLED" : "TERMINAL_DISABLED",
          resource: "agent",
          resourceId: String(input.id),
          status: "success",
          metadata: { reason: input.reason },
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

  // ── Bulk activate ─────────────────────────────────────────────────────────
  bulkActivate: protectedProcedure
    .input(
      z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        await db
          .update(agents)
          .set({ isActive: true, updatedAt: new Date() })
          .where(and(inArray(agents.id, input.ids), isNull(agents.deletedAt)));
        await writeAuditLog({
          action: "BULK_ACTIVATE",
          resource: "agent",
          resourceId: input.ids.join(","),
          status: "success",
          metadata: { count: input.ids.length },
        });
        return { success: true, count: input.ids.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Bulk suspend ──────────────────────────────────────────────────────────
  bulkSuspend: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.number().int().positive()).min(1).max(100),
        reason: z.string().min(5),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        await db
          .update(agents)
          .set({ isActive: false, updatedAt: new Date() })
          .where(and(inArray(agents.id, input.ids), isNull(agents.deletedAt)));
        await writeAuditLog({
          action: "BULK_SUSPEND",
          resource: "agent",
          resourceId: input.ids.join(","),
          status: "success",
          metadata: { count: input.ids.length, reason: input.reason },
        });
        return { success: true, count: input.ids.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Bulk delete ───────────────────────────────────────────────────────────
  bulkDelete: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.number().int().positive()).min(1).max(100),
        reason: z.string().min(5),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        await db
          .update(agents)
          .set({
            deletedAt: new Date(),
            isActive: false,
            updatedAt: new Date(),
          })
          .where(and(inArray(agents.id, input.ids), isNull(agents.deletedAt)));
        await writeAuditLog({
          action: "BULK_DELETE",
          resource: "agent",
          resourceId: input.ids.join(","),
          status: "success",
          metadata: { count: input.ids.length, reason: input.reason },
        });
        return { success: true, count: input.ids.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Bulk tier upgrade ─────────────────────────────────────────────────────
  bulkSetTier: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.number().int().positive()).min(1).max(100),
        tier: z.enum(["Bronze", "Silver", "Gold", "Platinum"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        await db
          .update(agents)
          .set({ tier: input.tier, updatedAt: new Date() })
          .where(and(inArray(agents.id, input.ids), isNull(agents.deletedAt)));
        await writeAuditLog({
          action: "BULK_SET_TIER",
          resource: "agent",
          resourceId: input.ids.join(","),
          status: "success",
          metadata: { count: input.ids.length, tier: input.tier },
        });
        return { success: true, count: input.ids.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Get CBN daily limits for agent ────────────────────────────────────────
  getDailyLimits: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          return {
            dailyLimit: CBN_DAILY_TX_LIMIT,
            singleTxLimit: CBN_SINGLE_TX_LIMIT,
            usedToday: 0,
            remaining: CBN_DAILY_TX_LIMIT,
          };
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const statsResult = await db.execute(sql`
          SELECT COALESCE(SUM(CAST(amount AS NUMERIC)), 0)::float AS used_today
          FROM transactions
          WHERE "agentId" = ${input.id}
            AND "createdAt" >= ${today}
            AND status = 'completed'
        `);
        const usedToday = parseFloat(
          (statsResult.rows[0] as Record<string, string>).used_today ?? "0"
        );
        return {
          dailyLimit: CBN_DAILY_TX_LIMIT,
          singleTxLimit: CBN_SINGLE_TX_LIMIT,
          minFloat: CBN_MIN_FLOAT,
          usedToday,
          remaining: Math.max(0, CBN_DAILY_TX_LIMIT - usedToday),
          utilizationPct: Math.round((usedToday / CBN_DAILY_TX_LIMIT) * 100),
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

  // ── Agent statistics ──────────────────────────────────────────────────────
  stats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    if (!db) return { total: 0, active: 0, suspended: 0, byTier: {} };
    const statsResult = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE "deletedAt" IS NULL) AS total,
        COUNT(*) FILTER (WHERE "deletedAt" IS NULL AND "isActive" = true) AS active,
        COUNT(*) FILTER (WHERE "deletedAt" IS NULL AND "isActive" = false) AS suspended,
        COUNT(*) FILTER (WHERE "deletedAt" IS NULL AND tier = 'Bronze') AS bronze,
        COUNT(*) FILTER (WHERE "deletedAt" IS NULL AND tier = 'Silver') AS silver,
        COUNT(*) FILTER (WHERE "deletedAt" IS NULL AND tier = 'Gold') AS gold,
        COUNT(*) FILTER (WHERE "deletedAt" IS NULL AND tier = 'Platinum') AS platinum
      FROM agents
    `);
    const r = statsResult.rows[0] as Record<string, string>;
    return {
      total: parseInt(r.total ?? "0", 10),
      active: parseInt(r.active ?? "0", 10),
      suspended: parseInt(r.suspended ?? "0", 10),
      byTier: {
        Bronze: parseInt(r.bronze ?? "0", 10),
        Silver: parseInt(r.silver ?? "0", 10),
        Gold: parseInt(r.gold ?? "0", 10),
        Platinum: parseInt(r.platinum ?? "0", 10),
      },
    };
  }),
});
