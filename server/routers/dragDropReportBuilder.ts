import { TRPCError } from "@trpc/server";
import { eq, desc, sql, count } from "drizzle-orm";
import { z } from "zod";

import { biReportDefinitions, auditLog } from "../../drizzle/schema";
import { publicProcedure, router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const dragDropReportBuilderRouter = router({
  listReports: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(biReportDefinitions)
          .orderBy(desc(biReportDefinitions.createdAt))
          .limit(input?.limit ?? 20);
        return { reports: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getReport: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [report] = await db
          .select()
          .from(biReportDefinitions)
          .where(eq(biReportDefinitions.id, input.id))
          .limit(1);
        return report ?? null;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  createReport: protectedProcedure
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
        const [report] = await db
          .insert(biReportDefinitions)
          .values({
            name: input.name,
            description: input.description,
            config: input.config ?? {},
          } as any)
          .returning();
        await db.insert(auditLog).values({
          action: "report_created",
          resource: "bi_report_definitions",
          resourceId: String(report.id),
          status: "success",
          metadata: { name: input.name },
        });
        return report;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  updateReport: protectedProcedure
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
          .update(biReportDefinitions)
          .set(updates)
          .where(eq(biReportDefinitions.id, input.id));
        await db.insert(auditLog).values({
          action: "report_updated",
          resource: "bi_report_definitions",
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
  deleteReport: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .delete(biReportDefinitions)
          .where(eq(biReportDefinitions.id, input.id));
        await db.insert(auditLog).values({
          action: "report_deleted",
          resource: "bi_report_definitions",
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
  getStats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [total] = await db
      .select({ value: count() })
      .from(biReportDefinitions)
      .limit(100);
    return { totalReports: Number(total.value) };
  }),

  // F-12 (verifier site 5): saveReport fabricated id "RPT-001" with no DB
  // write — now a REAL insert into bi_report_definitions (config is stored
  // as the report query payload). executeReport/exportReport have no
  // execution/export engine — fail loud. dashboard derives real rows.
  saveReport: publicProcedure
    .input(
      z.object({ name: z.string(), config: z.record(z.string(), z.unknown()) })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "database unavailable",
        });
      }
      const [row] = await db
        .insert(biReportDefinitions)
        .values({
          name: input.name,
          query: JSON.stringify(input.config),
          createdBy: ctx.user?.id != null ? String(ctx.user.id) : null,
        })
        .returning({ id: biReportDefinitions.id, name: biReportDefinitions.name });
      return { id: String(row.id), name: row.name, saved: true as const };
    }),

  executeReport: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "executeReport: no report-execution engine is delivered",
    });
  }),

  exportReport: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "exportReport: no report-export pipeline is delivered",
    });
  }),
  dashboard: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      return { reports: [], recentActivity: [], stats: { totalReports: 0, sharedReports: 0 } };
    }
    const rows = await db
      .select()
      .from(biReportDefinitions)
      .orderBy(desc(biReportDefinitions.id))
      .limit(50);
    return {
      reports: rows,
      recentActivity: [],
      stats: { totalReports: rows.length, sharedReports: 0 },
    };
  }),
});
