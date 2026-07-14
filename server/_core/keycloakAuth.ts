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
 * Session cookie: `kc_session` — HttpOnly, SameSite=None, Secure in production.
 * The cookie value is a server-signed JWT containing:
 *   { sub, name, email, role, accessToken, refreshToken, idToken, exp }
 *
 * The access_token is stored in the session so it can be forwarded to
 * downstream services that accept Bearer tokens (e.g. API Gateway).
 */

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
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { getJwtSecret as getJwtSecretString } from "../lib/envValidation";
import { logger } from './logger';

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
  refreshToken: string;
  idToken: string;
}

async function createSessionJwt(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getJwtSecret());
}

export async function verifySessionJwt(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
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
    sameSite: "none" as const,
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

      const session: SessionPayload = {
        sub: payload.sub,
        name: payload.name ?? payload.preferred_username ?? "",
        email: payload.email ?? "",
        role,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? "",
        idToken: tokens.id_token ?? "",
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
      const session = await verifySessionJwt(sessionToken);
      idTokenHint = session?.idToken;
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
