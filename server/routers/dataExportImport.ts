// Sprint 87: Regenerated — dataExportImport with real DB queries
import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { z } from "zod";

import { transactions } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

const notImplemented = (feature: string) =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: `${feature} is not implemented yet`,
  });

const dashboard = protectedProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    })
  )
  .query(async () => {
    try {
      const db = (await getDb())!;
      const [{ total }] = await db
        .select({ total: count() })
        .from(transactions)
        .limit(100);
      const recent = await db
        .select()
        .from(transactions)
        .orderBy(desc(transactions.id))
        .limit(5);
      return {
        totalRecords: total,
        recentItems: recent,
        summary: { active: total, lastUpdated: new Date().toISOString() },
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
const createExport = protectedProcedure
  .input(
    z.object({
      id: z.number().optional(),
      data: z.record(z.string(), z.any()).optional(),
    })
  )
  .mutation(async () => {
    throw notImplemented("Data export");
  });
const createImport = protectedProcedure
  .input(
    z.object({
      id: z.number().optional(),
      data: z.record(z.string(), z.any()).optional(),
    })
  )
  .mutation(async () => {
    throw notImplemented("Data import");
  });
const getExportStatus = protectedProcedure
  .input(
    z.object({
      id: z.number().optional(),
      data: z.record(z.string(), z.any()).optional(),
    })
  )
  .mutation(async () => {
    throw notImplemented("Export status tracking");
  });

export const dataExportImportRouter = router({
  dashboard,
  createExport,
  createImport,
  getExportStatus,

  getStats: protectedProcedure.query(async () => {
    throw notImplemented("Data export/import statistics");
  }),
});
