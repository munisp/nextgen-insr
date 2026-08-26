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

import { eq } from "drizzle-orm";
import type { Express, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";

import {
  buildAuthorizationUrl,
  buildLogoutUrl,
  exchangeCodeForTokens,
  verifyKeycloakToken,
  mapKeycloakRoleToPlatformRole,
  keycloakConfig,
} from "./keycloak";
import { users } from "../../drizzle/schema";
import { getDb } from "../db";
import { logger } from './logger';
import { getJwtSecret as getJwtSecretString } from "../lib/envValidation";
import {
  blacklistToken,
  getRedisClient,
  isTokenBlacklisted,
  isUserTokenRevoked,
} from "../lib/redisClient";
import { hashSessionToken } from "../middleware/agentAuth";

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

/** Stable Redis key namespace for per-user session revocation (F6-1). */
export function kcSessionRevocationKey(sub: string): string {
  return `kc:${sub}`;
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
    const failClosed = process.env.NODE_ENV === "production";
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
    return payload as unknown as SessionPayload;
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
