/**
 * context.ts — tRPC request context
 *
 * Authenticates the request using the Keycloak session cookie (kc_session).
 * The cookie contains a server-signed HS256 JWT. We verify it locally, then
 * resolve the user record from the database by keycloakSub.
 *
 * Public procedures receive user=null; protectedProcedure throws UNAUTHORIZED.
 *
 * PRODUCTION: No dev fallback users are created. JWT_SECRET must be set.
 * DEVELOPMENT: A mock admin user is created when DB is unavailable (opt-in via
 *   DEV_AUTH_BYPASS=true, defaults to false even in development).
 */
import crypto from "node:crypto";

import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";

import { verifySessionJwt, KC_SESSION_COOKIE } from "./keycloakAuth";
import { verifyKeycloakToken } from "./keycloak";
import type { User } from "../../drizzle/schema";
import { getUserByKeycloakSub } from "../db";
import { logger } from './logger';

const isDev = process.env.NODE_ENV === "development";
const isTest = process.env.NODE_ENV === "test";

// CRITICAL: DEV_AUTH_BYPASS must NEVER activate outside an explicit local
// development opt-in. F6-9: NODE_ENV=test previously enabled the admin
// fallback user SILENTLY — any staging/preview deployed with NODE_ENV=test
// served every tRPC call as admin id=1. That leg is removed: the bypass now
// requires BOTH NODE_ENV=development AND DEV_AUTH_BYPASS=true. Tests must
// authenticate explicitly (build contexts with a real user or session).
const devBypassEnabled =
  isDev && process.env.DEV_AUTH_BYPASS === "true";

if (
  !isDev &&
  !isTest &&
  (!process.env.JWT_SECRET ||
    process.env.JWT_SECRET === "posinsureportal-secret-change-in-production" ||
    // DD-TSSEC (A7-5): the repo's own published default must also hard-exit.
    process.env.JWT_SECRET === "default-key-for-dev")
) {
  logger.error(
    "[SECURITY] FATAL: JWT_SECRET is not set or is using the default value. Set a strong secret in production."
  );
  process.exit(1);
}

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /**
   * Correlation ID for this request. Honors an inbound `x-request-id` header
   * (set by the Express middleware in server/_core/index.ts or by an edge
   * proxy); otherwise a fresh UUID is generated here so every tRPC call —
   * including direct context creation in tests — always has one.
   */
  requestId: string;
  /**
   * 2026-10-01 (R-fix, finding 1): true when the request was authenticated
   * with the monolith service token (Authorization: Bearer <MONOLITH_SERVICE_TOKEN>),
   * e.g. whatsapp-bot catalog reads or the Go BFF insurance-mobile-app sync
   * forward. Does NOT imply an end user — ctx.user is only set when an
   * end-user identity was verified (X-End-User-Authorization JWT or a
   * direct end-user Bearer token).
   */
  serviceAuth: boolean;
};

/**
 * Resolve the correlation ID for a request: inbound `x-request-id` wins,
 * otherwise generate one. Also stamps the `X-Request-ID` response header so
 * clients can correlate even when the Express middleware did not run first.
 */
function resolveRequestId(
  req: CreateExpressContextOptions["req"],
  res: CreateExpressContextOptions["res"]
): string {
  const inbound = req.headers?.["x-request-id"];
  const requestId =
    (typeof inbound === "string" && inbound.trim().length > 0
      ? inbound
      : Array.isArray(inbound) && inbound[0]
        ? inbound[0]
        : null) ?? crypto.randomUUID();
  try {
    // Guarded: test contexts use minimal res mocks without setHeader.
    (res as { setHeader?: (k: string, v: string) => void } | undefined)?.setHeader?.(
      "X-Request-ID",
      requestId
    );
  } catch {
    // header stamping is best-effort; never fail context creation over it
  }
  return requestId;
}

function parseCookies(cookieHeader: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) map.set(k.trim(), decodeURIComponent(v.join("=")));
  }
  return map;
}

function createDevFallbackUser(session: {
  sub: string;
  name: string;
  email: string;
  role: string;
}): User {
  return {
    id: 1,
    keycloakSub: session.sub,
    name: session.name || "Dev Admin",
    email: session.email || "admin@insureportal.dev",
    role: (session.role as "admin" | "user") || "admin",
    loginMethod: "keycloak",
    lastSignedIn: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;
}

/**
 * 2026-10-01 (R-fix, finding 1): constant-time equality for the monolith
 * service token. Never logs or returns the compared values.
 */
function serviceTokenEquals(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * 2026-10-01 (R-fix, finding 1): resolve a DB user from a Keycloak end-user
 * JWT (same shape as the cookie path). Fail-closed: any verification or
 * lookup failure yields null — header values are never trusted raw.
 */
async function resolveUserFromKeycloakJwt(token: string): Promise<User | null> {
  try {
    const payload = await verifyKeycloakToken(token);
    if (!payload?.sub) return null;
    const dbUser = await getUserByKeycloakSub(payload.sub);
    return dbUser ?? null;
  } catch {
    return null;
  }
}

function bearerToken(req: CreateExpressContextOptions["req"]): string | null {
  const header = req.headers?.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1].trim() : null;
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let serviceAuth = false;

  try {
    const cookies = parseCookies(opts.req.headers.cookie ?? "");
    const sessionToken = cookies.get(KC_SESSION_COOKIE);

    if (sessionToken) {
      const session = await verifySessionJwt(sessionToken);
      if (session?.sub) {
        let dbUser: User | undefined;
        try {
          dbUser = await getUserByKeycloakSub(session.sub);
        } catch (dbErr) {
          if (devBypassEnabled) {
            logger.warn("[context] DB lookup failed, using dev fallback user");
          }
        }

        if (dbUser) {
          user = dbUser;
        } else if (devBypassEnabled) {
          user = createDevFallbackUser(session);
        }
      }
    }

    if (!user && devBypassEnabled) {
      user = createDevFallbackUser({
        sub: "dev-preview-user",
        name: "Dev Admin",
        email: "admin@insureportal.dev",
        role: "admin",
      });
    }

    // 2026-10-01 (R-fix, finding 1): Bearer-token auth paths. The cookie
    // path above is untouched; these run only when no cookie session
    // resolved a user. Fail-closed throughout: no token is ever logged,
    // and any verification failure yields user=null.
    if (!user) {
      const token = bearerToken(opts.req);
      if (token) {
        const serviceToken = process.env.MONOLITH_SERVICE_TOKEN;
        if (serviceToken && serviceTokenEquals(token, serviceToken)) {
          // Service-to-service caller (e.g. Go BFF insurance-mobile-app
          // sync, whatsapp-bot). Marks serviceAuth; public procs work.
          serviceAuth = true;
          // Optional end-user identity forwarded by the BFF:
          // X-End-User-Authorization carries the end user's Keycloak JWT.
          // Verified via the existing JWKS verifier — never trusted raw.
          const fwd = opts.req.headers?.["x-end-user-authorization"];
          const fwdValue = Array.isArray(fwd) ? fwd[0] : fwd;
          if (typeof fwdValue === "string" && fwdValue.trim().length > 0) {
            const fwdToken =
              /^Bearer\s+(.+)$/i.exec(fwdValue.trim())?.[1].trim() ??
              fwdValue.trim();
            user = await resolveUserFromKeycloakJwt(fwdToken);
          }
        } else {
          // RN app path: the Bearer token is an end-user Keycloak JWT.
          // Failure leaves user=null (unchanged cookie-less behavior).
          user = await resolveUserFromKeycloakJwt(token);
        }
      }
    }
  } catch {
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    serviceAuth,
    requestId: resolveRequestId(opts.req, opts.res),
  };
}
