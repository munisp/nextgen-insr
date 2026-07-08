// @ts-check

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { biometricAuditEvents, faceEnrollments } from "../../drizzle/schema";
import { eq, desc, sql, and, gte, lte, count } from "drizzle-orm";

/**
 * Biometric Audit Dashboard Router — Admin-only analytics and monitoring
 * for all biometric verification events across the platform.
 */
const adminGuard = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
  return next({ ctx });
});

export const biometricAuditDashboardRouter = router({
  /** Aggregate biometric statistics */
  stats: adminGuard
    .input(
      z
        .object({
          startDate: z.string().optional(),
          endDate: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db)
          return {
            totalEvents: 0,
            passRate: "0.0",
            failRate: "0.0",
            errorRate: "0.0",
            spoofDetections: [],
            avgProcessingTimeMs: 0,
            activeEnrollments: 0,
          };

        const conditions: any[] = [];
        if (input?.startDate)
          conditions.push(
            gte(biometricAuditEvents.createdAt, new Date(input.startDate))
          );
        if (input?.endDate)
          conditions.push(
            lte(biometricAuditEvents.createdAt, new Date(input.endDate))
          );
        const whereClause =
          conditions.length > 0 ? and(...conditions) : undefined;

        const [totalEvents] = await db
          .select({ count: count() })
          .from(biometricAuditEvents)
          .where(whereClause)
          .limit(100);
        const [passEvents] = await db
          .select({ count: count() })
          .from(biometricAuditEvents)
          .where(and(whereClause, eq(biometricAuditEvents.outcome, "pass")))
          .limit(100);
        const [failEvents] = await db
          .select({ count: count() })
          .from(biometricAuditEvents)
          .where(and(whereClause, eq(biometricAuditEvents.outcome, "fail")))
          .limit(100);
        const [errorEvents] = await db
          .select({ count: count() })
          .from(biometricAuditEvents)
          .where(and(whereClause, eq(biometricAuditEvents.outcome, "error")))
          .limit(100);

        const spoofEvents = await db
          .select({
            spoofType: biometricAuditEvents.spoofType,
            count: count(),
          })
          .from(biometricAuditEvents)
          .where(
            and(whereClause, sql`${biometricAuditEvents.spoofType} IS NOT NULL`)
          )
          .groupBy(biometricAuditEvents.spoofType);

        const [avgTime] = await db
          .select({
            avg: sql<number>`AVG(${biometricAuditEvents.processingTimeMs})`,
          })
          .from(biometricAuditEvents)
          .where(whereClause);

        const [activeEnrollments] = await db
          .select({ count: count() })
          .from(faceEnrollments)
          .where(eq(faceEnrollments.isActive, true));

        return {
          totalEvents: totalEvents.count,
          passRate:
            totalEvents.count > 0
              ? ((passEvents.count / totalEvents.count) * 100).toFixed(1)
              : "0.0",
          failRate:
            totalEvents.count > 0
              ? ((failEvents.count / totalEvents.count) * 100).toFixed(1)
              : "0.0",
          errorRate:
            totalEvents.count > 0
              ? ((errorEvents.count / totalEvents.count) * 100).toFixed(1)
              : "0.0",
          spoofDetections: spoofEvents,
          avgProcessingTimeMs: Math.round(avgTime.avg ?? 0),
          activeEnrollments: activeEnrollments.count,
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

  /** Paginated list of recent biometric events */
  recentEvents: adminGuard
    .input(
      z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(20),
        eventType: z.string().optional(),
        outcome: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db)
          return {
            events: [],
            total: 0,
            page: input.page,
            pageSize: input.pageSize,
            totalPages: 0,
          };

        const conditions: any[] = [];
        if (input.eventType)
          conditions.push(eq(biometricAuditEvents.eventType, input.eventType));
        if (input.outcome)
          conditions.push(eq(biometricAuditEvents.outcome, input.outcome));
        const whereClause =
          conditions.length > 0 ? and(...conditions) : undefined;

        const events = await db
          .select()
          .from(biometricAuditEvents)
          .where(whereClause)
          .orderBy(desc(biometricAuditEvents.createdAt))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize);

        const [total] = await db
          .select({ count: count() })
          .from(biometricAuditEvents)
          .where(whereClause)
          .limit(100);

        return {
          events,
          total: total.count,
          page: input.page,
          pageSize: input.pageSize,
          totalPages: Math.ceil(total.count / input.pageSize),
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

  /** Events flagged as potential spoofing attempts */
  spoofAlerts: adminGuard
    .input(
      z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { alerts: [], total: 0 };

        const alerts = await db
          .select()
          .from(biometricAuditEvents)
          .where(sql`${biometricAuditEvents.spoofType} IS NOT NULL`)
          .orderBy(desc(biometricAuditEvents.createdAt))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize);

        const [total] = await db
          .select({ count: count() })
          .from(biometricAuditEvents)
          .where(sql`${biometricAuditEvents.spoofType} IS NOT NULL`);

        return { alerts, total: total.count };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  /** Enrollment statistics */
  enrollmentStats: adminGuard.query(async () => {
    const db = await getDb();
    if (!db) return { total: 0, active: 0, revoked: 0, byType: [] };

    const byType = await db
      .select({
        enrollmentType: faceEnrollments.enrollmentType,
        count: count(),
      })
      .from(faceEnrollments)
      .groupBy(faceEnrollments.enrollmentType);

    const [active] = await db
      .select({ count: count() })
      .from(faceEnrollments)
      .where(eq(faceEnrollments.isActive, true));

    const [revoked] = await db
      .select({ count: count() })
      .from(faceEnrollments)
      .where(sql`${faceEnrollments.revokedAt} IS NOT NULL`);

    const [total] = await db
      .select({ count: count() })
      .from(faceEnrollments)
      .limit(100);

    return {
      total: total.count,
      active: active.count,
      revoked: revoked.count,
      byType,
    };
  }),

  /** Biometric event history for a specific user */
  userHistory: adminGuard
    .input(
      z.object({
        userId: z.number(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { events: [], total: 0 };

        const events = await db
          .select()
          .from(biometricAuditEvents)
          .where(eq(biometricAuditEvents.userId, input.userId))
          .orderBy(desc(biometricAuditEvents.createdAt))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize);

        const [total] = await db
          .select({ count: count() })
          .from(biometricAuditEvents)
          .where(eq(biometricAuditEvents.userId, input.userId));

        return { events, total: total.count };
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
