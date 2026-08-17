import { TRPCError } from "@trpc/server";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";
import { z } from "zod";

import { agents } from "../../drizzle/schema";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

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
      // F-12 (expanded sweep): was an AGT-001 fixture — real agents rows.
      // subAgents has no hierarchy store and is honestly 0.
      const db = await getDb();
      if (!db) return { agents: [], items: [], total: 0 };
      const rows = await db.select().from(agents).orderBy(desc(agents.id)).limit(100);
      const data = rows.map(r => ({
        id: String(r.id),
        name: r.name,
        role: r.role,
        territory: r.location,
        status: r.isActive ? "active" : "inactive",
        subAgents: 0,
      }));
      return { agents: data, items: data, total: data.length };
    }),
  getTree: protectedProcedure.query(async () => {
    // F-12 (expanded sweep): the tree was hardcoded — no parent/hierarchy
    // column exists on agents. Fail loud.
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getTree: no agent-hierarchy store is delivered",
    });
  }),
  territories: protectedProcedure.query(async () => {
    // F-12 (expanded sweep): territory rows were hardcoded — no territory
    // store is delivered. Fail loud.
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getTerritories: no territory store is delivered",
    });
  }),
  analytics: protectedProcedure.query(async () => {
    // F-12 (expanded sweep): was a hardcoded fixture — real aggregates.
    const db = await getDb();
    if (!db) return { totalAgents: 0, byRole: {}, byTerritory: {} };
    const [total] = await db.select({ value: count() }).from(agents);
    const roleRows = await db
      .select({ role: agents.role, cnt: count() })
      .from(agents)
      .groupBy(agents.role)
      .limit(20);
    const locRows = await db
      .select({ location: agents.location, cnt: count() })
      .from(agents)
      .groupBy(agents.location)
      .limit(50);
    const byRole: Record<string, number> = {};
    for (const r of roleRows) byRole[r.role ?? "unknown"] = Number(r.cnt);
    const byTerritory: Record<string, number> = {};
    for (const r of locRows) byTerritory[r.location ?? "unknown"] = Number(r.cnt);
    return { totalAgents: Number(total.value), byRole, byTerritory };
  }),
  // F-12 (expanded sweep): echo facade — and the agents table has no
  // parent/hierarchy column. Fail loud until a hierarchy store exists.
  reassignParent: protectedProcedure
    .input(z.object({ agentId: z.number(), newParentId: z.number() }))
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "reassignParent: no agent-hierarchy store is delivered",
      });
    }),
});
