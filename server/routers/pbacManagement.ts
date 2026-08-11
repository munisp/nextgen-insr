// @ts-check
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  eq,
  desc,
  sql,
} from "drizzle-orm";
import { auditLog, systemConfig } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

// MOCKWARE FIX: There is no remote Permify write API wired for role/permission
// management (pbacEnforcement only exposes read-side authorization checks).
// Role assignments are therefore persisted as real state in system_config
// (the same store this router already uses for policies), and every query
// reads that state. Nothing returns no-op success anymore.

const ASSIGNMENT_PREFIX = "pbac_assignment_";
const ROLE_PREFIX = "role_";
const POLICY_PREFIX = "pbac_policy_";

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
    const assignments = await db
      .select()
      .from(systemConfig)
      .where(sql`${systemConfig.key} LIKE 'pbac_assignment_%'`)
      .limit(500);
    return {
      totalPolicies: policies.length,
      totalRoles: roles.length,
      activeAssignments: assignments.length,
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
            id: r.key.replace(POLICY_PREFIX, ""),
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
          POLICY_PREFIX + input.name.toLowerCase().replace(/\s+/g, "_");
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
          .where(eq(systemConfig.key, POLICY_PREFIX + input.policyId));
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
      z.object({
        id: z.union([z.number(), z.string()]).optional(),
        userId: z.union([z.number(), z.string()]).optional(),
        role: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const subjectId = input.userId ?? input.id;
      if (!subjectId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "userId is required" });
      }
      if (!input.role) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "role is required" });
      }
      const db = await getDb();
      if (!db)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const key = ASSIGNMENT_PREFIX + String(subjectId);
      const value = JSON.stringify({
        userId: String(subjectId),
        role: input.role,
        assignedAt: new Date().toISOString(),
      });
      await db
        .insert(systemConfig)
        .values({ key, value })
        .onConflictDoUpdate({
          target: systemConfig.key,
          set: { value, updatedAt: new Date() },
        });
      await db.insert(auditLog).values({
        action: "pbac_role_assigned",
        resource: "pbac",
        resourceId: String(subjectId),
        status: "success",
        metadata: { role: input.role },
      });
      return { success: true, userId: String(subjectId), role: input.role };
    }),

  getAuditLog: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { data: [], total: 0 };
    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.resource, "pbac"))
      .orderBy(desc(auditLog.id))
      .limit(100);
    return { data: rows, total: rows.length };
  }),

  getRoleDetail: protectedProcedure
    .input(z.object({ roleId: z.string() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { data: [], total: 0 };
      if (!input?.roleId) return { data: [], total: 0 };
      const rows = await db
        .select()
        .from(systemConfig)
        .where(eq(systemConfig.key, ROLE_PREFIX + input.roleId))
        .limit(1);
      return {
        data: rows.map(r => ({
          id: r.key.replace(ROLE_PREFIX, ""),
          ...JSON.parse(String(r.value ?? "{}")),
        })),
        total: rows.length,
      };
    }),

  listPermissions: protectedProcedure.query(async () => {
    // Permissions currently granted by stored policies — real state only.
    const db = await getDb();
    if (!db) return { data: [], total: 0 };
    const rows = await db
      .select()
      .from(systemConfig)
      .where(sql`${systemConfig.key} LIKE 'pbac_policy_%'`)
      .limit(200);
    const perms = new Set<string>();
    for (const r of rows) {
      try {
        const parsed = JSON.parse(String(r.value ?? "{}"));
        const actions: string[] = Array.isArray(parsed.actions) ? parsed.actions : [];
        for (const a of actions) perms.add(`${parsed.resource ?? "*"}:${a}`);
      } catch {
        // skip malformed policy rows
      }
    }
    const data = Array.from(perms);
    return { data, total: data.length };
  }),

  listRoles: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { data: [], total: 0 };
    const rows = await db
      .select()
      .from(systemConfig)
      .where(sql`${systemConfig.key} LIKE 'role_%'`)
      .limit(100);
    return {
      data: rows.map(r => ({
        id: r.key.replace(ROLE_PREFIX, ""),
        ...JSON.parse(String(r.value ?? "{}")),
      })),
      total: rows.length,
    };
  }),

  listUserAssignments: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { data: [], total: 0 };
    const rows = await db
      .select()
      .from(systemConfig)
      .where(sql`${systemConfig.key} LIKE 'pbac_assignment_%'`)
      .limit(500);
    return {
      data: rows.map(r => ({
        id: r.key.replace(ASSIGNMENT_PREFIX, ""),
        ...JSON.parse(String(r.value ?? "{}")),
      })),
      total: rows.length,
    };
  }),

  modifyPermissions: protectedProcedure
    .input(
      z.object({
        id: z.union([z.number(), z.string()]).optional(),
        policyId: z.string().optional(),
        actions: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const policyId = input.policyId ?? (input.id != null ? String(input.id) : undefined);
      if (!policyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "policyId is required" });
      }
      const db = await getDb();
      if (!db)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const key = POLICY_PREFIX + policyId;
      const rows = await db
        .select()
        .from(systemConfig)
        .where(eq(systemConfig.key, key))
        .limit(1);
      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Policy ${policyId} not found` });
      }
      const data = JSON.parse(String(rows[0].value ?? "{}"));
      if (input.actions) data.actions = input.actions;
      data.updatedAt = new Date().toISOString();
      await db
        .update(systemConfig)
        .set({ value: JSON.stringify(data), updatedAt: new Date() })
        .where(eq(systemConfig.key, key));
      await db.insert(auditLog).values({
        action: "pbac_policy_modified",
        resource: "pbac",
        resourceId: policyId,
        status: "success",
        metadata: { actions: input.actions ?? [] },
      });
      return { success: true, policyId };
    }),

  removeAssignment: protectedProcedure
    .input(
      z.object({
        id: z.union([z.number(), z.string()]).optional(),
        userId: z.union([z.number(), z.string()]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const subjectId = input.userId ?? input.id;
      if (!subjectId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "userId is required" });
      }
      const db = await getDb();
      if (!db)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const key = ASSIGNMENT_PREFIX + String(subjectId);
      const rows = await db
        .select()
        .from(systemConfig)
        .where(eq(systemConfig.key, key))
        .limit(1);
      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: `No role assignment for user ${subjectId}` });
      }
      await db.delete(systemConfig).where(eq(systemConfig.key, key));
      await db.insert(auditLog).values({
        action: "pbac_assignment_removed",
        resource: "pbac",
        resourceId: String(subjectId),
        status: "success",
      });
      return { success: true, userId: String(subjectId) };
    }),
});
