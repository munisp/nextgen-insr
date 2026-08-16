import { TRPCError } from "@trpc/server";
import { inArray, desc } from "drizzle-orm";
import { z } from "zod";

import { auditLog } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getAuditLog , getDb } from "../db";
import { getAgentFromCookie } from "../middleware/agentAuth";

export const auditLogRouter = router({
  list: protectedProcedure
    .input(
      z.object({ limit: z.number().default(50), offset: z.number().default(0) })
    )
    .query(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });
        return getAuditLog(session.id, input.limit, input.offset);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Admin: all agents
  listAll: protectedProcedure
    .input(
      z.object({
        limit: z.number().default(100),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        return getAuditLog(undefined, input.limit, input.offset);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Filter by specific action types (Terminal Events, Compliance Reports, etc.)
  listByActions: protectedProcedure
    .input(
      z.object({
        actions: z.array(z.string()),
        limit: z.number().default(50),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database connection unavailable");
        return db
          .select()
          .from(auditLog)
          .where(inArray(auditLog.action, input.actions))
          .orderBy(desc(auditLog.createdAt))
          .limit(input.limit)
          .offset(input.offset);
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
