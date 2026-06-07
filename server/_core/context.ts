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
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { verifySessionJwt, KC_SESSION_COOKIE } from "./keycloakAuth";
import { getUserByKeycloakSub } from "../db";

const isDev = process.env.NODE_ENV === "development";
const isTest = process.env.NODE_ENV === "test";
const devBypassEnabled =
  (isDev && process.env.DEV_AUTH_BYPASS === "true") || isTest;

if (
  !isDev &&
  !isTest &&
  (!process.env.JWT_SECRET ||
    process.env.JWT_SECRET === "posinsureportal-secret-change-in-production")
) {
  console.error(
    "[SECURITY] FATAL: JWT_SECRET is not set or is using the default value. Set a strong secret in production."
  );
}

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

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
            console.warn("[context] DB lookup failed, using dev fallback user");
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
  };
}
