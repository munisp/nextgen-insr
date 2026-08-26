import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { agents } from "@schema";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";

export const agentHierarchyRouter = router({
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database)
        return { data: [], items: [], total: 0, limit: 0, offset: 0 };
      const [record] = await database
        .select()
        .from(agents)
        .where(eq(agents.id, input.id))
        .limit(1);

      if (!record) {
        throw new Error(`Record with id ${input.id} not found`);
      }
      return record;
    }),

  getSummary: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database)
      return { data: [], items: [], total: 0, limit: 0, offset: 0 };
    const _totalRows = await database.select({ total: count() }).from(agents);
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
      if (!database)
        return { data: [], items: [], total: 0, limit: 0, offset: 0 };
      const since = new Date();
      since.setDate(since.getDate() - input.days);

      const results = await database
        .select()
        .from(agents)
        .orderBy(desc(agents.id))
        .limit(input.limit);

      return results;
    }),

  // ── Sprint 28 domain procedures ──
  list: publicProcedure
    .input(
      z
        .object({
          role: z.string().optional(),
          territory: z.string().optional(),
          search: z.string().optional(),
        })
        .optional()
    )
    .query(async () => {
      // DD-LEGACY: previously returned a fabricated agent record (with PII)
      // through a PUBLIC procedure. No hierarchy view is backed by real
      // role/territory data here — fail loud.
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message:
          "agentHierarchy.list is not implemented: no role/territory hierarchy source exists in this service. Previously returned fabricated agent data via a public endpoint.",
      });
    }),
  getTree: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message:
        "agentHierarchy.getTree is not implemented: no hierarchy tree source exists in this service. Previously returned a fabricated tree.",
    });
  }),
  territories: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message:
        "agentHierarchy.territories is not implemented: no territory registry exists in this service. Previously returned fabricated territories.",
    });
  }),
  analytics: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message:
        "agentHierarchy.analytics is not implemented: no hierarchy analytics pipeline exists in this service. Previously returned fabricated counts.",
    });
  }),
  reassignParent: protectedProcedure
    .input(z.object({ agentId: z.number(), newParentId: z.number() }))
    .mutation(async () => {
      // DD-LEGACY: previously echoed success:true with NO DB write — a
      // phantom hierarchy mutation. Fail loud.
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message:
          "agentHierarchy.reassignParent is not implemented: no hierarchy persistence exists in this service. Previously echoed success without writing anything.",
      });
    }),
});
