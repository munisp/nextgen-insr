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


export const reportBuilderTemplatesRouter = router({
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return {
        totalTemplates: 0,
        activeTemplates: 0,
        reportsGenerated: 0,
        scheduledReports: 0,
      };
    const rows = await db
      .select()
      .from(systemConfig)
      .where(sql`\${systemConfig.key} LIKE 'rpt_builder_%'`)
      .limit(100);
    return {
      totalTemplates: rows.length,
      activeTemplates: rows.length,
      reportsGenerated: 0,
      scheduledReports: 0,
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
          .where(sql`\${systemConfig.key} LIKE 'rpt_builder_%'`)
          .limit(input?.limit ?? 20);
        let templates = rows.map(r => ({
          id: r.key.replace("rpt_builder_", ""),
          ...JSON.parse(String(r.value ?? "{}")),
        }));
        if (input?.category)
          templates = templates.filter(
            (t: any) => t.category === input.category
          );
        return { templates, total: templates.length };
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
        category: z.string(),
        description: z.string().optional(),
        columns: z.array(
          z.object({
            field: z.string(),
            label: z.string(),
            type: z.string().default("text"),
          })
        ),
        filters: z
          .array(
            z.object({
              field: z.string(),
              operator: z.string(),
              value: z.string().optional(),
            })
          )
          .optional(),
        format: z.enum(["pdf", "csv", "xlsx"]).default("pdf"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const templateId = "RPTB-" + crypto.randomUUID().toUpperCase();
        await db.insert(systemConfig).values({
          key: "rpt_builder_" + templateId,
          value: JSON.stringify({
            ...input,
            status: "active",
            createdAt: new Date().toISOString(),
          }),
        });
        await db.insert(auditLog).values({
          action: "report_builder_template_created",
          resource: "report_builder",
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
          .where(eq(systemConfig.key, "rpt_builder_" + input.templateId));
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
        dateRange: z.object({ from: z.string(), to: z.string() }).optional(),
        filters: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const reportId = "RPT-" + crypto.randomUUID().toUpperCase();
        await db.insert(auditLog).values({
          action: "report_generated",
          resource: "report_builder",
          resourceId: reportId,
          status: "success",
          metadata: {
            templateId: input.templateId,
            dateRange: input.dateRange,
          },
        });
        return { success: true, reportId, status: "generating" };
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
