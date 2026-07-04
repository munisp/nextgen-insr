// @ts-nocheck
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  eq,
  desc,
  and,
  sql,
  count,
  sum,
  isNull,
  gte,
  lte,
  or,
  asc,
} from "drizzle-orm";
import { agents, auditLog, systemConfig } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

export const decentralizedIdentityManagerRouter = router({
  dashboard: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { totalIdentities: 0, verified: 0, pending: 0, revoked: 0 };
    const [total] = await db.select({ value: count() }).from(agents).limit(100);
    const [verified] = await db
      .select({ value: count() })
      .from(agents)
      .where(eq(agents.isActive, true))
      .limit(100);
    return {
      totalIdentities: Number(total.value),
      verified: Number(verified.value),
      pending: 0,
      revoked: Number(total.value) - Number(verified.value),
    };
  }),
  listIdentities: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { identities: [], total: 0 };
        const rows = await db
          .select()
          .from(agents)
          .orderBy(desc(agents.createdAt))
          .limit(input?.limit ?? 20);
        return {
          identities: rows.map(a => ({
            id: a.id,
            agentId: a.agentId,
            name: a.name,
            verified: a.isActive,
            tier: a.tier,
          })),
          total: rows.length,
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
  verifyIdentity: protectedProcedure
    .input(z.object({ agentId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const [updated] = await db
          .update(agents)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(agents.id, input.agentId))
          .returning();
        await db.insert(auditLog).values({
          action: "identity_verified",
          resource: "agents",
          resourceId: String(input.agentId),
          status: "success",
        });
        return { success: true, agent: updated };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  revokeIdentity: protectedProcedure
    .input(z.object({ agentId: z.number(), reason: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const [updated] = await db
          .update(agents)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(agents.id, input.agentId))
          .returning();
        await db.insert(auditLog).values({
          action: "identity_revoked",
          resource: "agents",
          resourceId: String(input.agentId),
          status: "success",
          metadata: { reason: input.reason },
        });
        return { success: true, agent: updated };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  getStats: protectedProcedure.query(async () => {
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
  }),
});
