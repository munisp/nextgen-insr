import { TRPCError } from "@trpc/server";
import { eq, desc, sql, count } from "drizzle-orm";
import { z } from "zod";

import { data_export_jobs, auditLog } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const dataExportHubRouter = router({
  listExports: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().default(50),
          status: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = input?.status
          ? await db
              .select()
              .from(data_export_jobs)
              .where(eq(data_export_jobs.status, input.status))
              .orderBy(desc(data_export_jobs.createdAt))
              .limit(input?.limit ?? 50)
          : await db
              .select()
              .from(data_export_jobs)
              .orderBy(desc(data_export_jobs.createdAt))
              .limit(input?.limit ?? 50);
        return { exports: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getExport: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [job] = await db
          .select()
          .from(data_export_jobs)
          .where(eq(data_export_jobs.id, input.id))
          .limit(1);
        return job ?? null;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  createExport: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        type: z.string(),
        format: z.enum(["csv", "json", "xlsx", "parquet"]).default("csv"),
        filters: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [job] = await db
          .insert(data_export_jobs)
          .values({
            name: input.name,
            type: input.type,
            format: input.format,
            status: "pending",
            filters: input.filters ?? {},
          } as any)
          .returning();
        await db.insert(auditLog).values({
          action: "data_export_created",
          resource: "data_export_jobs",
          resourceId: String(job.id),
          status: "success",
          metadata: {
            name: input.name,
            type: input.type,
            format: input.format,
          },
        });
        return job;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  cancelExport: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .update(data_export_jobs)
          .set({ status: "cancelled" })
          .where(eq(data_export_jobs.id, input.id));
        await db.insert(auditLog).values({
          action: "data_export_cancelled",
          resource: "data_export_jobs",
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
      .from(data_export_jobs)
      .limit(100);
    return {
      totalExports: Number(total.value),
      lastUpdated: new Date().toISOString(),
    };
  }),
});
