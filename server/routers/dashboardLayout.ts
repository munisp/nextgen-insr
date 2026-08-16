// @ts-check
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  eq,
  desc,
  and,
  sql,
  count,
  sum,
  isNull,
  gte,
  lte,
  or,
  asc,
} from "drizzle-orm";
import { auditLog, systemConfig } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

export const dashboardLayoutRouter = router({
  presets: protectedProcedure.query(async () => {
    return {
      items: [
        { id: "default", name: "Default", widgets: [] },
        { id: "financial", name: "Financial", widgets: [] },
      ],
    };
  }),

  getLayout: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { layout: null };
        const rows = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.key, "dashboard_layout_" + input.userId))
          .limit(1);
        if (rows.length > 0 && rows[0].value)
          return { layout: JSON.parse(String(rows[0].value)) };
        return {
          layout: {
            widgets: ["transactions", "agents", "revenue", "alerts"],
            columns: 3,
            theme: "default",
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
  saveLayout: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        layout: z.object({
          widgets: z.array(z.string()),
          columns: z.number().min(1).max(4).default(3),
          theme: z.string().default("default"),
        }),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db
          .insert(systemConfig)
          .values({
            key: "dashboard_layout_" + input.userId,
            value: JSON.stringify(input.layout),
          })
          .onConflictDoUpdate({
            target: systemConfig.key,
            set: { value: JSON.stringify(input.layout), updatedAt: new Date() },
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
  resetLayout: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db
          .delete(systemConfig)
          .where(eq(systemConfig.key, "dashboard_layout_" + input.userId));
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
  listTemplates: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { templates: [] };
    return {
      templates: [
        {
          id: "admin",
          name: "Admin Dashboard",
          widgets: [
            "transactions",
            "agents",
            "revenue",
            "alerts",
            "compliance",
            "fraud",
          ],
          columns: 3,
        },
        {
          id: "agent",
          name: "Agent Dashboard",
          widgets: [
            "my_transactions",
            "commissions",
            "float_balance",
            "notifications",
          ],
          columns: 2,
        },
        {
          id: "ops",
          name: "Operations Dashboard",
          widgets: [
            "system_health",
            "carrier_status",
            "queue_depth",
            "error_rates",
          ],
          columns: 4,
        },
      ],
    };
  }),
});
