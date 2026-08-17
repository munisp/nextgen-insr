// Sprint 87: Regenerated — agentSuspensionWorkflow with real DB queries
import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { z } from "zod";

import { agentSuspensionLog } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

const list = protectedProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
    })
  )
  .query(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const lim = input.limit ?? 10;
      const offset = ((input.page ?? 1) - 1) * lim;
      const rows = await db
        .select()
        .from(agentSuspensionLog)
        .orderBy(desc(agentSuspensionLog.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(agentSuspensionLog)
        .limit(100);
      return { items: rows, total, page: input.page ?? 1, limit: lim };
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
const suspend = protectedProcedure
  .input(
    z.object({
      id: z.number().optional(),
      data: z.record(z.string(), z.any()).optional(),
    })
  )
  .mutation(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "suspend: no suspension workflow store",
    });
  });
// F-12 (wave-4b): lift was a copy-pasted LIST query (page/limit/search
// returning agent rows) — never a reinstate mutation. No suspension store
// exists — fail loud.
const lift = protectedProcedure
  .input(
    z.object({
      id: z.number().optional(),
      data: z.record(z.string(), z.any()).optional(),
    })
  )
  .mutation(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "lift: no suspension workflow store",
    });
  });

// F-12 (wave-4b): escalate restored (dropped by the round-57 assembly
// restore — runtime ReferenceError in contract tests). Fail loud.
const escalate = protectedProcedure
  .input(
    z.object({
      id: z.number().optional(),
      data: z.record(z.string(), z.any()).optional(),
    })
  )
  .mutation(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "escalate: no escalation store",
    });
  });

const getStats = protectedProcedure
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
        .from(agentSuspensionLog)
        .limit(100);
      const recent = await db
        .select()
        .from(agentSuspensionLog)
        .orderBy(desc(agentSuspensionLog.id))
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

export const agentSuspensionWorkflowRouter = router({
  list,
  suspend,
  lift,
  escalate,
  getStats,
});
