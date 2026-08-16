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
    message: "Scheduled reports are not implemented yet",
  });

export const scheduledReportsRouter = router({
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return {
        totalSchedules: 0,
        activeSchedules: 0,
        reportsGenerated: 0,
        nextRun: null,
      };
    const rows = await db
      .select()
      .from(systemConfig)
      .where(sql`${systemConfig.key} LIKE 'scheduled_report_%'`)
      .limit(100);
    return {
      totalSchedules: rows.length,
      activeSchedules: rows.filter(r => {
        const v = JSON.parse(String(r.value ?? "{}"));
        return v.status === "active";
      }).length,
      reportsGenerated: 0,
      nextRun: null,
    };
  }),
  listSchedules: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { schedules: [], total: 0 };
        const rows = await db
          .select()
          .from(systemConfig)
          .where(sql`${systemConfig.key} LIKE 'scheduled_report_%'`)
          .limit(input?.limit ?? 20);
        return {
          schedules: rows.map(r => ({
            id: r.key.replace("scheduled_report_", ""),
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
  createSchedule: protectedProcedure
    .input(
      z.object({
        reportType: z.string(),
        frequency: z.enum(["daily", "weekly", "monthly"]),
        recipients: z.array(z.string().email()),
        format: z.enum(["pdf", "csv", "xlsx"]).default("pdf"),
        time: z.string().default("08:00"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const scheduleId = "SCH-" + crypto.randomUUID().toUpperCase();
        await db.insert(systemConfig).values({
          key: "scheduled_report_" + scheduleId,
          value: JSON.stringify({
            ...input,
            status: "active",
            createdAt: new Date().toISOString(),
          }),
        });
        await db.insert(auditLog).values({
          action: "report_schedule_created",
          resource: "scheduled_reports",
          resourceId: scheduleId,
          status: "success",
          metadata: {
            reportType: input.reportType,
            frequency: input.frequency,
          },
        });
        return { success: true, scheduleId };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  deleteSchedule: protectedProcedure
    .input(z.object({ scheduleId: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db
          .delete(systemConfig)
          .where(eq(systemConfig.key, "scheduled_report_" + input.scheduleId));
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
  pauseSchedule: protectedProcedure
    .input(z.object({ scheduleId: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const rows = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.key, "scheduled_report_" + input.scheduleId))
          .limit(1);
        if (rows.length === 0)
          return { success: false, error: "Schedule not found" };
        const data = JSON.parse(String(rows[0].value ?? "{}"));
        data.status = data.status === "active" ? "paused" : "active";
        await db
          .update(systemConfig)
          .set({ value: JSON.stringify(data), updatedAt: new Date() })
          .where(eq(systemConfig.key, "scheduled_report_" + input.scheduleId));
        return { success: true, newStatus: data.status };
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
    .input(z.object({ data: z.record(z.string(), z.any()).optional() }))
    .mutation(async () => {
      throw notImplemented();
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.union([z.number(), z.string()]) }))
    .mutation(async () => {
      throw notImplemented();
    }),

  list: protectedProcedure.query(async () => {
    throw notImplemented();
  }),

  recentRuns: protectedProcedure.query(async () => {
    throw notImplemented();
  }),

  runNow: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented();
    }),

  templates: protectedProcedure.query(async () => {
    throw notImplemented();
  }),

  update: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented();
    }),
});
