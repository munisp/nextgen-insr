// Sprint 87: Regenerated — complianceAutomation with real DB queries
import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { z } from "zod";

import { complianceReports } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

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
  .query(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const [{ total }] = await db
        .select({ total: count() })
        .from(complianceReports)
        .limit(100);
      const recent = await db
        .select()
        .from(complianceReports)
        .orderBy(desc(complianceReports.id))
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
// F-12 (expanded sweep): echo facade — returned "success ... completed"
// with no state change. Fail loud.
const runAssessment = protectedProcedure
  .input(
    z.object({
      id: z.number().optional(),
      data: z.record(z.string(), z.any()).optional(),
    })
  )
  .mutation(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "runAssessment: no assessment engine",
    });
  });
// F-12 (expanded sweep): echo facade — returned "success ... completed"
// with no state change. Fail loud.
const generateReport = protectedProcedure
  .input(
    z.object({
      id: z.number().optional(),
      data: z.record(z.string(), z.any()).optional(),
    })
  )
  .mutation(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "generateReport: no compliance-report engine",
    });
  });

export const complianceAutomationRouter = router({
  dashboard,
  runAssessment,
  generateReport,
});
