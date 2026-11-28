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
 *
 * 2026-11-28 (C1 merge): union of the root context (R-fix service-token auth,
 * requestId correlation, F6-9 dev-bypass guard) with the insureportal
 * infrastructure client attachments (dapr, tb, temporal, redis, fluvio,
 * permify, analytics, goInfra, rustMw). The infra fields are optional: no
 * root-tree consumer uses them yet and test helpers build partial contexts.
 * The ip copy referenced ENV.pythonAnalyticsEnabled/goInfra/rustMiddleware
 * keys that root server/_core/env.ts does not define; the same values are
 * read from process.env here with the identical defaults ip used.
 */
import crypto from "node:crypto";

import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";

import { verifyKeycloakToken } from "./keycloak";
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
    process.env.JWT_SECRET === "posinsureportal-secret-change-in-production" ||
    // DD-TSSEC (A7-5): the repo's own published default must also hard-exit.
    process.env.JWT_SECRET === "default-key-for-dev")
) {
  logger.error(
    "[SECURITY] FATAL: JWT_SECRET is not set or is using the default value. Set a strong secret in production."
  );
  process.exit(1);
}

// ── insureportal infra-service endpoints (ported from ip server/_core/env.ts) ─
// Root server/_core/env.ts does not define these keys; read them directly
// with the identical defaults the insureportal env schema used.
const pythonAnalyticsUrl = process.env.PYTHON_ANALYTICS_URL ?? "http://python-analytics:8092";
const pythonAnalyticsEnabled = (process.env.PYTHON_ANALYTICS_ENABLED ?? "true") === "true";
const goInfraUrl = process.env.GO_INFRA_URL ?? "http://go-infra:8093";
const goInfraEnabled = (process.env.GO_INFRA_ENABLED ?? "true") === "true";
const rustMiddlewareUrl = process.env.RUST_MIDDLEWARE_URL ?? "http://rust-middleware:8091";
const rustMiddlewareEnabled = (process.env.RUST_MIDDLEWARE_ENABLED ?? "true") === "true";

// ── Service client lazy singletons (ported from insureportal context.ts) ────
let _daprClient: unknown = null;
let _tbClient: unknown = null;
let _temporalClient: unknown = null;
let _redisClient: unknown = null;
let _fluvioClient: unknown = null;
let _permifyClient: unknown = null;

async function getDaprClient() {
  if (_daprClient) return _daprClient;
  // Root server/daprClient.ts exports functions (daprInvoke, daprPublish, …),
  // not a `daprClient` object — bind the module namespace (C1 drift fix).
  try { _daprClient = await import("../daprClient"); return _daprClient; } catch { return null; }
}
async function getTbClient() {
  if (_tbClient) return _tbClient;
  try { _tbClient = await import("../tbClient"); return _tbClient; } catch { return null; }
}
async function getTemporalClient() {
  if (_temporalClient) return _temporalClient;
  try { const { getTemporalClient: getTC } = await import("../temporal"); _temporalClient = await getTC(); return _temporalClient; } catch { return null; }
}
async function getRedisClient() {
  if (_redisClient) return _redisClient;
  try { const { getRedisClient: getRC } = await import("../lib/redisClient"); _redisClient = getRC(); return _redisClient; } catch { return null; }
}
async function getFluvioClient() {
  if (_fluvioClient) return _fluvioClient;
  try { const fluvioMod = await import("../lib/fluvioClient"); _fluvioClient = fluvioMod; return _fluvioClient; } catch { return null; }
}
async function getPermifyClient() {
  if (_permifyClient) return _permifyClient;
  try { const { permifyClient } = await import("../lib/permifyClient"); _permifyClient = permifyClient; return _permifyClient; } catch { return null; }
}

// ── HTTP service helpers (ported from insureportal context.ts) ──────────────
const analyticsClient = {
  async post(path: string, body: unknown) {
    if (!pythonAnalyticsEnabled) return null;
    try {
      const res = await fetch(`${pythonAnalyticsUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
      return res.ok ? ((await res.json()) as unknown) : null;
    } catch { return null; }
  },
  async get(path: string) {
    if (!pythonAnalyticsEnabled) return null;
    try {
      const res = await fetch(`${pythonAnalyticsUrl}${path}`, { signal: AbortSignal.timeout(10_000) });
      return res.ok ? ((await res.json()) as unknown) : null;
    } catch { return null; }
  },
};

const goInfraClient = {
  async post(path: string, body: unknown) {
    if (!goInfraEnabled) return null;
    try {
      const res = await fetch(`${goInfraUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5_000) });
      return res.ok ? ((await res.json()) as unknown) : null;
    } catch { return null; }
  },
  async get(path: string) {
    if (!goInfraEnabled) return null;
    try {
      const res = await fetch(`${goInfraUrl}${path}`, { signal: AbortSignal.timeout(5_000) });
      return res.ok ? ((await res.json()) as unknown) : null;
    } catch { return null; }
  },
};

const rustMwClient = {
  async post(path: string, body: unknown) {
    if (!rustMiddlewareEnabled) return null;
    try {
      const res = await fetch(`${rustMiddlewareUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(3_000) });
      return res.ok ? ((await res.json()) as unknown) : null;
    } catch { return null; }
  },
};

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
  serviceAuth?: boolean; // 2026-10-01 (R-fix3): optional — testHelpers builds partial contexts; readers use `=== true` so undefined == false
  /**
   * insureportal infra-service clients (C1 union port). Optional: no
   * root-tree consumer uses them yet; test helpers build partial contexts.
   */
  dapr?: Awaited<ReturnType<typeof getDaprClient>>;
  tb?: Awaited<ReturnType<typeof getTbClient>>;
  temporal?: Awaited<ReturnType<typeof getTemporalClient>>;
  redis?: Awaited<ReturnType<typeof getRedisClient>>;
  fluvio?: Awaited<ReturnType<typeof getFluvioClient>>;
  permify?: Awaited<ReturnType<typeof getPermifyClient>>;
  analytics?: typeof analyticsClient;
  goInfra?: typeof goInfraClient;
  rustMw?: typeof rustMwClient;
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
        } catch {
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

  // insureportal infra-service clients (C1 union port) — attached as lazy
  // promises (each resolver fails closed to null when the service/dep is
  // unavailable), so context creation never blocks on infra connections.
  return {
    req: opts.req,
    res: opts.res,
    user,
    serviceAuth,
    requestId: resolveRequestId(opts.req, opts.res),
    dapr: getDaprClient(),
    tb: getTbClient(),
    temporal: getTemporalClient(),
    redis: getRedisClient(),
    fluvio: getFluvioClient(),
    permify: getPermifyClient(),
    analytics: analyticsClient,
    goInfra: goInfraClient,
    rustMw: rustMwClient,
  };
}
