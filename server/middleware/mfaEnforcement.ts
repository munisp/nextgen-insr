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
import type { TrpcContext } from "../_core/context";
import type { Request, Response, NextFunction } from "express";
import { verifySessionJwt, KC_SESSION_COOKIE } from "../_core/keycloakAuth";
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

  // Check Keycloak session AMR claim to verify MFA was actually used in this session
  try {
    const cookieHeader = String((ctx.req as any).headers?.cookie ?? "");
    const cookies = new Map(
      cookieHeader.split(";").map((p: string) => {
        const [k, ...v] = p.trim().split("=");
        return [k?.trim(), decodeURIComponent(v.join("="))];
      })
    );
    const sessionToken = cookies.get(KC_SESSION_COOKIE);
    if (sessionToken) {
      const session = await verifySessionJwt(sessionToken);
      const amr: string[] = (session as any)?.amr ?? [];
      const mfaUsed = amr.some(m =>
        ["otp", "mfa", "totp", "webauthn"].includes(m)
      );
      if (!mfaUsed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "This operation requires MFA authentication. Please re-login with MFA.",
        });
      }
    }
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    // If we can't verify the session AMR, fall back to the DB flag only
    logger.warn(
      "[MFA] Could not verify AMR claim, relying on DB mfaEnabled flag:",
      err
    );
  }

  return next({ ctx });
};

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
    const amr: string[] = (session as any)?.amr ?? [];
    const mfaUsed = amr.some(m =>
      ["otp", "mfa", "totp", "webauthn"].includes(m)
    );

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
    logger.error("[MFA] Express middleware error:", err);
    res.status(500).json({ error: "MFA verification failed" });
  }
}
