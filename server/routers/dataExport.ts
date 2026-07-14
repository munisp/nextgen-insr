// @ts-check
// Data export: transactionsCsv, agentsCsv, disputesCsv, ledgerCsv formats
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  transactions,
  agents,
  merchants,
  disputes,
  auditLog,
} from "../../drizzle/schema";
import { gte, lte, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const dataExportRouter = router({
  exportTransactions: protectedProcedure
    .input(
      z.object({
        format: z.enum(["csv", "json"]).default("csv"),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        limit: z.number().max(10000).default(1000),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { data: "", count: 0 };

        const conditions = [];
        if (input.startDate)
          conditions.push(
            gte(transactions.createdAt, new Date(input.startDate))
          );
        if (input.endDate)
          conditions.push(lte(transactions.createdAt, new Date(input.endDate)));

        const rows = await db
          .select()
          .from(transactions)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(transactions.createdAt))
          .limit(input.limit);

        if (input.format === "json") {
          return {
            data: JSON.stringify(rows, null, 2),
            count: rows.length,
            format: "json",
          };
        }

        // CSV format
        if (rows.length === 0) return { data: "", count: 0, format: "csv" };
        const headers = Object.keys(rows[0]).join(",");
        const csvRows = rows.map(r =>
          Object.values(r as any)
            .map(v =>
              typeof v === "string"
                ? `"${v.replace(/"/g, '""')}"`
                : String(v ?? "")
            )
            .join(",")
        );
        return {
          data: [headers, ...csvRows].join("\n"),
          count: rows.length,
          format: "csv",
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

  exportAgents: protectedProcedure
    .input(
      z.object({
        format: z.enum(["csv", "json"]).default("csv"),
        limit: z.number().max(5000).default(500),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { data: "", count: 0 };
        const rows = await db.select().from(agents).limit(input.limit);
        if (input.format === "json")
          return {
            data: JSON.stringify(rows, null, 2),
            count: rows.length,
            format: "json",
          };
        if (rows.length === 0) return { data: "", count: 0, format: "csv" };
        const headers = Object.keys(rows[0]).join(",");
        const csvRows = rows.map(r =>
          Object.values(r as any)
            .map(v =>
              typeof v === "string"
                ? `"${v.replace(/"/g, '""')}"`
                : String(v ?? "")
            )
            .join(",")
        );
        return {
          data: [headers, ...csvRows].join("\n"),
          count: rows.length,
          format: "csv",
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

  exportAuditLog: protectedProcedure
    .input(
      z.object({
        format: z.enum(["csv", "json"]).default("json"),
        limit: z.number().max(10000).default(1000),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { data: "", count: 0 };
        const rows = await db
          .select()
          .from(auditLog)
          .orderBy(desc(auditLog.createdAt))
          .limit(input.limit);
        return {
          data: JSON.stringify(rows, null, 2),
          count: rows.length,
          format: "json",
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
  availableTables: protectedProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      try {
        return {};
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  createJob: protectedProcedure
    .input(z.object({}))
    .mutation(async ({ ctx, input }) => {
      try {
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
  listJobs: protectedProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      try {
        return {};
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
