/**
 * actuaryRoleGuard.ts — W34-D (2026-11-28) actuary role gates for the
 * actuary engine routers (design §7.4 + Appendix E).
 *
 * Two gates, both FAIL-CLOSED through the existing
 * server/_core/permify.ts client (W23 semantics: a Permify outage denies;
 * fail-open only via the boot-guarded PERMIFY_FAIL_OPEN opt-in):
 *
 * 1. actuaryReadProcedure(permission) — read-side actuary procedures
 *    (reserveEstimate / capitalReport / adequacyMonitor / referral queue).
 *    Design Appendix E: "(actuary|admin)". The platform `admin` DB role
 *    short-circuits on the JWT-validated role claim (the same preserved
 *    early-return as canAccessTransaction in server/_core/permify.ts) so
 *    read availability for platform admins does not depend on Permify;
 *    everyone else needs the Permify `actuary` entity permission.
 *
 * 2. actuaryAdminProcedure(permission) — actuary_admin mutations
 *    (upsertRateVersion / approveRun / upsertAssumptionSet /
 *    manageReferralRules). NO admin short-circuit: the platform `admin`
 *    DB role is NOT the `actuary_admin` role (KEYCLOAK role hierarchy:
 *    admin composites billing-admin + supervisor only, not actuary), so
 *    every caller — including platform admins — is Permify-checked against
 *    the `actuary` entity manage_* permissions. Permify-down therefore
 *    DENIES actuaryAdmin.* unconditionally (the standing fail-closed
 *    requirement), exactly like the W23 boot-guard posture.
 *
 * Permify entity checked: `actuary` id `engine` (the singleton engine
 * resource; see infra/permify/schema.perm actuary entity, W34-D additive).
 */
import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "../_core/trpc";
import { permifyCheck } from "../_core/permify";

const ACTUARY_ENTITY_ID = "engine";

async function checkActuaryPermission(
  userId: number | string,
  permission: string
): Promise<boolean> {
  return permifyCheck({
    subjectType: "user",
    subjectId: String(userId),
    entityType: "actuary",
    entityId: ACTUARY_ENTITY_ID,
    permission,
  });
}

/** Read-side gate: actuary or admin (design Appendix E). */
export function actuaryReadProcedure(permission: string) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    const user = ctx.user!;
    if (user.role === "admin") {
      return next({ ctx });
    }
    const allowed = await checkActuaryPermission(user.id, permission);
    if (!allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Actuary read access denied by authorization policy (actuary:${permission})`,
      });
    }
    return next({ ctx });
  });
}

/**
 * Admin-mutation gate: actuary_admin only, fail-closed. No DB-role
 * short-circuit (see header note 2).
 */
export function actuaryAdminProcedure(permission: string) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    const user = ctx.user!;
    const allowed = await checkActuaryPermission(user.id, permission);
    if (!allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Actuary admin access denied by authorization policy (actuary:${permission})`,
      });
    }
    return next({ ctx });
  });
}
