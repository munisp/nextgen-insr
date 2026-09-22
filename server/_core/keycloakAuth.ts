// SECURITY: Rate limiting is handled by the API gateway/reverse proxy (nginx/cloudflare) in production.
/**
 * keycloakAuth.ts — Express route handlers for Keycloak Authorization Code flow
 *
 * Routes registered:
 *  GET  /api/auth/login    → redirect to Keycloak authorization endpoint
 *  GET  /api/auth/callback → exchange code for tokens, set session cookie
 *  GET  /api/auth/logout   → clear session cookie, redirect to Keycloak end-session
 *  GET  /api/auth/me       → return current user info from session (JSON)
 *
 * Session cookie: `kc_session` — HttpOnly, SameSite=Lax, Secure when https.
 * The cookie value is a server-signed JWT containing:
 *   { sub, name, email, role, accessToken, jti, acr?, amr?, exp }
 *
 * F6-2: the Keycloak refresh_token and id_token are NO LONGER stored in the
 * client cookie. They live in the server-side session store (Redis), keyed by
 * the session JWT's `jti`, with the same TTL as the session — a stolen cookie
 * can no longer mint fresh Keycloak tokens after the session expires.
 *
 * F6-1: logout blacklists the session token (and destroys the server-side
 * token entry); session validation checks the blacklist, so a logged-out or
 * revoked token is rejected before its natural expiry.
 *
 * The access_token is stored in the session so it can be forwarded to
 * downstream services that accept Bearer tokens (e.g. API Gateway).
 */

import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import type { Express, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";

import type { TokenResponse } from "./keycloak";
import {
  buildAuthorizationUrl,
  buildLogoutUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  verifyKeycloakToken,
  mapKeycloakRoleToPlatformRole,
  keycloakConfig,
} from "./keycloak";
import { logger } from './logger';
import { users } from "../../drizzle/schema";
import { getDb } from "../db";
import { getJwtSecret as getJwtSecretString } from "../lib/envValidation";
import {
  blacklistToken,
  getRedisClient,
  isTokenBlacklisted,
  isUserTokenRevoked,
  revokeAllUserTokens,
} from "../lib/redisClient";
import {
  hashSessionToken,
  revocationFailClosed,
} from "../middleware/agentAuth";

// ── Constants ─────────────────────────────────────────────────────────────────

export const KC_SESSION_COOKIE = "kc_session";
const STATE_COOKIE = "kc_state";
const RETURN_PATH_COOKIE = "kc_return";

// Session JWT is valid for 8 hours (Keycloak access tokens are typically 5 min,
// but we re-validate on every request using the stored access_token).
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

function getJwtSecret(): Uint8Array {
  return new TextEncoder().encode(getJwtSecretString());
}

// ── Session JWT ───────────────────────────────────────────────────────────────

export interface SessionPayload {
  sub: string; // Keycloak sub (stable user ID)
  name: string;
  email: string;
  role: "admin" | "supervisor" | "user";
  accessToken: string;
  /** Session ID — key of the server-side (Redis) token entry. */
  jti?: string;
  /** Authentication Context Class Reference from the Keycloak token (MFA). */
  acr?: string;
  /** Authentication Methods References from the Keycloak token (MFA). */
  amr?: string[];
}

async function createSessionJwt(payload: SessionPayload): Promise<string> {
  const { jti, ...claims } = payload;
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(jti ?? crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getJwtSecret());
}

// ── Server-side session token store (F6-2) ────────────────────────────────────
// The Keycloak refresh_token/id_token never touch the client. They are stored
// server-side in Redis under the session's jti with the session TTL.

interface StoredSessionTokens {
  refreshToken: string;
  idToken: string;
}

const sessionTokenKey = (jti: string): string => `session:tokens:${jti}`;

/**
 * Persist the Keycloak tokens for a new session. FAIL-CLOSED: if the store
 * write fails the login is aborted — a session without its server-side token
 * entry could not be refreshed or cleanly logged out.
 */
async function storeSessionTokens(
  jti: string,
  tokens: StoredSessionTokens
): Promise<void> {
  const client = getRedisClient();
  await client.set(
    sessionTokenKey(jti),
    JSON.stringify(tokens),
    "EX",
    SESSION_MAX_AGE_SECONDS
  );
}

async function getSessionTokens(
  jti: string
): Promise<StoredSessionTokens | null> {
  try {
    const client = getRedisClient();
    const raw = await client.get(sessionTokenKey(jti));
    if (!raw) return null;
    return JSON.parse(raw) as StoredSessionTokens;
  } catch (err) {
    logger.warn("[Keycloak] Session token store read failed:: " + String(err));
    return null;
  }
}

async function deleteSessionTokens(jti: string): Promise<void> {
  try {
    const client = getRedisClient();
    await client.del(sessionTokenKey(jti));
  } catch (err) {
    logger.warn("[Keycloak] Session token store delete failed:: " + String(err));
  }
}

// ── Role re-sync (AUTH-13) ────────────────────────────────────────────────────
// The platform role used by adminProcedure etc. must reflect the CURRENT
// Keycloak realm roles, not the role captured at login time. On each session
// verification we re-derive the role from the live Keycloak access token
// (JWKS verification is local crypto over a cached key set). Results are
// cached for 60s per access token to bound the per-request cost; a demotion
// propagates within at most one cache window instead of "until next login".
const ROLE_RESYNC_CACHE_MS = 60_000;
// P-wave perf (2026-09-19): the cache was an UNBOUNDED Map keyed by
// sha256(accessToken) — a memory leak in the auth hot path. Now a bounded
// LRU: max 10k entries, least-recently-used evicted first, expired entries
// swept opportunistically on write. TTL semantics unchanged (60s window).
const ROLE_RESYNC_CACHE_MAX = 10_000;
const roleResyncCache = new Map<
  string,
  { role: SessionPayload["role"]; expiresAt: number }
>();

function roleResyncCacheSet(
  key: string,
  value: { role: SessionPayload["role"]; expiresAt: number }
): void {
  // Refresh LRU position (Map preserves insertion order).
  roleResyncCache.delete(key);
  roleResyncCache.set(key, value);
  if (roleResyncCache.size > ROLE_RESYNC_CACHE_MAX) {
    const now = Date.now();
    // First pass: drop expired entries (oldest-first iteration).
    for (const [k, v] of roleResyncCache) {
      if (roleResyncCache.size <= ROLE_RESYNC_CACHE_MAX) break;
      if (v.expiresAt <= now) roleResyncCache.delete(k);
    }
    // Second pass: evict least-recently-used until within bound.
    while (roleResyncCache.size > ROLE_RESYNC_CACHE_MAX) {
      const oldest = roleResyncCache.keys().next().value;
      if (oldest === undefined) break;
      roleResyncCache.delete(oldest);
    }
  }
}

/** Test-only handle for the bounded role-resync cache (P-wave perf). */
export const __roleResyncCacheForTests = {
  cache: roleResyncCache,
  set: roleResyncCacheSet,
  MAX: ROLE_RESYNC_CACHE_MAX,
  TTL_MS: ROLE_RESYNC_CACHE_MS,
};

async function resyncRoleFromAccessToken(
  accessToken: string
): Promise<SessionPayload["role"] | null> {
  const key = createHash("sha256").update(accessToken).digest("hex");
  const cached = roleResyncCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    // LRU touch: refresh recency without changing the 60s TTL window.
    roleResyncCacheSet(key, cached);
    return cached.role;
  }
  try {
    const kcPayload = await verifyKeycloakToken(accessToken);
    const role = mapKeycloakRoleToPlatformRole(kcPayload);
    roleResyncCacheSet(key, {
      role,
      expiresAt: Date.now() + ROLE_RESYNC_CACHE_MS,
    });
    return role;
  } catch {
    // Access token expired/invalid (they live ~5min inside an 8h session) —
    // keep the session role; the refresh endpoint mints a fresh session.
    return null;
  }
}

/** Persist a role change discovered via token re-sync (fire-and-forget). */
async function persistRoleChange(sub: string, role: SessionPayload["role"]) {
  try {
    const db = await getDb();
    if (!db) return;
    await db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.keycloakSub, sub));
  } catch (err) {
    logger.warn("[Keycloak] Role re-sync DB persist failed:: " + String(err));
  }
}

/** Stable Redis key namespace for per-user session revocation (F6-1). */
export function kcSessionRevocationKey(sub: string): string {
  return `kc:${sub}`;
}

// ── Refresh-token rotation + reuse detection (AUTH-14) ────────────────────────
// Keycloak rotates refresh tokens on each use. We store every rotated-out
// refresh token hash for the remainder of the session lifetime; if a rotated
// token is ever presented again (token-store replay/theft), the whole session
// — and all of the user's sessions — is revoked immediately.

const usedRefreshTokenKey = (hash: string): string => `refresh:used:${hash}`;
const hashRefreshToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

async function markRefreshTokenUsed(token: string): Promise<void> {
  try {
    const client = getRedisClient();
    await client.set(
      usedRefreshTokenKey(hashRefreshToken(token)),
      "1",
      "EX",
      SESSION_MAX_AGE_SECONDS
    );
  } catch (err) {
    logger.warn("[Keycloak] Used-refresh-token mark failed:: " + String(err));
  }
}

async function isRefreshTokenUsed(token: string): Promise<boolean> {
  try {
    const client = getRedisClient();
    return (
      (await client.get(usedRefreshTokenKey(hashRefreshToken(token)))) !== null
    );
  } catch (err) {
    // Fail per the environment-wide revocation policy (AUTH-16): a store
    // outage must not let a replayed refresh token through.
    if (revocationFailClosed()) {
      logger.error(
        "[Keycloak] Used-refresh-token check failed — treating as reused (fail-closed):: " +
          String(err)
      );
      return true;
    }
    return false;
  }
}

export type RotateSessionResult =
  | { ok: true; tokens: TokenResponse }
  | { ok: false; reason: "no_session_tokens" | "reuse_detected" | "refresh_failed" };

/**
 * Rotate the session's Keycloak tokens. Reuse of an already-rotated refresh
 * token revokes the session AND all sessions for the user (RFC 6819 §5.2.2.3).
 */
export async function rotateSessionTokens(
  jti: string,
  sub: string
): Promise<RotateSessionResult> {
  const stored = await getSessionTokens(jti);
  if (!stored?.refreshToken) {
    return { ok: false, reason: "no_session_tokens" };
  }

  if (await isRefreshTokenUsed(stored.refreshToken)) {
    logger.error(
      { sub },
      "[Keycloak] REFRESH TOKEN REUSE DETECTED — revoking all user sessions"
    );
    await deleteSessionTokens(jti);
    await revokeAllUserTokens(kcSessionRevocationKey(sub));
    return { ok: false, reason: "reuse_detected" };
  }

  try {
    const tokens = await refreshAccessToken(stored.refreshToken);
    // Rotation: the old refresh token is spent; persist the new set
    // fail-closed (a session we cannot rotate is killed, not left stale).
    await markRefreshTokenUsed(stored.refreshToken);
    await storeSessionTokens(jti, {
      refreshToken: tokens.refresh_token ?? stored.refreshToken,
      idToken: tokens.id_token ?? stored.idToken,
    });
    return { ok: true, tokens };
  } catch (err) {
    logger.warn("[Keycloak] Token refresh failed:: " + String(err));
    return { ok: false, reason: "refresh_failed" };
  }
}

/**
 * Verify a session JWT and enforce the revocation lists (F6-1):
 *  1. per-token blacklist (logout)
 *  2. per-user revocation timestamp (force logout-all)
 * Revocation checks fail CLOSED in production: an unreachable revocation
 * store rejects the session instead of letting a killed session live on.
 */
export async function verifySessionJwt(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    // AUTH-16: fail-closed in every environment unless the explicit
    // non-production demo flag AUTH_REVOCATION_FAIL_OPEN_DEMO=true is set.
    const failClosed = revocationFailClosed();
    if (await isTokenBlacklisted(hashSessionToken(token), failClosed)) {
      return null;
    }
    if (
      payload.sub &&
      typeof payload.iat === "number" &&
      (await isUserTokenRevoked(
        kcSessionRevocationKey(payload.sub),
        payload.iat,
        failClosed
      ))
    ) {
      return null;
    }
    const session = payload as unknown as SessionPayload;
    // AUTH-13: re-sync the role from the current Keycloak token on every
    // request so a realm-level demotion takes effect without waiting for
    // re-login. The token-derived role always wins (least privilege).
    if (session.accessToken) {
      const liveRole = await resyncRoleFromAccessToken(session.accessToken);
      if (liveRole && liveRole !== session.role) {
        logger.info(
          { sub: session.sub, from: session.role, to: liveRole },
          "[Keycloak] Role re-synced from token"
        );
        session.role = liveRole;
        void persistRoleChange(session.sub, liveRole);
      }
    }
    return session;
  } catch {
    return null;
  }
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

function isSecure(req: Request): boolean {
  if (req.protocol === "https") return true;
  const fwd = req.headers["x-forwarded-proto"];
  if (!fwd) return false;
  return (Array.isArray(fwd) ? fwd : fwd.split(",")).some(
    p => p.trim().toLowerCase() === "https"
  );
}

function sessionCookieOptions(req: Request) {
  return {
    httpOnly: true,
    path: "/",
    // F6-2 hardening: Lax (not None) — the session cookie is never needed
    // cross-site, and Lax blocks cross-site POST/websocket credentialed sends.
    sameSite: "lax" as const,
    secure: isSecure(req),
    maxAge: SESSION_MAX_AGE_SECONDS * 1000,
  };
}

function stateCookieOptions(req: Request) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: isSecure(req),
    maxAge: 10 * 60 * 1000, // 10 minutes
  };
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function upsertUserFromKeycloak(session: SessionPayload) {
  const db = await getDb();
  if (!db) return;

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.keycloakSub, session.sub))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(users).values({
      keycloakSub: session.sub,
      name: session.name || null,
      email: session.email || null,
      role: session.role,
      loginMethod: "keycloak",
      lastSignedIn: new Date(),
    });
  } else {
    await db
      .update(users)
      .set({
        name: session.name || null,
        email: session.email || null,
        role: session.role,
        lastSignedIn: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.keycloakSub, session.sub));
  }
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerKeycloakAuthRoutes(app: Express): void {
  /**
   * GET /api/auth/login
   * Initiates the Authorization Code flow.
   * Accepts optional ?returnTo=/path query param to redirect after login.
   */
  app.get("/api/auth/login", (req: Request, res: Response) => {
    // Guard: if KEYCLOAK_URL is not configured, return a clear 503 instead of crashing
    if (!process.env.KEYCLOAK_URL) {
      res.status(503).json({
        error: "keycloak_not_configured",
        message:
          "Keycloak SSO is not configured on this server. Set KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID, and KEYCLOAK_CLIENT_SECRET.",
      });
      return;
    }
    const returnTo = (req.query.returnTo as string) || "/";
    const state = crypto.randomUUID();
    const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/callback`;

    // Store state and returnTo in short-lived cookies
    res.cookie(STATE_COOKIE, state, stateCookieOptions(req));
    res.cookie(RETURN_PATH_COOKIE, returnTo, stateCookieOptions(req));

    const authUrl = buildAuthorizationUrl({ redirectUri, state });
    res.redirect(authUrl);
  });

  /**
   * GET /api/auth/callback
   * Handles the Keycloak redirect after successful authentication.
   */
  app.get("/api/auth/callback", async (req: Request, res: Response) => {
    const { code, state, error, error_description } = req.query as Record<
      string,
      string
    >;

    if (error) {
      logger.error(`[Keycloak] Auth error: ${error} — ${error_description}`);
      res.redirect(
        `/?auth_error=${encodeURIComponent(error_description ?? error)}`
      );
      return;
    }

    // Validate state to prevent CSRF
    const cookies = parseCookies(req.headers.cookie ?? "");
    const expectedState = cookies.get(STATE_COOKIE);
    const returnTo = cookies.get(RETURN_PATH_COOKIE) ?? "/";

    if (!expectedState || expectedState !== state) {
      logger.error("[Keycloak] State mismatch — possible CSRF attack");
      res.status(400).send("Invalid state parameter");
      return;
    }

    try {
      const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/callback`;
      const tokens = await exchangeCodeForTokens({ code, redirectUri });

      // Verify the access token (validates signature, issuer, expiry)
      const payload = await verifyKeycloakToken(tokens.access_token);
      const role = mapKeycloakRoleToPlatformRole(payload);

      // Real Keycloak claims: acr/amr indicate the authentication context
      // (MFA step-up). Carried into the session so privileged operations can
      // verify the login actually used a second factor.
      const tokenClaims = payload as typeof payload & {
        acr?: string;
        amr?: string[];
      };

      const jti = crypto.randomUUID();
      // F6-2: refresh/id tokens go to the server-side store, never the cookie.
      // Fail-closed: a login that cannot persist its token entry is aborted.
      await storeSessionTokens(jti, {
        refreshToken: tokens.refresh_token ?? "",
        idToken: tokens.id_token ?? "",
      });

      const session: SessionPayload = {
        sub: payload.sub,
        name: payload.name ?? payload.preferred_username ?? "",
        email: payload.email ?? "",
        role,
        accessToken: tokens.access_token,
        jti,
        ...(tokenClaims.acr ? { acr: tokenClaims.acr } : {}),
        ...(Array.isArray(tokenClaims.amr) ? { amr: tokenClaims.amr } : {}),
      };

      // Upsert user in DB
      await upsertUserFromKeycloak(session);

      // Issue session cookie
      const sessionJwt = await createSessionJwt(session);
      res.cookie(KC_SESSION_COOKIE, sessionJwt, sessionCookieOptions(req));

      // Clear state cookies
      res.clearCookie(STATE_COOKIE, { path: "/" });
      res.clearCookie(RETURN_PATH_COOKIE, { path: "/" });

      console.info(
        `[Keycloak] Login success — role: ${session.role}, sub: ${session.sub.slice(0, 8)}...`
      );
      res.redirect(returnTo);
    } catch (err) {
      logger.error("[Keycloak] Callback error:: " + err);
      res.redirect("/?auth_error=callback_failed");
    }
  });

  /**
   * POST /api/auth/refresh
   * Rotates the Keycloak tokens for the current session (AUTH-14) and mints
   * a fresh session JWT carrying the new access token and the re-synced role
   * (AUTH-13). Refresh-token reuse revokes all of the user's sessions.
   */
  app.post("/api/auth/refresh", async (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie ?? "");
    const sessionToken = cookies.get(KC_SESSION_COOKIE);
    if (!sessionToken) {
      res.status(401).json({ error: "not_authenticated" });
      return;
    }
    const session = await verifySessionJwt(sessionToken);
    if (!session || typeof session.jti !== "string") {
      res.status(401).json({ error: "invalid_session" });
      return;
    }

    const rotated = await rotateSessionTokens(session.jti, session.sub);
    if (!rotated.ok) {
      if (rotated.reason === "reuse_detected") {
        // Kill this session token too — the cookie holder may be the attacker.
        try {
          const { payload } = await jwtVerify(sessionToken, getJwtSecret());
          await blacklistToken(
            hashSessionToken(sessionToken),
            typeof payload.exp === "number"
              ? payload.exp
              : Math.floor(Date.now() / 1000)
          );
        } catch {
          /* token already unusable */
        }
        res.clearCookie(KC_SESSION_COOKIE, { path: "/" });
        res.status(401).json({ error: "refresh_token_reuse_detected" });
        return;
      }
      res.status(401).json({ error: rotated.reason });
      return;
    }

    try {
      const kcPayload = await verifyKeycloakToken(rotated.tokens.access_token);
      const role = mapKeycloakRoleToPlatformRole(kcPayload);
      const newSession: SessionPayload = {
        ...session,
        role,
        accessToken: rotated.tokens.access_token,
      };
      await upsertUserFromKeycloak(newSession);
      const sessionJwt = await createSessionJwt(newSession);
      // Blacklist the superseded session JWT so only the fresh one is valid.
      try {
        const { payload } = await jwtVerify(sessionToken, getJwtSecret());
        await blacklistToken(
          hashSessionToken(sessionToken),
          typeof payload.exp === "number"
            ? payload.exp
            : Math.floor(Date.now() / 1000)
        );
      } catch {
        /* best-effort */
      }
      res.cookie(KC_SESSION_COOKIE, sessionJwt, sessionCookieOptions(req));
      res.json({ authenticated: true, role });
    } catch (err) {
      logger.error("[Keycloak] Refresh post-processing failed:: " + err);
      res.status(500).json({ error: "refresh_failed" });
    }
  });

  /**
   * GET /api/auth/logout
   * Clears the session cookie and redirects to Keycloak end-session endpoint.
   */
  app.get("/api/auth/logout", async (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie ?? "");
    const sessionToken = cookies.get(KC_SESSION_COOKIE);

    let idTokenHint: string | undefined;
    if (sessionToken) {
      // Decode directly (not verifySessionJwt) so even an already-blacklisted
      // or expired session is revoked again — logout must be idempotent.
      try {
        const { payload } = await jwtVerify(sessionToken, getJwtSecret());
        // F6-1: revoke the session server-side. A cleared cookie alone left
        // the 8h JWT valid to anyone holding it.
        const exp =
          typeof payload.exp === "number"
            ? payload.exp
            : Math.floor(Date.now() / 1000);
        await blacklistToken(hashSessionToken(sessionToken), exp);
        if (typeof payload.jti === "string") {
          const stored = await getSessionTokens(payload.jti);
          idTokenHint = stored?.idToken || undefined;
          await deleteSessionTokens(payload.jti);
        }
      } catch {
        // Unverifiable token — nothing server-side to revoke.
      }
    }

    // Clear session cookie
    res.clearCookie(KC_SESSION_COOKIE, { path: "/" });

    const postLogoutUri = `${req.protocol}://${req.get("host")}/`;
    const logoutUrl = buildLogoutUrl({
      idTokenHint,
      postLogoutRedirectUri: postLogoutUri,
    });

    res.redirect(logoutUrl);
  });

  /**
   * GET /api/auth/me
   * Returns the current user's session info as JSON.
   * Used by the frontend to check auth state without a tRPC call.
   */
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie ?? "");
    const sessionToken = cookies.get(KC_SESSION_COOKIE);

    if (!sessionToken) {
      res.status(401).json({ authenticated: false });
      return;
    }

    const session = await verifySessionJwt(sessionToken);
    if (!session) {
      res.clearCookie(KC_SESSION_COOKIE, { path: "/" });
      res.status(401).json({ authenticated: false });
      return;
    }

    res.json({
      authenticated: true,
      sub: session.sub,
      name: session.name,
      email: session.email,
      role: session.role,
    });
  });
}

// ── Cookie parser ─────────────────────────────────────────────────────────────

function parseCookies(cookieHeader: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) map.set(k.trim(), decodeURIComponent(v.join("=")));
  }
  return map;
}

// ── MFA Enforcement (PCI-DSS REQ 8.4) ────────────────────────────────────────
// Keycloak enforces MFA at the realm level for all admin and financial roles.
// The following roles require TOTP/WebAuthn: admin, super_admin, billing_admin,
// compliance_officer, claims_adjuster, underwriter.
// MFA is configured in Keycloak realm settings (infra/keycloak/realm-export.json).
// The acr_values claim in the JWT indicates the authentication context:
//   - acr=1: password only
//   - acr=2: password + TOTP/WebAuthn (MFA)
export const MFA_REQUIRED_ROLES = new Set([
  'admin', 'super_admin', 'billing_admin', 'compliance_officer',
  'claims_adjuster', 'underwriter', 'actuary',
]);

export function requiresMfa(role: string): boolean {
  return MFA_REQUIRED_ROLES.has(role);
}

export function hasMfaCompleted(payload: { acr?: string; amr?: string[] }): boolean {
  // acr=2 or amr includes 'otp' or 'webauthn indicates MFA was completed
  if (payload.acr === '2') return true;
  if (Array.isArray(payload.amr) && (payload.amr.includes('otp') || payload.amr.includes('webauthn'))) return true;
  return false;
}
