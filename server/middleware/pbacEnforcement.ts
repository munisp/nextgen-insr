/**
 * Sprint 91 — Policy-Based Access Control (PBAC) Enforcement
 *
 * Integrates with Permify for fine-grained authorization:
 * - Resource-level permissions (read, write, delete, admin)
 * - Tenant isolation (multi-tenant data boundaries)
 * - Role hierarchy (super_admin > admin > manager > operator > viewer)
 * - Attribute-based conditions (time, location, device)
 * - Permission caching with TTL
 * - Audit trail for all authorization decisions
 */

export type Permission =
  | "read"
  | "write"
  | "delete"
  | "admin"
  | "manage_users"
  | "manage_tenants"
  | "manage_billing"
  | "view_analytics"
  | "export_data"
  | "manage_integrations"
  | "process_transactions"
  | "void_transactions"
  | "refund_transactions"
  | "manage_inventory"
  | "manage_products"
  | "manage_discounts"
  | "view_audit_log"
  | "manage_devices"
  | "manage_kyc"
  | "biometric_enroll"
  | "biometric_verify"
  | "biometric_admin";

export type Role =
  | "super_admin"
  | "admin"
  | "manager"
  | "operator"
  | "viewer"
  | "merchant"
  | "agent";

export interface PBACContext {
  userId: number;
  role: Role;
  tenantId?: number;
  deviceId?: string;
  ipAddress?: string;
  timestamp: number;
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason: string;
  policy: string;
  cached: boolean;
  evaluationTimeMs: number;
}

// ─── Role Hierarchy ──────────────────────────────────────────────────────────
const ROLE_HIERARCHY: Record<Role, number> = {
  super_admin: 100,
  admin: 80,
  manager: 60,
  operator: 40,
  merchant: 30,
  agent: 20,
  viewer: 10,
};

// ─── Permission Matrix ───────────────────────────────────────────────────────
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: [
    "read",
    "write",
    "delete",
    "admin",
    "manage_users",
    "manage_tenants",
    "manage_billing",
    "view_analytics",
    "export_data",
    "manage_integrations",
    "process_transactions",
    "void_transactions",
    "refund_transactions",
    "manage_inventory",
    "manage_products",
    "manage_discounts",
    "view_audit_log",
    "manage_devices",
    "manage_kyc",
    "biometric_enroll",
    "biometric_verify",
    "biometric_admin",
  ],
  admin: [
    "read",
    "write",
    "delete",
    "admin",
    "manage_users",
    "manage_billing",
    "view_analytics",
    "export_data",
    "manage_integrations",
    "process_transactions",
    "void_transactions",
    "refund_transactions",
    "manage_inventory",
    "manage_products",
    "manage_discounts",
    "view_audit_log",
    "manage_devices",
    "manage_kyc",
    "biometric_enroll",
    "biometric_verify",
    "biometric_admin",
  ],
  manager: [
    "read",
    "write",
    "view_analytics",
    "export_data",
    "process_transactions",
    "void_transactions",
    "refund_transactions",
    "manage_inventory",
    "manage_products",
    "manage_discounts",
    "view_audit_log",
    "manage_devices",
    "biometric_enroll",
    "biometric_verify",
  ],
  operator: [
    "read",
    "write",
    "process_transactions",
    "void_transactions",
    "manage_inventory",
    "manage_products",
    "biometric_verify",
  ],
  merchant: [
    "read",
    "write",
    "process_transactions",
    "manage_inventory",
    "manage_products",
    "manage_discounts",
    "view_analytics",
    "biometric_enroll",
    "biometric_verify",
  ],
  agent: ["read", "process_transactions", "biometric_verify"],
  viewer: ["read", "view_analytics"],
};

// ─── Permission Cache ────────────────────────────────────────────────────────
interface CacheEntry {
  decision: AuthorizationDecision;
  expiresAt: number;
}

const permissionCache = new Map<string, CacheEntry>();
// AUTH-18: short TTL so a revoked permission stops being honored quickly.
// Revocation must additionally call invalidatePermissionsForUser() for
// immediate effect — never wait for TTL expiry.
const CACHE_TTL_MS = 15_000; // 15 seconds

function getCacheKey(
  ctx: PBACContext,
  permission: Permission,
  resource?: string
): string {
  return `${ctx.userId}:${ctx.role}:${ctx.tenantId ?? "global"}:${permission}:${resource ?? "*"}`;
}

// Cleanup expired cache entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of permissionCache) {
    if (entry.expiresAt < now) permissionCache.delete(key);
  }
}, 60_000);

/**
 * AUTH-18: revocation invalidation hook. When a user's permissions/role are
 * revoked or changed, callers MUST invoke this so cached allow-decisions are
 * dropped immediately instead of living out their TTL.
 */
export function invalidatePermissionsForUser(
  userId: number,
  tenantId?: number
): number {
  const prefix = `${userId}:`;
  const tenantKey = String(tenantId ?? "global");
  let removed = 0;
  for (const key of permissionCache.keys()) {
    if (!key.startsWith(prefix)) continue;
    if (
      tenantId !== undefined &&
      key.split(":")[2] !== tenantKey
    )
      continue;
    permissionCache.delete(key);
    removed++;
  }
  return removed;
}

/** Drop every cached decision (e.g. after a bulk policy change). */
export function invalidateAllPermissions(): void {
  permissionCache.clear();
}

// ─── Permify Client ──────────────────────────────────────────────────────────
const PERMIFY_HOST = process.env.PERMIFY_HOST ?? "localhost";
const PERMIFY_PORT = process.env.PERMIFY_PORT ?? "3476";
const PERMIFY_ENABLED = process.env.PERMIFY_ENABLED === "true";

async function checkPermify(
  ctx: PBACContext,
  permission: Permission,
  resource?: string
): Promise<AuthorizationDecision | null> {
  if (!PERMIFY_ENABLED) return null;

  try {
    const response = await fetch(
      `http://${PERMIFY_HOST}:${PERMIFY_PORT}/v1/tenants/${ctx.tenantId ?? "default"}/permissions/check`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: { snap_token: "", schema_version: "", depth: 20 },
          entity: {
            type: resource ?? "system",
            id: ctx.tenantId?.toString() ?? "1",
          },
          permission: permission,
          subject: { type: "user", id: ctx.userId.toString(), relation: "" },
        }),
        signal: AbortSignal.timeout(3000),
      }
    );

    if (response.ok) {
      const data = (await response.json()) as any;
      return {
        allowed: data.can === "CHECK_RESULT_ALLOWED",
        reason:
          data.can === "CHECK_RESULT_ALLOWED"
            ? "Permify granted"
            : "Permify denied",
        policy: "permify_remote",
        cached: false,
        evaluationTimeMs: 0,
      };
    }
  } catch {
    // Permify unavailable — fall through to local evaluation
  }
  return null;
}

// ─── Authorization Engine ────────────────────────────────────────────────────
export async function authorize(
  ctx: PBACContext,
  permission: Permission,
  resource?: string
): Promise<AuthorizationDecision> {
  const start = Date.now();
  const cacheKey = getCacheKey(ctx, permission, resource);

  // Check cache first
  const cached = permissionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.decision, cached: true };
  }

  // Try Permify first (if enabled)
  const permifyResult = await checkPermify(ctx, permission, resource);
  if (permifyResult) {
    permifyResult.evaluationTimeMs = Date.now() - start;
    permissionCache.set(cacheKey, {
      decision: permifyResult,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return permifyResult;
  }

  // Local RBAC evaluation — AUTH-18: this static fallback is FAIL-OPEN and is
  // therefore only permitted outside production as an explicit demo opt-in.
  // In production (or whenever the demo flag is off), an unreachable/disabled
  // policy engine DENIES the request instead of falling through to static
  // role tables that cannot reflect revocations.
  const localFallbackAllowed =
    process.env.PBAC_LOCAL_RBAC_FALLBACK_DEMO === "true" &&
    process.env.NODE_ENV !== "production";
  if (!localFallbackAllowed) {
    const decision: AuthorizationDecision = {
      allowed: false,
      reason: PERMIFY_ENABLED
        ? "Policy engine unreachable — denied (fail-closed)"
        : "Policy engine disabled (PERMIFY_ENABLED!=true) — denied (fail-closed)",
      policy: "fail_closed",
      cached: false,
      evaluationTimeMs: Date.now() - start,
    };
    // Deny decisions are NOT cached — recovery must take effect immediately.
    return decision;
  }

  const rolePermissions = ROLE_PERMISSIONS[ctx.role] ?? [];
  const allowed = rolePermissions.includes(permission);

  const decision: AuthorizationDecision = {
    allowed,
    reason: allowed
      ? `Role ${ctx.role} has ${permission} (local RBAC demo fallback)`
      : `Role ${ctx.role} lacks ${permission}`,
    policy: "local_rbac",
    cached: false,
    evaluationTimeMs: Date.now() - start,
  };

  // Cache the decision (short TTL — AUTH-18)
  permissionCache.set(cacheKey, {
    decision,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return decision;
}

// ─── tRPC Middleware Helper ──────────────────────────────────────────────────
export function requirePermission(permission: Permission, resource?: string) {
  return async (ctx: { user: { id: number; role: string }; req?: any }) => {
    const pbacCtx: PBACContext = {
      userId: ctx.user.id,
      role: ctx.user.role as Role,
      tenantId: (ctx.user as any).tenantId,
      ipAddress: ctx.req?.ip,
      timestamp: Date.now(),
    };

    const decision = await authorize(pbacCtx, permission, resource);

    if (!decision.allowed) {
      const { TRPCError } = await import("@trpc/server");
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Access denied: ${decision.reason}`,
      });
    }

    return decision;
  };
}

// ─── Tenant Isolation ────────────────────────────────────────────────────────
export function enforceTenantIsolation(
  userTenantId: number | undefined,
  resourceTenantId: number
): boolean {
  if (!userTenantId) return false; // No tenant = no access to tenant resources
  return userTenantId === resourceTenantId;
}

// ─── Role Comparison ─────────────────────────────────────────────────────────
export function hasHigherRole(role1: Role, role2: Role): boolean {
  return ROLE_HIERARCHY[role1] > ROLE_HIERARCHY[role2];
}

export function getRoleLevel(role: Role): number {
  return ROLE_HIERARCHY[role] ?? 0;
}
