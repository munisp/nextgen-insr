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
    process.env.JWT_SECRET === "posinsureportal-secret-change-in-production")
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

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

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
  } catch {
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    requestId: resolveRequestId(opts.req, opts.res),
  };
}
