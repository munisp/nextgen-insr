// Sprint 87: Widget computation, real-time aggregation, caching
import { TRPCError } from "@trpc/server";
import { eq, desc, and, count } from "drizzle-orm";
import { z } from "zod";

import { analyticsDashboards } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

const WIDGET_TYPES = [
  "kpi_card",
  "line_chart",
  "bar_chart",
  "pie_chart",
  "table",
  "heatmap",
  "gauge",
];
const MAX_WIDGETS_PER_DASHBOARD = 12;

export const analyticsDashboardsRouter = router({
  list: protectedProcedure
    .input(
      z.object({ limit: z.number().default(20), offset: z.number().default(0) })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(analyticsDashboards)
          .orderBy(desc(analyticsDashboards.id))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(analyticsDashboards)
          .limit(100);
        return { items: rows, total };
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
        const [row] = await db
          .select()
          .from(analyticsDashboards)
          .where(eq(analyticsDashboards.id, input.id))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Dashboard not found",
          });
        return row;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(3),
        description: z.string().optional(),
        isPublic: z.boolean().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        const [existing] = await db
          .select()
          .from(analyticsDashboards)
          .where(eq(analyticsDashboards.name, input.name))
          .limit(100);
        if (existing)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Dashboard with this name already exists",
          });
        const [row] = await db
          .insert(analyticsDashboards)
          .values({ ...input, createdBy: ctx.user?.id } as any)
          .returning();
        return row;
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
  getWidgetTypes: protectedProcedure.query(() => ({
    types: WIDGET_TYPES,
    maxPerDashboard: MAX_WIDGETS_PER_DASHBOARD,
  })),
});
