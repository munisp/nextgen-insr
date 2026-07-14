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
import { auditLog, systemConfig } from "@schema";
import { TRPCError } from "@trpc/server";

export const pbacManagementRouter = router({
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { totalPolicies: 0, totalRoles: 0, activeAssignments: 0 };
    const policies = await db
      .select()
      .from(systemConfig)
      .where(sql`${systemConfig.key} LIKE 'pbac_policy_%'`)
      .limit(100);
    const roles = await db
      .select()
      .from(systemConfig)
      .where(sql`${systemConfig.key} LIKE 'role_%'`)
      .limit(100);
    return {
      totalPolicies: policies.length,
      totalRoles: roles.length,
      activeAssignments: 0,
    };
  }),
  listPolicies: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { policies: [], total: 0 };
        const rows = await db
          .select()
          .from(systemConfig)
          .where(sql`${systemConfig.key} LIKE 'pbac_policy_%'`)
          .limit(input?.limit ?? 50);
        return {
          policies: rows.map(r => ({
            id: r.key.replace("pbac_policy_", ""),
            ...JSON.parse(String(r.value ?? "{}")),
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
  createPolicy: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        resource: z.string(),
        actions: z.array(z.string()),
        conditions: z.record(z.string(), z.any()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const key =
          "pbac_policy_" + input.name.toLowerCase().replace(/\s+/g, "_");
        await db.insert(systemConfig).values({
          key,
          value: JSON.stringify({
            ...input,
            createdAt: new Date().toISOString(),
          }),
        });
        await db.insert(auditLog).values({
          action: "pbac_policy_created",
          resource: "pbac",
          resourceId: key,
          status: "success",
          metadata: { name: input.name },
        });
        return { success: true, policyId: key };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  deletePolicy: protectedProcedure
    .input(z.object({ policyId: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db
          .delete(systemConfig)
          .where(eq(systemConfig.key, "pbac_policy_" + input.policyId));
        await db.insert(auditLog).values({
          action: "pbac_policy_deleted",
          resource: "pbac",
          resourceId: input.policyId,
          status: "success",
        });
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

  assignRole: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      return { success: true };
    }),

  getAuditLog: protectedProcedure.query(async () => {
    return { data: [], total: 0 };
  }),

  getRoleDetail: protectedProcedure.query(async () => {
    return { data: [], total: 0 };
  }),

  listPermissions: protectedProcedure.query(async () => {
    return { data: [], total: 0 };
  }),

  listRoles: protectedProcedure.query(async () => {
    return { data: [], total: 0 };
  }),

  listUserAssignments: protectedProcedure.query(async () => {
    return { data: [], total: 0 };
  }),

  modifyPermissions: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      return { success: true };
    }),

  removeAssignment: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      return { success: true };
    }),
});
