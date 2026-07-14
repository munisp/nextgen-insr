import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { auditLog } from "@schema";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { getConfig, setConfig } from "../lib/runtimeConfig";
import { runArchivalJob, getArchivalStats } from "../lib/parquetArchival";

export const archivalAdminRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const database = await getDb();
        if (!database)
          return {
            data: [],
            total: 0,
            limit: input.limit,
            offset: input.offset,
          };
        const results = await database
          .select()
          .from(auditLog)
          .orderBy(desc(auditLog.id))
          .limit(input.limit)
          .offset(input.offset);

        const _totalRows = await database
          .select({ total: count() })
          .from(auditLog);
        const totalResult = Array.isArray(_totalRows)
          ? _totalRows[0]
          : _totalRows;

        return {
          data: Array.isArray(results) ? results : [],
          total: totalResult?.total ?? 0,
          limit: input.limit,
          offset: input.offset,
        };
      } catch {
        return { data: [], total: 0, limit: input.limit, offset: input.offset };
      }
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
      const [record] = await database
        .select()
        .from(auditLog)
        .where(eq(auditLog.id, input.id))
        .limit(1);

      if (!record) {
        throw new Error(`Record with id ${input.id} not found`);
      }
      return record;
    }),

  getSummary: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
    const _totalRows = await database.select({ total: count() }).from(auditLog);
    const totalResult = Array.isArray(_totalRows) ? _totalRows[0] : _totalRows;

    return {
      totalRecords: totalResult?.total ?? 0,
      lastUpdated: new Date().toISOString(),
    };
  }),

  getRecent: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(7),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
      const since = new Date();
      since.setDate(since.getDate() - input.days);

      const results = await database
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.id))
        .limit(input.limit);

      return results;
    }),

  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return {
        totalArchived: 0,
        lastRun: null,
        schedule: null as {
          enabled: boolean;
          cronExpression: string;
          retentionDays: number;
          deleteAfterArchive: boolean;
          nextRun: string | null;
        } | null,
        currentJob: null as {
          id: string;
          startedAt: string;
          retentionDays: number;
        } | null,
        eligibleSettlements: 0,
        eligibleBatches: 0,
        cutoffDate: new Date(),
        retentionDays: 90,
      };
    const archivalStats = await getArchivalStats();
    const rawSchedule = await getConfig("archival_schedule");
    let schedule: {
      enabled: boolean;
      cronExpression: string;
      retentionDays: number;
      deleteAfterArchive: boolean;
      nextRun: string | null;
    } | null = null;
    if (rawSchedule) {
      try {
        const parsed =
          typeof rawSchedule === "string" && rawSchedule.startsWith("{")
            ? JSON.parse(rawSchedule)
            : null;
        if (parsed && typeof parsed === "object") {
          schedule = {
            enabled: parsed.enabled ?? true,
            cronExpression: parsed.cronExpression ?? String(rawSchedule),
            retentionDays: parsed.retentionDays ?? 90,
            deleteAfterArchive: parsed.deleteAfterArchive ?? false,
            nextRun: parsed.nextRun ?? null,
          };
        } else {
          schedule = {
            enabled: true,
            cronExpression: String(rawSchedule),
            retentionDays: 90,
            deleteAfterArchive: false,
            nextRun: null,
          };
        }
      } catch {
        schedule = {
          enabled: true,
          cronExpression: String(rawSchedule),
          retentionDays: 90,
          deleteAfterArchive: false,
          nextRun: null,
        };
      }
    }
    return {
      ...archivalStats,
      schedule,
      currentJob: null as {
        id: string;
        startedAt: string;
        retentionDays: number;
      } | null,
    };
  }),

  triggerArchival: protectedProcedure
    .input(
      z.object({
        triggeredBy: z.string().default("manual"),
        retentionDays: z.number().optional(),
        deleteAfterArchive: z.boolean().optional(),
        tables: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const startTime = Date.now();
      const job = { id: `archival_${Date.now()}` };
      try {
        const result = await runArchivalJob({
          retentionDays: input.retentionDays,
          deleteAfterArchive: input.deleteAfterArchive,
        });
        const duration = Date.now() - startTime;
        await notifyOwner({
          title: `Archival Job ${job.id} Completed`,
          content: `Triggered by: ${input.triggeredBy}\nTotal archived: ${result.totalArchived} records\nDuration: ${duration}ms`,
        });
        return {
          success: true as const,
          jobId: job.id,
          ...result,
          duration,
          error: null as string | null,
        };
      } catch (err: any) {
        const duration = Date.now() - startTime;
        await notifyOwner({
          title: `Archival Job ${job.id} Failed`,
          content: `Triggered by: ${input.triggeredBy}\nError: ${err.message}\nDuration: ${duration}ms`,
        });
        return {
          success: false as const,
          jobId: job.id,
          error: err.message as string | null,
          totalArchived: 0,
          totalDeleted: 0,
          tables: [] as any[],
          startedAt: new Date(),
          completedAt: new Date(),
          duration,
        };
      }
    }),

  updateSchedule: protectedProcedure
    .input(
      z.object({
        enabled: z.boolean().default(false),
        cronExpression: z.string().default("0 2 * * 0"),
        retentionDays: z.number().default(90),
        deleteAfterArchive: z.boolean().default(false),
      })
    )
    .mutation(async ({ input }) => {
      const schedule = JSON.stringify(input);
      await setConfig("archival_schedule", schedule);
      return { success: true, schedule: input };
    }),

  getHistory: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const results = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "archival_job"))
        .orderBy(desc(auditLog.id))
        .limit(input.limit);
      return results;
    }),
});
