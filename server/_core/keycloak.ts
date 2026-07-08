// @ts-check

/**
 * keycloak.ts — Keycloak OIDC integration for InsurePortal POS Shell
 *
 * Responsibilities:
 *  1. Discover Keycloak OIDC configuration (JWKS, endpoints)
 *  2. Verify Keycloak-issued JWTs (RS256) using the JWKS endpoint
 *  3. Build authorization URL for Authorization Code flow
 *  4. Exchange authorization code for tokens
 *  5. Refresh tokens
 *  6. Build end-session (logout) URL
 *
 * Environment variables required:
 *  - KEYCLOAK_URL          e.g. https://auth.insureportal.io
 *  - KEYCLOAK_REALM        e.g. insureportal
 *  - KEYCLOAK_CLIENT_ID    e.g. insurance-portal
 *  - KEYCLOAK_CLIENT_SECRET (confidential client secret)
 *
 * The platform uses a confidential OIDC client with PKCE disabled.
 * All token validation is done locally using the JWKS endpoint — no
 * introspection calls are made on every request.
 */

import { createRemoteJWKSet, jwtVerify, decodeJwt } from "jose";
import type { JWTPayload } from "jose";

// ── Configuration ─────────────────────────────────────────────────────────────

export interface KeycloakConfig {
  url: string;
  realm: string;
  clientId: string;
  clientSecret: string;
}

function getConfig(): KeycloakConfig {
  // Default: local Keycloak Docker container (docker-compose.production.yml)
  // Override KEYCLOAK_URL in .env.production for remote deployments
  const url = process.env.KEYCLOAK_URL ?? "http://localhost:8080";
  const realm = process.env.KEYCLOAK_REALM ?? "insureportal";
  const clientId = process.env.KEYCLOAK_CLIENT_ID ?? "insurance-portal";
  const clientSecret =
    process.env.KEYCLOAK_CLIENT_SECRET ??
    "insurance-portal-secret-change-in-production";

  return { url, realm, clientId, clientSecret };
}

export const keycloakConfig = getConfig();

// ── OIDC Endpoints ────────────────────────────────────────────────────────────

export function issuerUrl(): string {
  const { url, realm } = keycloakConfig;
  return `${url}/realms/${realm}`;
}

export function authorizationEndpoint(): string {
  return `${issuerUrl()}/protocol/openid-connect/auth`;
}

export function tokenEndpoint(): string {
  return `${issuerUrl()}/protocol/openid-connect/token`;
}

export function endSessionEndpoint(): string {
  return `${issuerUrl()}/protocol/openid-connect/logout`;
}

export function jwksUri(): string {
  return `${issuerUrl()}/protocol/openid-connect/certs`;
}

export function userInfoEndpoint(): string {
  return `${issuerUrl()}/protocol/openid-connect/userinfo`;
}

// ── JWKS Remote Key Set (cached, auto-refreshed) ──────────────────────────────

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!_jwks) {
    _jwks = createRemoteJWKSet(new URL(jwksUri()));
  }
  return _jwks;
}

// ── Token Payload ─────────────────────────────────────────────────────────────

export interface KeycloakTokenPayload extends JWTPayload {
  sub: string;
  preferred_username?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  realm_access?: { roles: string[] };
  resource_access?: Record<string, { roles: string[] }>;
}

// ── JWT Verification ──────────────────────────────────────────────────────────

/**
 * Verify a Keycloak-issued JWT (access_token or id_token).
 * Returns the decoded payload on success, throws on failure.
 */
export async function verifyKeycloakToken(
  token: string
): Promise<KeycloakTokenPayload> {
  const { payload } = await jwtVerify(token, getJWKS(), {
    issuer: issuerUrl(),
    audience: keycloakConfig.clientId,
  });
  return payload as KeycloakTokenPayload;
}

/**
 * Decode a JWT without verification (for extracting exp/sub from refresh tokens).
 * Use only for non-security-critical reads.
 */
export function decodeToken(token: string): KeycloakTokenPayload {
  return decodeJwt(token) as KeycloakTokenPayload;
}

// ── Authorization Code Flow ───────────────────────────────────────────────────

/**
 * Build the Keycloak authorization URL for the Authorization Code flow.
 * The `state` parameter is a random nonce stored in a short-lived cookie
 * to prevent CSRF attacks.
 */
export function buildAuthorizationUrl(params: {
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const url = new URL(authorizationEndpoint());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", keycloakConfig.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("scope", params.scope ?? "openid profile email");
  return url.toString();
}

// ── Token Exchange ────────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
  refresh_expires_in?: number;
  scope: string;
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCodeForTokens(params: {
  code: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const { clientId, clientSecret } = keycloakConfig;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
  });

  const res = await fetch(tokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `[Keycloak] Token exchange failed (${res.status}): ${text}`
    );
  }

  return res.json() as Promise<TokenResponse>;
}

/**
 * Refresh an access token using a refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<TokenResponse> {
  const { clientId, clientSecret } = keycloakConfig;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const res = await fetch(tokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[Keycloak] Token refresh failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<TokenResponse>;
}

// ── Logout ────────────────────────────────────────────────────────────────────

/**
 * Build the Keycloak end-session URL.
 * After redirecting here, Keycloak clears the SSO session and redirects
 * back to `postLogoutRedirectUri`.
 */
export function buildLogoutUrl(params: {
  idTokenHint?: string;
  postLogoutRedirectUri?: string;
}): string {
  const url = new URL(endSessionEndpoint());
  if (params.idTokenHint) {
    url.searchParams.set("id_token_hint", params.idTokenHint);
  }
  if (params.postLogoutRedirectUri) {
    url.searchParams.set(
      "post_logout_redirect_uri",
      params.postLogoutRedirectUri
    );
    url.searchParams.set("client_id", keycloakConfig.clientId);
  }
  return url.toString();
}

// ── Role Extraction ───────────────────────────────────────────────────────────

/**
 * Extract realm roles from a decoded Keycloak token.
 * Returns an empty array if no roles are present.
 */
export function getRealmRoles(payload: KeycloakTokenPayload): string[] {
  return payload.realm_access?.roles ?? [];
}

/**
 * Map Keycloak realm roles to the platform role enum.
 * Priority: admin > supervisor > user
 */
export function mapKeycloakRoleToPlatformRole(
  payload: KeycloakTokenPayload
): "admin" | "supervisor" | "user" {
  const roles = getRealmRoles(payload);
  if (roles.includes("insureportal-admin") || roles.includes("admin")) return "admin";
  if (roles.includes("insureportal-supervisor") || roles.includes("supervisor"))
    return "supervisor";
  return "user";
}
