/**
 * context.ts — tRPC request context (v2.0 — Full Infrastructure Integration)
 *
 * All infrastructure service clients are attached to the context:
 *   dapr, tb (TigerBeetle), temporal, redis, fluvio, permify,
 *   analytics (Python), goInfra (Go), rustMw (Rust middleware)
 */
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "@schema";
import { verifySessionJwt, KC_SESSION_COOKIE } from "./keycloakAuth";
import { getUserByKeycloakSub } from "../db";
import { ENV } from "./env";

// ── Service client lazy singletons ────────────────────────────────────────────
let _daprClient: any = null;
let _tbClient: any = null;
let _temporalClient: any = null;
let _redisClient: any = null;
let _fluvioClient: any = null;
let _permifyClient: any = null;

async function getDaprClient() {
  if (_daprClient) return _daprClient;
  try { const { daprClient } = await import("../daprClient"); _daprClient = daprClient; return _daprClient; } catch { return null; }
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
  try { const { fluvioClient } = await import("../lib/fluvioClient"); _fluvioClient = fluvioClient; return _fluvioClient; } catch { return null; }
}
async function getPermifyClient() {
  if (_permifyClient) return _permifyClient;
  try { const { permifyClient } = await import("../lib/permifyClient"); _permifyClient = permifyClient; return _permifyClient; } catch { return null; }
}

// ── HTTP service helpers ──────────────────────────────────────────────────────
const analyticsClient = {
  async post(path: string, body: unknown) {
    if (!ENV.pythonAnalyticsEnabled) return null;
    try {
      const res = await fetch(`${ENV.pythonAnalyticsUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
      return res.ok ? res.json() : null;
    } catch { return null; }
  },
  async get(path: string) {
    if (!ENV.pythonAnalyticsEnabled) return null;
    try {
      const res = await fetch(`${ENV.pythonAnalyticsUrl}${path}`, { signal: AbortSignal.timeout(10_000) });
      return res.ok ? res.json() : null;
    } catch { return null; }
  },
};

const goInfraClient = {
  async post(path: string, body: unknown) {
    if (!ENV.goInfraEnabled) return null;
    try {
      const res = await fetch(`${ENV.goInfraUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5_000) });
      return res.ok ? res.json() : null;
    } catch { return null; }
  },
  async get(path: string) {
    if (!ENV.goInfraEnabled) return null;
    try {
      const res = await fetch(`${ENV.goInfraUrl}${path}`, { signal: AbortSignal.timeout(5_000) });
      return res.ok ? res.json() : null;
    } catch { return null; }
  },
};

const rustMwClient = {
  async post(path: string, body: unknown) {
    if (!ENV.rustMiddlewareEnabled) return null;
    try {
      const res = await fetch(`${ENV.rustMiddlewareUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(3_000) });
      return res.ok ? res.json() : null;
    } catch { return null; }
  },
};

// ── Context type ──────────────────────────────────────────────────────────────
export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  dapr: Awaited<ReturnType<typeof getDaprClient>>;
  tb: Awaited<ReturnType<typeof getTbClient>>;
  temporal: Awaited<ReturnType<typeof getTemporalClient>>;
  redis: Awaited<ReturnType<typeof getRedisClient>>;
  fluvio: Awaited<ReturnType<typeof getFluvioClient>>;
  permify: Awaited<ReturnType<typeof getPermifyClient>>;
  analytics: typeof analyticsClient;
  goInfra: typeof goInfraClient;
  rustMw: typeof rustMwClient;
};

const isDev = process.env.NODE_ENV === "development";
const isTest = process.env.NODE_ENV === "test";
const devBypassEnabled = (isDev && process.env.DEV_AUTH_BYPASS === "true") || isTest;

if (!isDev && !isTest && (!process.env.JWT_SECRET || process.env.JWT_SECRET === "posinsureportal-secret-change-in-production")) {
  console.error("[SECURITY] FATAL: JWT_SECRET is not set or is using the default value.");
}

function parseCookies(cookieHeader: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) map.set(k.trim(), decodeURIComponent(v.join("=")));
  }
  return map;
}

function createDevFallbackUser(session: { sub: string; name: string; email: string; role: string }): User {
  return { id: 1, keycloakSub: session.sub, name: session.name || "Dev Admin", email: session.email || "admin@insureportal.dev", role: (session.role as "admin" | "user") || "admin", loginMethod: "keycloak", lastSignedIn: new Date(), createdAt: new Date(), updatedAt: new Date() } as User;
}

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  let user: User | null = null;
  try {
    const cookies = parseCookies(opts.req.headers.cookie ?? "");
    const sessionToken = cookies.get(KC_SESSION_COOKIE);
    if (sessionToken) {
      const session = await verifySessionJwt(sessionToken);
      if (session?.sub) {
        let dbUser: User | undefined;
        try { dbUser = await getUserByKeycloakSub(session.sub); } catch (dbErr) { if (devBypassEnabled) console.warn("[context] DB lookup failed, using dev fallback user"); }
        if (dbUser) { user = dbUser; } else if (devBypassEnabled) { user = createDevFallbackUser(session); }
      }
    }
    if (!user && devBypassEnabled) { user = createDevFallbackUser({ sub: "dev-preview-user", name: "Dev Admin", email: "admin@insureportal.dev", role: "admin" }); }
  } catch { user = null; }

  const [dapr, tb, temporal, redis, fluvio, permify] = await Promise.all([
    getDaprClient(), getTbClient(), getTemporalClient(),
    getRedisClient(), getFluvioClient(), getPermifyClient(),
  ]);

  return { req: opts.req, res: opts.res, user, dapr, tb, temporal, redis, fluvio, permify, analytics: analyticsClient, goInfra: goInfraClient, rustMw: rustMwClient };
}
