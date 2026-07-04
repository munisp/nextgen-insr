// @ts-check
/**
 * Admin Dashboard Router — InsurePortal POS Shell (Sprint 89)
 *
 * Role-gated admin procedures for user management, system statistics,
 * audit log viewing, and platform health monitoring.
 * Uses adminProcedure (role=admin + Permify check).
 */
import { z } from "zod";
import { router, adminProcedure, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  users,
  billingAuditLog,
  platformBillingLedger,
} from "../../drizzle/schema";
import { eq, desc, count, sql, and, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const adminDashboardRouter = router({
  // ── System Stats ──────────────────────────────────────────────────────────────
  getSystemStats: adminProcedure.query(async () => {
    try {
      const db = await getDb();
      const _uc = await db!.select({ count: count() }).from(users).limit(100);
      const userCount = Array.isArray(_uc) ? _uc[0] : _uc;
      const _ac = await db!
        .select({ count: count() })
        .from(users)
        .where(eq(users.role, "admin"))
        .limit(100);
      const adminCount = Array.isArray(_ac) ? _ac[0] : _ac;
      return {
        totalUsers: Number(userCount?.count ?? userCount?.cnt ?? 0),
        adminUsers: Number(adminCount?.count ?? adminCount?.cnt ?? 0),
        recentSignups: 0,
        stripeLinkedUsers: 0,
        serverUptime: process.uptime(),
        nodeVersion: process.version,
        memoryUsage: process.memoryUsage(),
        timestamp: new Date().toISOString(),
      };
    } catch {
      return {
        totalUsers: 0,
        adminUsers: 0,
        recentSignups: 0,
        stripeLinkedUsers: 0,
        serverUptime: process.uptime(),
        nodeVersion: process.version,
        memoryUsage: process.memoryUsage(),
        timestamp: new Date().toISOString(),
      };
    }
  }),

  // ── User Management: List Users ───────────────────────────────────────────────
  listUsers: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        role: z.enum(["admin", "user"]).optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        let query = db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            role: users.role,
            createdAt: users.createdAt,
            lastSignedIn: users.lastSignedIn,
            stripeCustomerId: users.stripeCustomerId,
            stripePlanId: users.stripePlanId,
            tenantId: users.tenantId,
            mfaEnabled: users.mfaEnabled,
          })
          .from(users)
          .orderBy(desc(users.createdAt))
          .limit(input.limit)
          .offset(input.offset);

        if (input.role) {
          // @ts-expect-error auto-fix
          query = db
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
              role: users.role,
              createdAt: users.createdAt,
              lastSignedIn: users.lastSignedIn,
              stripeCustomerId: users.stripeCustomerId,
              stripePlanId: users.stripePlanId,
              tenantId: users.tenantId,
              mfaEnabled: users.mfaEnabled,
            })
            .from(users)
            .where(eq(users.role, input.role))
            .orderBy(desc(users.createdAt))
            .limit(input.limit)
            .offset(input.offset);
        }

        const result = await query;
        const _total = await db
          .select({ count: count() })
          .from(users)
          .limit(100);
        const totalRow = Array.isArray(_total) ? _total[0] : _total;

        return {
          users: Array.isArray(result) ? result : [],
          total: Number(totalRow?.count ?? totalRow?.cnt ?? 0),
        };
      } catch {
        return { users: [], total: 0 };
      }
    }),

  // ── User Management: Update User Role ─────────────────────────────────────────
  updateUserRole: adminProcedure
    .input(
      z.object({
        userId: z.number(),
        role: z.enum(["admin", "user"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;

        // Prevent self-demotion
        if (input.userId === ctx.user.id && input.role !== "admin") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot demote yourself",
          });
        }

        await db
          .update(users)
          .set({ role: input.role, updatedAt: new Date() })
          .where(eq(users.id, input.userId));

        return { success: true, userId: input.userId, newRole: input.role };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Audit Log ─────────────────────────────────────────────────────────────────
  getAuditLog: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const logs = await db
          .select()
          .from(billingAuditLog)
          .orderBy(desc(billingAuditLog.createdAt))
          .limit(input.limit)
          .offset(input.offset);

        const _total = await db
          .select({ count: count() })
          .from(billingAuditLog)
          .limit(100);
        const totalRow = Array.isArray(_total) ? _total[0] : _total;
        const items = Array.isArray(logs) ? logs : [];

        return {
          logs: items,
          entries: items,
          total: Number(totalRow?.count ?? totalRow?.cnt ?? 0),
        };
      } catch {
        return { logs: [], entries: [], total: 0 };
      }
    }),

  // ── Billing Ledger Summary ────────────────────────────────────────────────────
  getBillingLedgerSummary: adminProcedure.query(async () => {
    const db = (await getDb())!;
    const [ledgerCount] = await db
      .select({ count: count() })
      .from(platformBillingLedger)
      .limit(100);

    const recentEntries = await db
      .select()
      .from(platformBillingLedger)
      .orderBy(desc(platformBillingLedger.createdAt))
      .limit(20);

    return {
      totalEntries: ledgerCount.count,
      recentEntries,
    };
  }),

  // ── System Health ─────────────────────────────────────────────────────────────
  getSystemHealth: adminProcedure.query(async () => {
    const db = (await getDb())!;
    const dbHealthy = !!db;

    return {
      database: dbHealthy ? "healthy" : "degraded",
      server: "healthy",
      uptime: process.uptime(),
      memory: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      timestamp: new Date().toISOString(),
    };
  }),
});
