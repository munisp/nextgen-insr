import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count, sum } from "drizzle-orm";
import { z } from "zod";

import {
  analyticsDashboards,
  analyticsMetrics,
  agents,
  transactions,
  auditLog,
} from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const analyticsDashboardRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(analyticsDashboards)
          .orderBy(desc(analyticsDashboards.createdAt))
          .limit(input?.limit ?? 20);
        return { dashboards: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [dashboard] = await db
          .select()
          .from(analyticsDashboards)
          .where(eq(analyticsDashboards.id, input.id))
          .limit(1);
        return dashboard ?? null;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getOverview: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [agentCount] = await db
      .select({ value: count() })
      .from(agents)
      .limit(100);
    const [txCount] = await db
      .select({ value: count() })
      .from(transactions)
      .limit(100);
    const [txVolume] = await db
      .select({ value: sum(transactions.amount) })
      .from(transactions)
      .limit(100);
    const [dashCount] = await db
      .select({ value: count() })
      .from(analyticsDashboards)
      .limit(100);
    return {
      totalAgents: Number(agentCount.value),
      totalTransactions: Number(txCount.value),
      totalVolume: Number(txVolume.value ?? 0),
      totalDashboards: Number(dashCount.value),
    };
  }),
  create: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [dashboard] = await db
          .insert(analyticsDashboards)
          .values({
            name: input.name,
            description: input.description,
            config: input.config ?? {},
          } as any)
          .returning();
        await db.insert(auditLog).values({
          action: "dashboard_created",
          resource: "analytics_dashboards",
          resourceId: String(dashboard.id),
          status: "success",
          metadata: { name: input.name },
        });
        return dashboard;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const updates: Record<string, unknown> = {};
        if (input.name) updates.name = input.name;
        if (input.config) updates.config = input.config;
        await db
          .update(analyticsDashboards)
          .set(updates)
          .where(eq(analyticsDashboards.id, input.id));
        await db.insert(auditLog).values({
          action: "dashboard_updated",
          resource: "analytics_dashboards",
          resourceId: String(input.id),
          status: "success",
          metadata: {},
        });
        return { success: true, id: input.id };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .delete(analyticsDashboards)
          .where(eq(analyticsDashboards.id, input.id));
        await db.insert(auditLog).values({
          action: "dashboard_deleted",
          resource: "analytics_dashboards",
          resourceId: String(input.id),
          status: "success",
          metadata: {},
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

  // ── Sprint 11: Analytics Dashboard procedures ──────────────────────
  kpiSummary: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message:
        "KPI summary is not implemented yet (fraud/KYC/settlement rates were previously fabricated)",
    });
  }),

  transactionVolume: protectedProcedure
    .input(
      z.object({
        period: z.enum(["7d", "30d", "90d", "365d"]).default("30d"),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(transactions)
          .orderBy(desc(transactions.id))
          .limit(input.period === "7d" ? 7 : input.period === "30d" ? 30 : 90);
        return { period: input.period, data: rows };
      } catch {
        return { period: input.period, data: [] };
      }
    }),

  agentOnboardingFunnel: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "Agent onboarding funnel is not implemented yet",
    });
  }),

  fraudDetectionRates: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "Fraud detection rates are not implemented yet",
    });
  }),

  revenueBreakdown: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "Revenue breakdown is not implemented yet",
    });
  }),

  geographicDistribution: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "Geographic distribution is not implemented yet",
    });
  }),

  settlementTrend: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "Settlement trend is not implemented yet",
    });
  }),

  kycApprovalTrend: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "KYC approval trend is not implemented yet",
    });
  }),

  topAgents: protectedProcedure
    .input(
      z
        .object({
          sortBy: z
            .enum(["txCount", "volume", "commission", "rating"])
            .default("volume"),
          limit: z.number().default(10),
        })
        .optional()
    )
    .query(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "Top agents leaderboard is not implemented yet",
      });
    }),

  activeUsers: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "Active users metric is not implemented yet",
    });
  }),
});
