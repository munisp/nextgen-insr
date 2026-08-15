/**
 * http.ts — HTTP E2E harness helpers.
 *
 * Boots the REAL express/tRPC application (server/_core/index.ts createApp())
 * on an ephemeral localhost port and provides:
 *   - raw fetch helpers targeting the base URL
 *   - tRPC-over-HTTP helpers matching the production wire format
 *     (superjson transformer: bodies are `{ json: <input> }`, responses are
 *     `{ result: { data: { json: ... } } }` / `{ error: { ... } }`)
 *   - session-cookie minting: a REAL kc_session JWT signed with JWT_SECRET
 *     (exactly what server/_core/keycloakAuth.ts issues after OIDC login),
 *     backed by a REAL users row so context.ts resolves the user from the DB.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { createApp } from "../../../server/_core/index";
import { getDb } from "../../../server/db";
import { users, type User } from "../../../drizzle/schema";

let server: Server | null = null;
let baseUrl = "";

/** Boot the real app on an ephemeral port. Idempotent within the fork. */
export async function bootServer(): Promise<string> {
  if (server && baseUrl) return baseUrl;
  const { server: srv } = await createApp();
  await new Promise<void>((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => resolve());
  });
  const address = srv.address() as AddressInfo;
  server = srv;
  baseUrl = `http://127.0.0.1:${address.port}`;
  return baseUrl;
}

export async function shutdownServer(): Promise<void> {
  if (server) {
    const srv = server;
    server = null;
    baseUrl = "";
    await new Promise<void>(resolve => srv.close(() => resolve()));
  }
  // Close every long-lived handle the app opened so the vitest fork can exit:
  // DB pool, Redis client, Kafka producer retries.
  try {
    const { getPool } = await import("../../../server/db");
    const pool = await getPool();
    if (pool) await pool.end();
  } catch {
    /* best-effort */
  }
  try {
    const { getRedisClient } = await import(
      "../../../server/lib/redisClient"
    );
    getRedisClient().disconnect();
  } catch {
    /* best-effort */
  }
  try {
    const { disconnectKafka } = await import("../../../server/kafkaClient");
    await disconnectKafka();
  } catch {
    /* best-effort */
  }
}

export function apiUrl(path: string): string {
  if (!baseUrl) throw new Error("E2E server not booted — call bootServer()");
  return `${baseUrl}${path}`;
}

// ── Authenticated users ───────────────────────────────────────────────────────

export interface E2EUser {
  keycloakSub: string;
  name: string;
  email: string;
  role: "admin" | "supervisor" | "user";
}

export const e2eAdmin: E2EUser = {
  keycloakSub: "e2e-admin-sub-0001",
  name: "E2E Admin",
  email: "e2e-admin@e2e.local",
  role: "admin",
};

export const e2eAgent: E2EUser = {
  keycloakSub: "e2e-agent-sub-0002",
  name: "E2E Agent",
  email: "e2e-agent@e2e.local",
  role: "user",
};

/**
 * Insert the users row (idempotent) and mint a real kc_session cookie —
 * the same HS256 JWT shape that registerKeycloakAuthRoutes sets after the
 * Keycloak code exchange.
 */
export async function sessionCookieFor(user: E2EUser): Promise<string> {
  const db = (await getDb())!;
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.keycloakSub, user.keycloakSub))
    .limit(1);
  let row: User | undefined = existing[0];
  if (!row) {
    const inserted = await db
      .insert(users)
      .values({
        keycloakSub: user.keycloakSub,
        name: user.name,
        email: user.email,
        role: user.role,
        loginMethod: "keycloak",
      })
      .returning();
    row = inserted[0];
  }

  const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
  const jwt = await new SignJWT({
    sub: user.keycloakSub,
    name: user.name,
    email: user.email,
    role: user.role,
    accessToken: "e2e-access-token",
    refreshToken: "e2e-refresh-token",
    idToken: "e2e-id-token",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret);

  return `kc_session=${encodeURIComponent(jwt)}`;
}

// ── tRPC-over-HTTP helpers (superjson wire format) ────────────────────────────

export interface TrpcHttpResponse<T = unknown> {
  status: number;
  /** Parsed result data (present on success). */
  data?: T;
  /** Parsed tRPC error envelope (present on failure). */
  error?: {
    message: string;
    code: number;
    data: {
      code: string;
      httpStatus: number;
      path?: string;
      stack?: string;
    };
  };
  raw: unknown;
}

function parseTrpcBody<T>(status: number, body: any): TrpcHttpResponse<T> {
  if (body?.error) {
    // superjson wraps the error payload: { error: { json: {...}, meta? } }
    const err =
      "json" in (body.error ?? {}) && body.error.json ? body.error.json : body.error;
    return { status, error: err, raw: body };
  }
  // superjson: result.data = { json: <payload>, meta?: ... }
  const data = body?.result?.data;
  const payload =
    data && typeof data === "object" && "json" in data ? data.json : data;
  return { status, data: payload as T, raw: body };
}

/** POST /api/trpc/<path> with a JSON input (mutation semantics). */
export async function trpcPost<T = unknown>(
  path: string,
  input: unknown,
  cookie?: string
): Promise<TrpcHttpResponse<T>> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(apiUrl(`/api/trpc/${path}`), {
    method: "POST",
    headers,
    body: JSON.stringify({ json: input ?? null }),
  });
  const body = await res.json().catch(() => null);
  return parseTrpcBody<T>(res.status, body);
}

/** GET /api/trpc/<path>?input=... (query semantics). */
export async function trpcGet<T = unknown>(
  path: string,
  input?: unknown,
  cookie?: string
): Promise<TrpcHttpResponse<T>> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  const qs =
    input === undefined
      ? ""
      : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await fetch(apiUrl(`/api/trpc/${path}${qs}`), { headers });
  const body = await res.json().catch(() => null);
  return parseTrpcBody<T>(res.status, body);
}
