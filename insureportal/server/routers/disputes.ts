import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { disputes } from "@schema";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";

export const disputesRouter = router({
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
          .from(disputes)
          .orderBy(desc(disputes.id))
          .limit(input.limit)
          .offset(input.offset);

        const _totalRows = await database
          .select({ total: count() })
          .from(disputes);
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
        .from(disputes)
        .where(eq(disputes.id, input.id))
        .limit(1);

      if (!record) {
        throw new Error(`Record with id ${input.id} not found`);
      }
      return record;
    }),

  getSummary: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
    const _totalRows = await database.select({ total: count() }).from(disputes);
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
        .from(disputes)
        .orderBy(desc(disputes.id))
        .limit(input.limit);

      return results;
    }),
  listAll: protectedProcedure
    .input(
      z.object({
        status: z.string().default("all"),
        page: z.number().default(1),
        limit: z.number().default(20),
      })
    )
    .query(async ({ ctx }) => {
      if (
        !ctx.user ||
        (ctx.user.role !== "admin" && ctx.user.role !== "supervisor")
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Unauthorized — admin or supervisor role required",
        });
      }
      return { disputes: [], total: 0 };
    }),
  resolve: protectedProcedure
    .input(
      z.object({
        disputeRef: z.string(),
        resolution: z.string(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (
        !ctx.user ||
        (ctx.user.role !== "admin" && ctx.user.role !== "supervisor")
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Unauthorized — admin or supervisor role required",
        });
      }
      return { disputeRef: input.disputeRef, resolved: true };
    }),
});
