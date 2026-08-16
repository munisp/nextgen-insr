// @ts-check
import { TRPCError } from "@trpc/server";
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
import { z } from "zod";

import { auditLog, systemConfig } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


const notImplemented = () =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: "Report template designer is not implemented yet",
  });

export const reportTemplateDesignerRouter = router({
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return { totalTemplates: 0, activeTemplates: 0, reportsGenerated: 0 };
    const rows = await db
      .select()
      .from(systemConfig)
      .where(sql`${systemConfig.key} LIKE 'report_template_%'`)
      .limit(100);
    return {
      totalTemplates: rows.length,
      activeTemplates: rows.length,
      reportsGenerated: 0,
    };
  }),
  listTemplates: protectedProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          limit: z.number().default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { templates: [], total: 0 };
        const rows = await db
          .select()
          .from(systemConfig)
          .where(sql`${systemConfig.key} LIKE 'report_template_%'`)
          .limit(input?.limit ?? 20);
        return {
          templates: rows.map(r => ({
            id: r.key.replace("report_template_", ""),
            ...JSON.parse(String(r.value ?? "{}")),
          })),
          total: rows.length,
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
  createTemplate: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        category: z.string(),
        columns: z.array(z.string()),
        filters: z.array(z.string()).optional(),
        format: z.enum(["pdf", "csv", "xlsx"]).default("pdf"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const templateId = "RPT-" + crypto.randomUUID().toUpperCase();
        await db.insert(systemConfig).values({
          key: "report_template_" + templateId,
          value: JSON.stringify({
            ...input,
            status: "active",
            createdAt: new Date().toISOString(),
          }),
        });
        await db.insert(auditLog).values({
          action: "report_template_created",
          resource: "report_templates",
          resourceId: templateId,
          status: "success",
          metadata: { name: input.name, category: input.category },
        });
        return { success: true, templateId };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  deleteTemplate: protectedProcedure
    .input(z.object({ templateId: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db
          .delete(systemConfig)
          .where(eq(systemConfig.key, "report_template_" + input.templateId));
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
  generateReport: protectedProcedure
    .input(
      z.object({
        templateId: z.string(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        filters: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.insert(auditLog).values({
          action: "report_generated",
          resource: "report_templates",
          resourceId: input.templateId,
          status: "success",
          metadata: {
            dateFrom: input.dateFrom,
            dateTo: input.dateTo,
            filters: input.filters,
          },
        });
        return {
          success: true,
          reportId: "RPT-" + crypto.randomUUID().toUpperCase(),
          status: "generating",
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

  create: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented();
    }),

  delete: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented();
    }),

  list: protectedProcedure.query(async () => {
    throw notImplemented();
  }),

  setDefault: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented();
    }),

  widgetCatalog: protectedProcedure.query(async () => {
    throw notImplemented();
  }),
  update: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().optional() }))
    .mutation(async () => {
      throw notImplemented();
    }),
});
