// TypeScript enabled — Sprint 96 security audit
/**
 * P1-B: Tenant Isolation Middleware
 *
 * Enforces row-level tenant isolation for multi-tenant deployments.
 * Every tRPC procedure that touches tenant-scoped data should use
 * `requireTenant` to ensure users can only access their own tenant's data.
 *
 * Architecture:
 *   - Each user row has a `tenantId` column (nullable for super-admins).
 *   - Super-admins (role === 'super_admin') may pass an explicit tenantId.
 *   - Regular users are always scoped to their own tenantId.
 *   - If a user has no tenantId and is not a super-admin, access is denied.
 *
 * Usage in tRPC procedures:
 *   import { withTenant } from "../middleware/tenantIsolation";
 *
 *   // Automatically resolves tenantId from ctx.user
 *   const tenantProcedure = protectedProcedure.use(withTenant);
 *
 *   // Then in the procedure handler:
 *   .query(async ({ ctx }) => {
 *     const { tenantId } = ctx;  // guaranteed non-null
 *     return db.select().from(agents).where(eq(agents.tenantId, tenantId));
 *   })
 */
import { TRPCError } from "@trpc/server";

import type { TrpcContext } from "../_core/context";

export type TenantContext = TrpcContext & { tenantId: number };

/**
 * tRPC middleware that resolves and enforces tenantId.
 * Injects `ctx.tenantId` for downstream procedures.
 */
export const withTenant = async ({
  ctx,
  next,
}: {
  ctx: TrpcContext;
  next: (opts: { ctx: TenantContext }) => Promise<any>;
}) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }

  const isSuperAdmin = (ctx.user as any).role === "super_admin";

  if (!ctx.user.tenantId && !isSuperAdmin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "No tenant assigned to this account. Contact your administrator.",
    });
  }

  // Super-admins without a tenantId get tenantId = 0 (global scope marker)
  const tenantId = ctx.user.tenantId ?? 0;

  return next({ ctx: { ...ctx, tenantId } });
};

/**
 * Helper: asserts that a given record belongs to the current tenant.
 * Throws FORBIDDEN if the record's tenantId doesn't match.
 *
 * @param recordTenantId - The tenantId from the DB record
 * @param userTenantId   - The tenantId from ctx.tenantId
 * @param resourceName   - Human-readable name for error messages
 */
export function assertTenantOwnership(
  recordTenantId: number | null | undefined,
  userTenantId: number,
  resourceName = "resource"
): void {
  // Super-admin (tenantId=0) can access everything
  if (userTenantId === 0) return;

  if (recordTenantId !== userTenantId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Access denied: ${resourceName} belongs to a different tenant.`,
    });
  }
}

/**
 * Builds a Drizzle WHERE condition for tenant-scoped queries.
 * Returns undefined for super-admins (no tenant filter).
 *
 * @example
 * import { eq } from "drizzle-orm";
 * import { tenantFilter } from "../middleware/tenantIsolation";
 *
 * const filter = tenantFilter(agents, ctx.tenantId);
 * const rows = await db.select().from(agents).where(filter);
 */
export function tenantFilter(table: { tenantId: any }, userTenantId: number) {
  if (userTenantId === 0) return undefined; // super-admin: no filter
  const { eq } = require("drizzle-orm");
  return eq(table.tenantId, userTenantId);
}
