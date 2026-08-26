import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { auditLog } from "@schema";
import { desc, eq, and, count, gte, lte, inArray } from "drizzle-orm";

/**
 * Audit Trail Export Router
 *
 * Exports audit data for compliance reporting and external auditors.
 * DD-LEGACY: the previous implementation returned a fabricated `downloadUrl`
 * for a file that was never written. Exports are now generated for real and
 * returned inline (CSV or JSON content in the response). PDF generation is
 * not available in this service and fails loud.
 */

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const auditTrailExportRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(20), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0 };
      const results = await database.select().from(auditLog).orderBy(desc(auditLog.id)).limit(input.limit).offset(input.offset);
      const [{ total }] = await database.select({ total: count() }).from(auditLog);
      return { data: results, total: total ?? 0 };
    }),
  export: protectedProcedure
    .input(z.object({
      format: z.enum(["csv", "json", "pdf"]),
      dateFrom: z.string(),
      dateTo: z.string(),
      actions: z.array(z.string()).optional(),
      maxRecords: z.number().max(100000).default(10000),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.format === "pdf") {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message:
            "auditTrailExport PDF format is not implemented: no PDF renderer exists in this service. Use format 'csv' or 'json', which return the real export content inline.",
        });
      }
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      // Honest filtering: apply the caller's date range and action filters.
      const conditions = [
        gte(auditLog.createdAt, new Date(input.dateFrom)),
        lte(auditLog.createdAt, new Date(input.dateTo)),
      ];
      if (input.actions && input.actions.length > 0) {
        conditions.push(inArray(auditLog.action, input.actions) as never);
      }
      const results = await database
        .select()
        .from(auditLog)
        .where(and(...conditions))
        .orderBy(desc(auditLog.id))
        .limit(input.maxRecords);

      const exportId = `EXP-${Date.now().toString(36).toUpperCase()}`;
      const generatedAt = new Date().toISOString();

      let content: string;
      let contentType: string;
      if (input.format === "csv") {
        const header =
          "id,agentId,userId,action,resource,resourceId,ipAddress,userAgent,status,tenantId,createdAt,metadata";
        const rows = results.map((r: Record<string, unknown>) =>
          [
            r.id,
            r.agentId,
            r.userId,
            r.action,
            r.resource,
            r.resourceId,
            r.ipAddress,
            r.userAgent,
            r.status,
            r.tenantId,
            r.createdAt,
            r.metadata,
          ]
            .map(csvEscape)
            .join(",")
        );
        content = [header, ...rows].join("\n");
        contentType = "text/csv";
      } else {
        content = JSON.stringify(
          {
            exportId,
            generatedAt,
            generatedBy: ctx.user?.id ?? null,
            filters: {
              dateFrom: input.dateFrom,
              dateTo: input.dateTo,
              actions: input.actions ?? null,
            },
            recordCount: results.length,
            records: results,
          },
          null,
          2
        );
        contentType = "application/json";
      }

      return {
        exportId,
        format: input.format,
        recordCount: results.length,
        status: "completed",
        contentType,
        // Real export artifact — returned inline; no fabricated download URL.
        content,
        generatedAt,
      };
    }),
  getExportHistory: protectedProcedure
    .input(z.object({ limit: z.number().default(10) }))
    .query(async () => {
      // FAIL-LOUD (DD-LEGACY): exports are generated inline and are not
      // persisted, so there is no real export history to return. Returning
      // an empty list would falsely claim no exports were ever generated.
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message:
          "auditTrailExport.getExportHistory is not implemented: export artifacts are returned inline and no export-history persistence exists in this service.",
      });
    }),
});
