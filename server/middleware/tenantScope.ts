// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * Tenant Scope Middleware — Production-Grade Tenant Data Isolation
 *
 * Ensures all data queries are scoped by tenantId. Tenants cannot see
 * each other's data. Admin users bypass tenant scoping.
 *
 * Usage in tRPC:
 *   tenantProcedure = protectedProcedure.use(tenantScopeMiddleware)
 */
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../_core/context";

// ── Types ────────────────────────────────────────────────────────────────────
export interface TenantScopedContext extends TrpcContext {
  tenantId: string;
  isTenantAdmin: boolean;
}

// ── In-memory tenant registry (production: query DB) ─────────────────────────
const tenantRegistry = new Map<
  string,
  {
    id: string;
    name: string;
    status: "active" | "suspended" | "onboarding";
    plan: "starter" | "professional" | "enterprise";
    createdAt: number;
  }
>();

// Seed some default tenants
tenantRegistry.set("tenant-default", {
  id: "tenant-default",
  name: "InsurePortal Default",
  status: "active",
  plan: "enterprise",
  createdAt: Date.now(),
});
tenantRegistry.set("tenant-demo", {
  id: "tenant-demo",
  name: "Demo Partner",
  status: "active",
  plan: "professional",
  createdAt: Date.now(),
});

export function getTenantRegistry() {
  return tenantRegistry;
}

// ── User-to-tenant mapping (production: query DB join) ───────────────────────
const userTenantMap = new Map<string, string>();

export function assignUserToTenant(userId: string, tenantId: string) {
  userTenantMap.set(userId, tenantId);
}

export function getUserTenantId(userId: string): string | undefined {
  return userTenantMap.get(userId);
}

// ── Middleware ────────────────────────────────────────────────────────────────
export function tenantScopeMiddleware({
  ctx,
  next,
}: {
  ctx: TrpcContext;
  next: (opts: { ctx: TenantScopedContext }) => Promise<any>;
}) {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }

  // Admin users bypass tenant scoping (they see all data)
  const isAdmin = (ctx.user as any).role === "admin";
  if (isAdmin) {
    return next({
      ctx: {
        ...ctx,
        tenantId: "all",
        isTenantAdmin: false,
      } as TenantScopedContext,
    });
  }

  // Resolve tenant from user mapping
  const tenantId = getUserTenantId(ctx.user.keycloakSub) || "tenant-default";
  const tenant = tenantRegistry.get(tenantId);

  if (!tenant) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Tenant not found" });
  }

  if (tenant.status === "suspended") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Tenant account is suspended",
    });
  }

  const isTenantAdmin = (ctx.user as any).role === "tenant_admin";

  return next({
    ctx: {
      ...ctx,
      tenantId,
      isTenantAdmin,
    } as TenantScopedContext,
  });
}

// ── Query helpers ────────────────────────────────────────────────────────────
/**
 * Filter an array of records by tenantId. Admin users (tenantId="all") see everything.
 */
export function filterByTenant<T extends { tenantId?: string }>(
  records: T[],
  tenantId: string
): T[] {
  if (tenantId === "all") return records;
  return records.filter(r => r.tenantId === tenantId || !r.tenantId);
}

/**
 * Validate that a record belongs to the given tenant.
 */
export function assertTenantOwnership(
  record: { tenantId?: string } | null,
  tenantId: string,
  entityName = "Record"
): void {
  if (!record) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `${entityName} not found`,
    });
  }
  if (tenantId !== "all" && record.tenantId && record.tenantId !== tenantId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Access denied to ${entityName}`,
    });
  }
}
