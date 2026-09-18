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
} from "drizzle-orm";
import { z } from "zod";

import { agents, otpTokens } from "../../drizzle/schema";
import {
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  router,
} from "../_core/trpc";
import {
  createAgent,
  getAgentByCode,
  getAgentById,
  updateAgentLastLogin,
  writeAuditLog,
  getDb,
} from "../db";
import { getJwtSecret } from "../lib/envValidation";
import {
  extractAgentSessionToken,
  revokeAgentSessionToken,
  getAgentFromCookie,
} from "../middleware/agentAuth";
import { assertTenantOwnership } from "../middleware/tenantIsolation";
import {
  assertAgentActivationEligible,
  deactivateAgentCascade,
  reactivateAgent,
} from "../lib/agentLifecycle";
import { sendSms } from "../termii";
import { logger } from "../_core/logger";
import crypto from "crypto";

// ── CBN Insurance Limits ──────────────────────────────────────────────────
const CBN_DAILY_TX_LIMIT = 3000000; // NGN 3M per day per agent
const CBN_SINGLE_TX_LIMIT = 1000000; // NGN 1M per single transaction
const CBN_MIN_FLOAT = 5000; // NGN 5K minimum float

// F6-5: PIN brute-force lockout policy
const MAX_PIN_FAILURES = 5;
const PIN_LOCKOUT_MINUTES = 15;

// ── G3 (audit #1): registration PIN + phone policy ──────────────────────────
// Nigerian MSISDN: 0801…/0701…/0901…/091… local or +234 international.
const NG_PHONE_RE = /^(?:\+234|0)[789][01]\d{8}$/;
const PHONE_VERIFY_OTP_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;

/**
 * Server-enforced PIN policy (G3 audit #1): self-chosen weak PINs made the
 * lockout policy moot. 4-6 digits, no single-digit repeats, no ascending/
 * descending runs, no well-known trivial PINs.
 */
function assertPinPolicy(pin: string): void {
  if (!/^\d{4,6}$/.test(pin)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "PIN must be 4-6 digits",
    });
  }
  if (/^(\d)\1+$/.test(pin)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "PIN must not repeat a single digit",
    });
  }
  const ascending = "0123456789012";
  const descending = "9876543210987";
  if (ascending.includes(pin) || descending.includes(pin)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "PIN must not be a sequential digit run",
    });
  }
  const TRIVIAL = new Set(["1234", "4321", "0000", "1111", "123456", "654321", "112233", "121212"]);
  if (TRIVIAL.has(pin)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "PIN is too weak — choose a non-trivial PIN",
    });
  }
}

function generatePhoneVerifyOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

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

        // F6-5: durable PIN brute-force lockout. The counter lives in the
        // agents table (survives restarts and multi-instance deployments);
        // 5 consecutive failures lock PIN login for 15 minutes. The lockout
        // write is part of the login path — if it fails, the login fails
        // closed (an unlockable counter is a brute-force invitation).
        const db = await getDb();
        if (!db) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Authentication store unavailable",
          });
        }
        if (agent.pinLockedUntil && agent.pinLockedUntil > new Date()) {
          await writeAuditLog({
            agentId: agent.id,
            metadata: { agentCode: agent.agentId },
            action: "LOGIN_LOCKED",
            resource: "agent",
            resourceId: String(agent.id),
            ipAddress: ctx.req.ip ?? "unknown",
            status: "failure",
          });
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Too many failed PIN attempts. Account locked until ${agent.pinLockedUntil.toISOString()}.`,
          });
        }

        const valid = await bcrypt.compare(input.pin, agent.pinHash);
        if (!valid) {
          const attempts = (agent.failedPinAttempts ?? 0) + 1;
          const reachedLimit = attempts >= MAX_PIN_FAILURES;
          await db
            .update(agents)
            .set(
              reachedLimit
                ? {
                    failedPinAttempts: 0,
                    pinLockedUntil: new Date(
                      Date.now() + PIN_LOCKOUT_MINUTES * 60 * 1000
                    ),
                    updatedAt: new Date(),
                  }
                : { failedPinAttempts: attempts, updatedAt: new Date() }
            )
            .where(eq(agents.id, agent.id));
          await writeAuditLog({
            agentId: agent.id,
            metadata: { agentCode: agent.agentId },
            action: reachedLimit ? "LOGIN_LOCKED" : "LOGIN_FAILED",
            resource: "agent",
            resourceId: String(agent.id),
            ipAddress: ctx.req.ip ?? "unknown",
            status: "failure",
          });
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: reachedLimit
              ? `Too many failed PIN attempts. Account locked for ${PIN_LOCKOUT_MINUTES} minutes.`
              : "Invalid agent ID or PIN",
          });
        }

        // Successful login clears any residual failure counter.
        if ((agent.failedPinAttempts ?? 0) > 0 || agent.pinLockedUntil) {
          await db
            .update(agents)
            .set({
              failedPinAttempts: 0,
              pinLockedUntil: null,
              updatedAt: new Date(),
            })
            .where(eq(agents.id, agent.id));
        }

        await updateAgentLastLogin(agent.id);
        await writeAuditLog({
          agentId: agent.id,
          metadata: { agentCode: agent.agentId },
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
  logout: protectedProcedure.mutation(async ({ ctx }) => {
    // F6-1: actually revoke the session token — clearing the cookie alone
    // leaves the 12h JWT valid for anyone who captured it.
    const token = extractAgentSessionToken(ctx.req);
    if (token) {
      await revokeAgentSessionToken(token);
    }
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
        // G3 (audit #15): a suspended/deleted agent's unexpired JWT must not
        // keep serving its profile.
        if (!agent || !agent.isActive || agent.deletedAt) return null;
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

  // ── Register agent (self-service, PENDING until verified + approved) ─────
  // G3 (audit #1, 2026-05): this was an unauthenticated INSTANT-ACTIVATION
  // path — publicProcedure + schema default isActive=true + caller-chosen
  // terminalSerial/floatLimit. HONEST-CONTRACT CHANGE: registration now
  // creates a PENDING agent (isActive=false, terminalEnabled=false, zero
  // float limit), enforces the server-side PIN policy, rejects duplicate
  // phones (one agent identity per MSISDN), and requires phone verification
  // (agent.verifyPhone OTP) before any admin can activate the account
  // (assertAgentActivationEligible). Fixtures that relied on instant-active
  // registration must now explicitly verify the phone and approve the agent
  // first — see tests/integration/agentOnboardingG3.integration.test.ts.
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
        if (!NG_PHONE_RE.test(input.phone)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Phone must be a valid Nigerian MSISDN (e.g. 08012345678 or +2348012345678)",
          });
        }
        assertPinPolicy(input.pin);
        const existing = await getAgentByCode(input.agentId.toUpperCase());
        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Agent code already exists",
          });
        }
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const [phoneTaken] = await db
          .select({ id: agents.id })
          .from(agents)
          .where(eq(agents.phone, input.phone))
          .limit(1);
        if (phoneTaken) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "An agent is already registered with this phone number",
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
          // PENDING: never active / never hardware-enabled at registration.
          isActive: false,
          terminalEnabled: false,
          floatLimit: "0.00",
          // No caller-chosen / ms-resolution serial (audit #29): serial is
          // assigned only through the gated terminal step.
          terminalSerial: null,
        });

        // Issue a phone-verification OTP (purpose='phone_verify'); the admin
        // activation gate requires this OTP to be consumed first.
        const otp = generatePhoneVerifyOtp();
        await db.delete(otpTokens).where(
          and(eq(otpTokens.agentId, agent.id), eq(otpTokens.purpose, "phone_verify"))
        );
        await db.insert(otpTokens).values({
          agentId: agent.id,
          hashedOtp: await bcrypt.hash(otp, 10),
          purpose: "phone_verify",
          expiresAt: new Date(Date.now() + PHONE_VERIFY_OTP_MINUTES * 60 * 1000),
          used: false,
        });
        const sms = await sendSms(
          input.phone,
          `Your InsurePortal agent verification code is: ${otp}. Valid for ${PHONE_VERIFY_OTP_MINUTES} minutes. Do not share this code.`
        );
        if (!sms.success) {
          // Fail-closed: without a deliverable OTP the phone can never be
          // verified, so a pending-but-unverifiable record would be junk.
          logger.error(
            `[agent.register] verification SMS failed for ${input.phone.slice(0, 4)}**** — registration rolled back`
          );
          await db.delete(otpTokens).where(eq(otpTokens.agentId, agent.id));
          await db.delete(agents).where(eq(agents.id, agent.id));
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "Could not deliver phone verification code. Registration aborted — please retry.",
          });
        }
        return {
          success: true,
          agentId: agent.id,
          status: "pending" as const,
          phoneVerificationRequired: true,
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

  // ── Verify registration phone (step 2 of self-registration) ──────────────
  // Consumes the phone_verify OTP. The agent remains PENDING — activation is
  // a separate admin decision (assertAgentActivationEligible gate).
  verifyPhone: publicProcedure
    .input(
      z.object({
        agentId: z.string().min(3).max(32),
        otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const agent = await getAgentByCode(input.agentId.toUpperCase());
      if (!agent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
      }
      const [token] = await db
        .select()
        .from(otpTokens)
        .where(
          and(
            eq(otpTokens.agentId, agent.id),
            eq(otpTokens.purpose, "phone_verify"),
            eq(otpTokens.used, false)
          )
        )
        .orderBy(desc(otpTokens.id))
        .limit(1);
      if (!token || token.expiresAt < new Date()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Verification code expired or not found — register again",
        });
      }
      if ((token.attempts ?? 0) >= MAX_OTP_ATTEMPTS) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Too many wrong codes — verification locked, register again",
        });
      }
      const valid = await bcrypt.compare(input.otp, token.hashedOtp);
      if (!valid) {
        await db
          .update(otpTokens)
          .set({ attempts: (token.attempts ?? 0) + 1 })
          .where(eq(otpTokens.id, token.id));
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid verification code",
        });
      }
      await db
        .update(otpTokens)
        .set({ used: true, usedAt: new Date() })
        .where(eq(otpTokens.id, token.id));
      await writeAuditLog({
        agentId: agent.id,
        action: "AGENT_PHONE_VERIFIED",
        resource: "agent",
        resourceId: String(agent.id),
        status: "success",
        metadata: { agentCode: agent.agentId },
      });
      return {
        success: true,
        status: "pending" as const,
        message:
          "Phone verified. Your registration is pending admin approval.",
      };
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
    .query(async ({ ctx, input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          return { agents: [], total: 0, page: input.page, limit: input.limit };

        const offset = (input.page - 1) * input.limit;

        const conditions = [isNull(agents.deletedAt)];
        // Tenant isolation (F-05): tenant users only see agents of their own
        // tenant. Platform users (no tenantId → 0 sentinel per
        // server/middleware/tenantIsolation.ts) are unscoped.
        const tenantId = ctx.user?.tenantId ?? 0;
        if (tenantId !== 0) conditions.push(eq(agents.tenantId, tenantId));
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
    .query(async ({ ctx, input }) => {
      try {
        const agent = await getAgentById(input.id);
        if (!agent || agent.deletedAt)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Agent not found",
          });
        // Tenant isolation (F-05): a tenant user may not read another
        // tenant's agent record (PII). Platform users (no tenantId → 0
        // sentinel) are unscoped.
        assertTenantOwnership(agent.tenantId, ctx.user?.tenantId ?? 0, "Agent");
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

        // G3 (audit #3): role/tier/floatLimit/creditLimit/creditScore/
        // creditRating/terminal* are PRIVILEGE attributes — platform admin
        // only, and isActive may never be flipped through this endpoint at
        // all (use the gated activate/suspend paths). Non-privilege fields
        // (name/phone/email/location) may be changed by an admin OR by the
        // agent holding a matching agent_session.
        const PRIVILEGED: (keyof typeof updates)[] = [
          "tier",
          "floatLimit",
          "terminalModel",
          "terminalSerial",
          "role",
          "creditScore",
          "creditLimit",
          "creditRating",
        ];
        const wantsPrivileged = PRIVILEGED.some(k => updates[k] !== undefined);
        const isAdmin = ctx.user?.role === "admin";
        if (wantsPrivileged && !isAdmin) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Privilege attributes (role, tier, floatLimit, creditLimit, creditScore, creditRating, terminal) are admin-only",
          });
        }
        if (!isAdmin) {
          const session = await getAgentFromCookie(ctx.req);
          if (!session || session.id !== id) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Agents may only update their own profile fields",
            });
          }
        }
        if (isAdmin) {
          assertTenantOwnership(
            agent.tenantId,
            ctx.user?.tenantId ?? 0,
            "Agent"
          );
        }

        const updateData: Record<string, unknown> = { updatedAt: new Date() };
        if (updates.name !== undefined) updateData.name = updates.name;
        if (updates.phone !== undefined) {
          // Phone is the USSD identity — keep one-identity-per-MSISDN.
          const [phoneTaken] = await db
            .select({ id: agents.id })
            .from(agents)
            .where(eq(agents.phone, updates.phone))
            .limit(1);
          if (phoneTaken && phoneTaken.id !== id) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Another agent already uses this phone number",
            });
          }
          updateData.phone = updates.phone;
        }
        if (updates.email !== undefined) updateData.email = updates.email;
        if (updates.location !== undefined)
          updateData.location = updates.location;
        if (updates.tier !== undefined) updateData.tier = updates.tier;
        if (updates.floatLimit !== undefined)
          updateData.floatLimit = String(updates.floatLimit);
        if (updates.terminalModel !== undefined)
          updateData.terminalModel = updates.terminalModel;
        if (updates.terminalSerial !== undefined) {
          // G3 (audit #6/#29): serial uniqueness enforced at the app layer
          // (DB unique index in migration 0079).
          const [serialTaken] = await db
            .select({ id: agents.id })
            .from(agents)
            .where(eq(agents.terminalSerial, updates.terminalSerial))
            .limit(1);
          if (serialTaken && serialTaken.id !== id) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Terminal serial already assigned to another agent",
            });
          }
          updateData.terminalSerial = updates.terminalSerial;
        }
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
          action: "AGENT_UPDATED",
          resource: "agent",
          resourceId: String(id),
          status: "success",
          metadata: {
            agentCode: agent.agentId,
            actor: isAdmin ? `user:${ctx.user?.id}` : "self",
            ...updates,
          },
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
  // G3 (audit #14): admin-only + full deactivation cascade (tokens revoked,
  // sockets dropped, float locked, terminal disabled) — previously a bare
  // boolean flip that left 12h sessions and hardware live.
  delete: adminProcedure
    .input(
      z.object({ id: z.number().int().positive(), reason: z.string().min(5) })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const agent = await getAgentById(input.id);
        if (!agent || agent.deletedAt)
          throw new TRPCError({ code: "NOT_FOUND" });
        await deactivateAgentCascade({
          agentPk: input.id,
          agentCode: agent.agentId,
          reason: input.reason,
          actor: { id: ctx.user?.id, label: `user:${ctx.user?.id}` },
          action: "AGENT_DELETED",
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
  setFloatLock: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        locked: z.boolean(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
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
          action: input.locked ? "FLOAT_LOCKED" : "FLOAT_UNLOCKED",
          resource: "agent",
          resourceId: String(input.id),
          status: "success",
          metadata: { agentCode: agent.agentId, reason: input.reason },
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
  setTerminalEnabled: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        enabled: z.boolean(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
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
          action: input.enabled ? "TERMINAL_ENABLED" : "TERMINAL_DISABLED",
          resource: "agent",
          resourceId: String(input.id),
          status: "success",
          metadata: { agentCode: agent.agentId, reason: input.reason },
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
  // G3 (audit #8): admin-only AND each agent must have verification evidence
  // (consumed phone-verify OTP or approved KYC) — previously any
  // authenticated user could activate up to 100 arbitrary unverified agents.
  bulkActivate: adminProcedure
    .input(
      z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const rows = await db
          .select({ id: agents.id, agentId: agents.agentId })
          .from(agents)
          .where(and(inArray(agents.id, input.ids), isNull(agents.deletedAt)));
        // Fail-closed: verify EVERY agent before activating ANY.
        const evidenceByAgent: Record<number, string> = {};
        for (const row of rows) {
          evidenceByAgent[row.id] = await assertAgentActivationEligible(row.id);
        }
        await db
          .update(agents)
          .set({ isActive: true, updatedAt: new Date() })
          .where(and(inArray(agents.id, input.ids), isNull(agents.deletedAt)));
        await writeAuditLog({
          action: "BULK_ACTIVATE",
          resource: "agent",
          resourceId: input.ids.join(","),
          status: "success",
          metadata: {
            count: rows.length,
            actor: `user:${ctx.user?.id}`,
            evidence: evidenceByAgent,
          },
        });
        return { success: true, count: rows.length };
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
  // G3 (audit #14): admin-only + per-agent deactivation cascade (token
  // revocation, socket disconnect, float lock, terminal disable).
  bulkSuspend: adminProcedure
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
        const rows = await db
          .select({ id: agents.id, agentId: agents.agentId })
          .from(agents)
          .where(and(inArray(agents.id, input.ids), isNull(agents.deletedAt)));
        for (const row of rows) {
          await deactivateAgentCascade({
            agentPk: row.id,
            agentCode: row.agentId,
            reason: input.reason,
            actor: { id: ctx.user?.id, label: `user:${ctx.user?.id}` },
            action: "BULK_SUSPEND",
          });
        }
        return { success: true, count: rows.length };
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
  // G3 (audit #14): admin-only + per-agent deactivation cascade.
  bulkDelete: adminProcedure
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
        const rows = await db
          .select({ id: agents.id, agentId: agents.agentId })
          .from(agents)
          .where(and(inArray(agents.id, input.ids), isNull(agents.deletedAt)));
        for (const row of rows) {
          await deactivateAgentCascade({
            agentPk: row.id,
            agentCode: row.agentId,
            reason: input.reason,
            actor: { id: ctx.user?.id, label: `user:${ctx.user?.id}` },
            action: "BULK_DELETE",
          });
        }
        return { success: true, count: rows.length };
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
    .mutation(async ({ input }) => {
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
            AND status = 'success'
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
