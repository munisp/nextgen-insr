import { TRPCError } from "@trpc/server";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";
import { z } from "zod";

import { auditLog } from "../../drizzle/schema";
import { permifyCheck } from "../_core/permify";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

// ── Middleware Integration (Sprint 44) ──────────────────────────────
import { fluvioProduce } from "../fluvio";
import { publishEvent, type KafkaTopic } from "../kafkaClient";
import { cacheSet, cacheGet } from "../redisClient";
import { tbCreateTransfer } from "../tbClient";

// MOCKWARE FIX: initiateTransfer previously returned success without any
// remittance partner call. It now fails loudly when no remittance partner
// is configured, and reports NOT_IMPLEMENTED when one is configured but the
// client integration has not been built.

function isRemittancePartnerConfigured(): boolean {
  return !!(
    process.env.REMITTANCE_PARTNER_URL ||
    process.env.REMITTANCE_PARTNER_API_KEY ||
    process.env.MOJALOOP_ENDPOINT
  );
}

export const crossBorderRemittanceHubRouter = router({
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
        if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
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
          data: results,
          total: totalResult?.total ?? 0,
          limit: input.limit,
          offset: input.offset,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
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
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  getSummary: protectedProcedure.query(async () => {
    try {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
      const _totalRows = await database
        .select({ total: count() })
        .from(auditLog);
      const totalResult = Array.isArray(_totalRows)
        ? _totalRows[0]
        : _totalRows;

      return {
        totalRecords: totalResult?.total ?? 0,
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),

  getRecent: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(7),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ input }) => {
      try {
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
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  getStats: protectedProcedure.query(async () => {
    try {
      const database = await getDb();
      if (!database)
        return {
          total: 0,
          active: 0,
          recent: 0,
          lastUpdated: new Date().toISOString(),
        };
      try {
        await database.execute(sql`SELECT 1 as ok`);
        return {
          total: 0,
          active: 0,
          recent: 0,
          lastUpdated: new Date().toISOString(),
        };
      } catch {
        return {
          total: 0,
          active: 0,
          recent: 0,
          lastUpdated: new Date().toISOString(),
        };
      }
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),

  initiateTransfer: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      if (!isRemittancePartnerConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cross-border remittance partner not configured",
        });
      }
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "Remittance partner integration is not wired in this service",
      });
    }),

  listInsuranceRegions: protectedProcedure.query(async () => {
    try {
      return { data: [], total: 0 };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),
});
