// TypeScript enabled — Sprint 96 security audit
/**
 * P0-C: MFA Enforcement Middleware
 *
 * Enforces Multi-Factor Authentication for high-privilege operations.
 * Integrates with Keycloak OIDC: checks the `amr` (Authentication Methods
 * References) claim in the session JWT to verify MFA was used.
 *
 * Usage:
 *   // In a tRPC procedure:
 *   import { requireMfa } from "../middleware/mfaEnforcement";
 *
 *   const mfaProtectedProcedure = protectedProcedure.use(requireMfa);
 *
 *   // In an Express route:
 *   app.post("/api/admin/action", requireMfaExpress, handler);
 */
import { TRPCError } from "@trpc/server";
import type { Request, Response, NextFunction } from "express";

import type { TrpcContext } from "../_core/context";
import {
  hasMfaCompleted,
  verifySessionJwt,
  KC_SESSION_COOKIE,
} from "../_core/keycloakAuth";
import { logger } from '../_core/logger';

/**
 * tRPC middleware that enforces MFA.
 * Checks:
 *   1. The user record has mfaEnabled = true (DB flag set by admin)
 *   2. The current session JWT contains `amr` with "otp" or "mfa" (Keycloak OIDC claim)
 *
 * Throws FORBIDDEN if either check fails.
 */
export const requireMfa = async ({
  ctx,
  next,
}: {
  ctx: TrpcContext;
  next: (opts?: any) => Promise<any>;
}) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }

  // Check DB flag: admin must have explicitly enabled MFA for this user
  if (!ctx.user.mfaEnabled) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "MFA is required for this operation. Please enable MFA in your account settings.",
    });
  }

  // Check Keycloak session AMR claim to verify MFA was actually used in this
  // session. FAIL-CLOSED: an unreadable/absent session or a session without a
  // real MFA marker denies the operation — there is no DB-flag-only fallback.
  const session = await readKcSession(ctx.req);
  if (!session || !hasMfaCompleted(session)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "This operation requires MFA authentication. Please re-login with MFA.",
    });
  }

  return next({ ctx });
};

/**
 * Read and verify the kc_session JWT from the request cookies.
 * Returns null when absent/invalid/revoked.
 */
async function readKcSession(
  req: TrpcContext["req"]
): Promise<{ acr?: string; amr?: string[] } | null> {
  try {
    const cookieHeader = String(req.headers?.cookie ?? "");
    const cookies = new Map(
      cookieHeader.split(";").map((p: string) => {
        const [k, ...v] = p.trim().split("=");
        return [k?.trim(), decodeURIComponent(v.join("="))];
      })
    );
    const sessionToken = cookies.get(KC_SESSION_COOKIE);
    if (!sessionToken) return null;
    const session = await verifySessionJwt(sessionToken);
    if (!session) return null;
    return { acr: session.acr, amr: session.amr };
  } catch (err) {
    logger.warn("[MFA] Could not read session for step-up check:: " + err);
    return null;
  }
}

/**
 * F7 step-up for high-risk financial operations (payout approve/process).
 *
 * Honest capability statement: MFA is NOT enrollable in this deployment —
 * the mfaManager router fails loud NOT_IMPLEMENTED and the production
 * Keycloak realm has no MFA flow — so the primary controls on these
 * operations are the role gate and maker-checker enforced by the callers.
 * This assertion is the MFA leg: when a user IS flagged `mfaEnabled` in the
 * DB, the current session MUST carry a real second-factor marker (acr/amr
 * copied from the Keycloak token at login). Anything else fails CLOSED —
 * an enrolled account can never approve/move payouts on a password-only
 * session, and a session that cannot be verified is treated as factor-less.
 */
export async function assertFinancialStepUp(ctx: TrpcContext): Promise<void> {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }
  if (!ctx.user.mfaEnabled) return;
  const session = await readKcSession(ctx.req);
  if (!session || !hasMfaCompleted(session)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "MFA-enrolled account: this operation requires a session authenticated with a second factor. Re-authenticate with MFA before approving or processing payouts.",
    });
  }
}

/**
 * Express middleware variant for REST routes that require MFA.
 */
export async function requireMfaExpress(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const cookieHeader = req.headers?.cookie ?? "";
    const cookies = new Map(
      cookieHeader.split(";").map((p: string) => {
        const [k, ...v] = p.trim().split("=");
        return [k?.trim(), decodeURIComponent(v.join("="))];
      })
    );
    const sessionToken = cookies.get(KC_SESSION_COOKIE);
    if (!sessionToken) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const session = await verifySessionJwt(sessionToken);
    const mfaUsed = session ? hasMfaCompleted(session) : false;

    if (!mfaUsed) {
      res.status(403).json({
        error: "MFA required",
        message:
          "This operation requires MFA authentication. Please re-login with MFA.",
      });
      return;
    }

    next();
  } catch (err) {
    logger.error("[MFA] Express middleware error:: " + err);
    res.status(500).json({ error: "MFA verification failed" });
  }
}
