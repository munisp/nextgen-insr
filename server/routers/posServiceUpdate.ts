/**
 * posServiceUpdate.ts — POS Service Update Router
 *
 * Read-side tracking of service/maintenance records for POS terminals,
 * backed by the drizzle `serviceRecords` table (service_records).
 * Follows the Sprint 38 router conventions (see merchantAnalyticsDash.ts):
 * protectedProcedure everywhere, zod input validation, graceful empty
 * results when the database is unavailable.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { serviceRecords } from "../../drizzle/schema";
import { desc, eq, count, sql, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const posServiceUpdateRouter = router({
  // ── Paginated list of service records ─────────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        terminalId: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
      try {
        const conditions = input.terminalId
          ? [eq(serviceRecords.terminalId, input.terminalId)]
          : [];
        const results = await database
          .select()
          .from(serviceRecords)
          .where(conditions.length ? conditions[0] : undefined)
          .orderBy(desc(serviceRecords.createdAt))
          .limit(input.limit)
          .offset(input.offset);

        const _totalRows = await database
          .select({ total: count() })
          .from(serviceRecords)
          .where(conditions.length ? conditions[0] : undefined);
        const totalResult = Array.isArray(_totalRows)
          ? _totalRows[0]
          : _totalRows;

        return {
          data: results,
          total: totalResult?.total ?? 0,
          limit: input.limit,
          offset: input.offset,
        };
      } catch {
        return { data: [], total: 0, limit: 0, offset: 0 };
      }
    }),

  // ── Single service record ─────────────────────────────────────────────────
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database unavailable",
        });
      const [record] = await database
        .select()
        .from(serviceRecords)
        .where(eq(serviceRecords.id, input.id))
        .limit(1);

      if (!record) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Service record with id ${input.id} not found`,
        });
      }
      return record;
    }),

  // ── Recent service records (last N days) ──────────────────────────────────
  getRecent: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(7),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [];
      const since = new Date();
      since.setDate(since.getDate() - input.days);

      return database
        .select()
        .from(serviceRecords)
        .where(gte(serviceRecords.createdAt, since))
        .orderBy(desc(serviceRecords.createdAt))
        .limit(input.limit);
    }),

  // ── Aggregate statistics ──────────────────────────────────────────────────
  getStats: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database)
      return {
        totalRecords: 0,
        terminalsServiced: 0,
        recordsLast7Days: 0,
        lastUpdated: new Date().toISOString(),
      };
    try {
      const [{ total }] = await database
        .select({ total: count() })
        .from(serviceRecords);
      const [{ terminals }] = await database
        .select({
          terminals: sql<number>`count(distinct ${serviceRecords.terminalId})::int`,
        })
        .from(serviceRecords);
      const since = new Date();
      since.setDate(since.getDate() - 7);
      const [{ recent }] = await database
        .select({ recent: count() })
        .from(serviceRecords)
        .where(gte(serviceRecords.createdAt, since));

      return {
        totalRecords: Number(total ?? 0),
        terminalsServiced: Number(terminals ?? 0),
        recordsLast7Days: Number(recent ?? 0),
        lastUpdated: new Date().toISOString(),
      };
    } catch {
      return {
        totalRecords: 0,
        terminalsServiced: 0,
        recordsLast7Days: 0,
        lastUpdated: new Date().toISOString(),
      };
    }
  }),
});
