import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}
import {
  billingRoleAssignments,
  billingAuditLog,
  tenantBillingConfig,
} from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { eq, and, desc } from "drizzle-orm";
import { logger } from './_core/logger';

// ═══════════════════════════════════════════════════════════════════════════════
// Billing Permission Definitions (Permify-compatible)
// ═══════════════════════════════════════════════════════════════════════════════

export const BILLING_PERMISSIONS = {
  view_ledger: "view_ledger",
  record_split: "record_split",
  run_reconciliation: "run_reconciliation",
  manage_billing_config: "manage_billing_config",
  view_dashboard: "view_dashboard",
  export_data: "export_data",
  resolve_discrepancy: "resolve_discrepancy",
  manage_tenant_billing: "manage_tenant_billing",
} as const;

export type BillingPermission = keyof typeof BILLING_PERMISSIONS;

// Role → Permission mapping (hierarchical)
export const ROLE_PERMISSIONS: Record<string, BillingPermission[]> = {
  platform_admin: [
    "view_ledger",
    "record_split",
    "run_reconciliation",
    "manage_billing_config",
    "view_dashboard",
    "export_data",
    "resolve_discrepancy",
    "manage_tenant_billing",
  ],
  billing_admin: [
    "view_ledger",
    "record_split",
    "run_reconciliation",
    "manage_billing_config",
    "view_dashboard",
    "export_data",
    "resolve_discrepancy",
  ],
  billing_analyst: [
    "view_ledger",
    "run_reconciliation",
    "view_dashboard",
    "export_data",
  ],
  billing_viewer: ["view_ledger", "view_dashboard"],
};

// ═══════════════════════════════════════════════════════════════════════════════
// Permify Policy Definition (for external Permify service)
// ═══════════════════════════════════════════════════════════════════════════════

export const PERMIFY_SCHEMA = `
entity tenant {}

entity billing_resource {
  relation tenant @tenant
  relation platform_admin @user
  relation billing_admin @user
  relation billing_analyst @user
  relation billing_viewer @user

  permission view_ledger = platform_admin or billing_admin or billing_analyst or billing_viewer
  permission record_split = platform_admin or billing_admin
  permission run_reconciliation = platform_admin or billing_admin or billing_analyst
  permission manage_billing_config = platform_admin or billing_admin
  permission view_dashboard = platform_admin or billing_admin or billing_analyst or billing_viewer
  permission export_data = platform_admin or billing_admin or billing_analyst
  permission resolve_discrepancy = platform_admin or billing_admin
  permission manage_tenant_billing = platform_admin
}
`;

// ═══════════════════════════════════════════════════════════════════════════════
// Permission Check Functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if a user has a specific billing permission for a tenant.
 * First checks local DB role assignments, then falls back to Permify if configured.
 */
export async function checkBillingPermission(
  userId: number,
  tenantId: number,
  permission: BillingPermission
): Promise<boolean> {
  // 1. Check local role assignments
  const database = await db();
  const assignments = await database
    .select()
    .from(billingRoleAssignments)
    .where(
      and(
        eq(billingRoleAssignments.userId, userId),
        eq(billingRoleAssignments.tenantId, tenantId),
        eq(billingRoleAssignments.isActive, true)
      )
    );

  for (const assignment of assignments) {
    // Check if role expired
    if (assignment.expiresAt && new Date(assignment.expiresAt) < new Date()) {
      continue;
    }
    // Check custom permissions first
    const customPerms = assignment.permissions as string[] | null;
    if (customPerms && customPerms.includes(permission)) {
      return true;
    }
    // Check role-based permissions
    const rolePerms = ROLE_PERMISSIONS[assignment.billingRole];
    if (rolePerms && rolePerms.includes(permission)) {
      return true;
    }
  }

  // 2. Fallback: check Permify (if PERMIFY_URL is configured)
  const permifyUrl = process.env.PERMIFY_URL;
  if (permifyUrl) {
    try {
      const response = await fetch(
        `${permifyUrl}/v1/tenants/${tenantId}/permissions/check`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.PERMIFY_API_KEY || ""}`,
          },
          body: JSON.stringify({
            entity: { type: "billing_resource", id: `tenant_${tenantId}` },
            permission,
            subject: { type: "user", id: String(userId) },
          }),
        }
      );
      if (response.ok) {
        const result = await response.json();
        return result.can === "CHECK_RESULT_ALLOWED";
      }
    } catch (e) {
      logger.warn(
        "[BillingRBAC] Permify check failed, using local only:",
        (e as Error).message
      );
    }
  }

  return false;
}

/**
 * Require a billing permission or throw FORBIDDEN.
 */
export async function requireBillingPermission(
  userId: number,
  tenantId: number,
  permission: BillingPermission
): Promise<void> {
  const allowed = await checkBillingPermission(userId, tenantId, permission);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Billing permission '${permission}' required for tenant ${tenantId}`,
    });
  }
}

/**
 * Get all billing permissions for a user in a tenant.
 */
export async function getUserBillingPermissions(
  userId: number,
  tenantId: number
): Promise<{ role: string; permissions: BillingPermission[] }> {
  const database2 = await db();
  const assignments = await database2
    .select()
    .from(billingRoleAssignments)
    .where(
      and(
        eq(billingRoleAssignments.userId, userId),
        eq(billingRoleAssignments.tenantId, tenantId),
        eq(billingRoleAssignments.isActive, true)
      )
    );

  const allPerms = new Set<BillingPermission>();
  let highestRole = "billing_viewer";
  const roleHierarchy = [
    "billing_viewer",
    "billing_analyst",
    "billing_admin",
    "platform_admin",
  ];

  for (const assignment of assignments) {
    if (assignment.expiresAt && new Date(assignment.expiresAt) < new Date())
      continue;
    const roleIdx = roleHierarchy.indexOf(assignment.billingRole);
    if (roleIdx > roleHierarchy.indexOf(highestRole)) {
      highestRole = assignment.billingRole;
    }
    const rolePerms = ROLE_PERMISSIONS[assignment.billingRole] || [];
    rolePerms.forEach(p => allPerms.add(p));
    const customPerms = (assignment.permissions as string[] | null) || [];
    customPerms.forEach(p => allPerms.add(p as BillingPermission));
  }

  return { role: highestRole, permissions: Array.from(allPerms) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Billing RBAC Router
// ═══════════════════════════════════════════════════════════════════════════════

export const billingRbacRouter = router({
  // Get current user's billing permissions for a tenant
  getMyPermissions: protectedProcedure
    .input(z.object({ tenantId: z.number() }))
    .query(async ({ ctx, input }) => {
      try {
        return getUserBillingPermissions(ctx.user.id, input.tenantId);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Assign a billing role to a user (requires manage_tenant_billing)
  assignRole: protectedProcedure
    .input(
      z.object({
        userId: z.number(),
        tenantId: z.number(),
        billingRole: z.enum([
          "platform_admin",
          "billing_admin",
          "billing_analyst",
          "billing_viewer",
        ]),
        customPermissions: z.array(z.string()).optional(),
        expiresAt: z.string().datetime().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await requireBillingPermission(
          ctx.user.id,
          input.tenantId,
          "manage_tenant_billing"
        );

        const [assignment] = await (
          await db()
        )
          .insert(billingRoleAssignments)
          .values({
            userId: input.userId,
            tenantId: input.tenantId,
            billingRole: input.billingRole,
            permissions: input.customPermissions || null,
            grantedBy: ctx.user.id,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          })
          .returning();

        // Audit log
        await (await db()).insert(billingAuditLog).values({
          tenantId: input.tenantId,
          userId: ctx.user.id,
          userName: ctx.user.name || "unknown",
          action: "permission_granted",
          resourceType: "billing_role_assignment",
          resourceId: String(assignment.id),
          afterState: { role: input.billingRole, targetUser: input.userId },
          metadata: { customPermissions: input.customPermissions },
        });

        return { success: true, assignmentId: assignment.id };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Revoke a billing role (requires manage_tenant_billing)
  revokeRole: protectedProcedure
    .input(z.object({ assignmentId: z.number(), tenantId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await requireBillingPermission(
          ctx.user.id,
          input.tenantId,
          "manage_tenant_billing"
        );

        const dbRev = await db();
        const [existing] = await dbRev
          .select()
          .from(billingRoleAssignments)
          .where(eq(billingRoleAssignments.id, input.assignmentId));

        if (!existing)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Assignment not found",
          });

        await (await db())
          .update(billingRoleAssignments)
          .set({ isActive: false })
          .where(eq(billingRoleAssignments.id, input.assignmentId));

        // Audit log
        await (await db()).insert(billingAuditLog).values({
          tenantId: input.tenantId,
          userId: ctx.user.id,
          userName: ctx.user.name || "unknown",
          action: "permission_revoked",
          resourceType: "billing_role_assignment",
          resourceId: String(input.assignmentId),
          beforeState: {
            role: existing.billingRole,
            targetUser: existing.userId,
          },
          afterState: { isActive: false },
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

  // List all role assignments for a tenant (requires manage_tenant_billing)
  listAssignments: protectedProcedure
    .input(z.object({ tenantId: z.number() }))
    .query(async ({ ctx, input }) => {
      try {
        await requireBillingPermission(
          ctx.user.id,
          input.tenantId,
          "manage_tenant_billing"
        );

        const dbList = await db();
        const assignments = await dbList
          .select()
          .from(billingRoleAssignments)
          .where(eq(billingRoleAssignments.tenantId, input.tenantId))
          .orderBy(desc(billingRoleAssignments.grantedAt));

        return { assignments, total: assignments.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Get Permify schema definition (for admin reference)
  getPermifySchema: protectedProcedure.query(async () => ({
    schema: PERMIFY_SCHEMA,
    roles: Object.keys(ROLE_PERMISSIONS),
    permissions: Object.keys(BILLING_PERMISSIONS),
    rolePermissionMatrix: ROLE_PERMISSIONS,
  })),
});
