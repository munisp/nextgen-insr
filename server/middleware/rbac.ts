// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * Sprint 52 — RBAC Hardening
 * F06: Apply admin-only access to sensitive routers
 */
import { TRPCError } from "@trpc/server";

/**
 * RBAC middleware for tRPC — checks if user has admin role.
 * Usage: protectedProcedure.use(requireAdmin)
 */
export const requireAdmin = ({ ctx, next }: any) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }
  if (ctx.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
  return next({ ctx });
};

/**
 * RBAC middleware — checks if user has any of the specified roles.
 */
export const requireRole =
  (...roles: string[]) =>
  ({ ctx, next }: any) => {
    if (!ctx.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }
    if (!roles.includes(ctx.user.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Access restricted to roles: ${roles.join(", ")}`,
      });
    }
    return next({ ctx });
  };

/**
 * List of sensitive routes that require admin access.
 * These are enforced at the router level.
 */
export const ADMIN_ONLY_ROUTERS = [
  "fraudMlScoring",
  "complianceFiling",
  "generalLedger",
  "backupDisasterRecovery",
  "tenantFeatureToggle",
  "rateLimitEngine",
  "platformHealth",
  "webhookManagement",
  "slaMonitoring",
  "agentManagement",
  "reconciliationEngine",
  "merchantPayoutSettlement",
] as const;
