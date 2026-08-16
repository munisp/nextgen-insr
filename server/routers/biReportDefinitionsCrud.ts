// Sprint 87: Report scheduling, parameter validation, output formatting
import { TRPCError } from "@trpc/server";
import { eq, desc, and, count } from "drizzle-orm";
import { z } from "zod";

import { biReportDefinitions } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

const REPORT_FORMATS = ["pdf", "csv", "xlsx", "json"];
const SCHEDULE_FREQUENCIES = ["daily", "weekly", "monthly", "quarterly"];

export const biReportDefinitionsRouter = router({
  list: protectedProcedure
    .input(
      z.object({ limit: z.number().default(20), offset: z.number().default(0) })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(biReportDefinitions)
          .orderBy(desc(biReportDefinitions.id))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(biReportDefinitions)
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
          .from(biReportDefinitions)
          .where(eq(biReportDefinitions.id, input.id))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Report definition not found",
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
        outputFormat: z.enum(["pdf", "csv", "xlsx", "json"]).default("pdf"),
        schedule: z
          .enum(["daily", "weekly", "monthly", "quarterly"])
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [row] = await db
          .insert(biReportDefinitions)
          .values(input as any)
          .returning();
        return {
          ...row,
          message: input.schedule
            ? `Report scheduled ${input.schedule}`
            : "Report definition created",
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
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .delete(biReportDefinitions)
          .where(eq(biReportDefinitions.id, input.id));
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
  getFormats: protectedProcedure.query(() => ({
    formats: REPORT_FORMATS,
    schedules: SCHEDULE_FREQUENCIES,
  })),
});
