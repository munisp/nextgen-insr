/**
 * keycloakAuth.ts — 2026-10-01 (W9-B3)
 * Real authentication for the mobile app: OpenID Connect authorization-code
 * flow with PKCE against the platform Keycloak realm — the same identity
 * provider the web portal uses (see server/_core/keycloakAuth.ts).
 *
 * Why this replaced authApi.login: the previous implementation POSTed
 * email/password to /api/v1/auth/login on the Go BFF (insurance-mobile-app),
 * a route that does NOT exist (main.go routes are health/ready, mobile_sessions,
 * device/register, sync, policies) — every login was a guaranteed 404. No
 * password endpoint is invented here; instead the app uses the realm's real
 * authorization/token endpoints via react-native-app-auth, which performs the
 * flow in the system browser (ASWebAuthenticationSession / Chrome Custom Tab)
 * with PKCE, so user credentials never transit this app.
 *
 * Server side (verified, no server change required): the monolith tRPC
 * context already accepts `Authorization: Bearer <keycloak-access-token>`
 * and verifies the JWT against the realm JWKS — server/_core/context.ts
 * resolveUserFromKeycloakJwt → server/_core/keycloak.ts verifyKeycloakToken
 * (jose createRemoteJWKSet). Fail-closed: verification failure → user=null.
 *
 * Token storage: AsyncStorage. NOTE — AsyncStorage is app-sandboxed but not
 * hardware-backed; a production build SHOULD move tokens to secure enclave
 * storage (e.g. react-native-keychain). Recorded as a known hardening item,
 * not silently presented as secure enclave storage.
 */
import { authorize, refresh as oidcRefresh, revoke } from 'react-native-app-auth';
import type { AuthorizeResult } from 'react-native-app-auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

declare const __DEV__: boolean;

export const TOKEN_KEY = '@insureportal/auth_token';
export const REFRESH_KEY = '@insureportal/refresh_token';
export const ID_TOKEN_KEY = '@insureportal/id_token';
export const EXPIRES_KEY = '@insureportal/token_expires_at';

/** Refresh proactively this many ms before actual expiry (clock skew). */
export const REFRESH_SKEW_MS = 60_000;

const DEV_HOST = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';

function requireEnv(value: string | undefined, name: string, devFallback: string): string {
  if (value && value.trim() !== '') return value.trim().replace(/\/+$/, '');
  if (__DEV__) return devFallback;
  // Fail-closed: identity endpoints must never silently default in production.
  throw new Error(`[keycloakAuth] ${name} is not set — build-time env required in production`);
}

/** Keycloak realm issuer URL, e.g. https://auth.insureportal.ng/realms/insureportal */
export const KEYCLOAK_ISSUER = requireEnv(
  process.env.KEYCLOAK_ISSUER,
  'KEYCLOAK_ISSUER',
  `http://${DEV_HOST}:8080/realms/insureportal`,
);

/** Public OIDC client registered for this mobile app (PKCE, no secret). */
export const KEYCLOAK_CLIENT_ID = requireEnv(
  process.env.KEYCLOAK_CLIENT_ID,
  'KEYCLOAK_CLIENT_ID',
  'insureportal-mobile',
);

/** Redirect URI scheme registered on the Keycloak client. */
export const KEYCLOAK_REDIRECT_URI = requireEnv(
  process.env.KEYCLOAK_REDIRECT_URI,
  'KEYCLOAK_REDIRECT_URI',
  'ng.insureportal.mobile://oauth/callback',
);

export interface OidcConfig {
  issuer: string;
  clientId: string;
  redirectUrl: string;
  scopes: string[];
}

/** Pure config builder — kept dependency-free for unit testing. */
export function buildOidcConfig(
  issuer: string = KEYCLOAK_ISSUER,
  clientId: string = KEYCLOAK_CLIENT_ID,
  redirectUrl: string = KEYCLOAK_REDIRECT_URI,
): OidcConfig {
  return {
    issuer,
    clientId,
    redirectUrl,
    scopes: ['openid', 'profile', 'email', 'offline_access'],
  };
}

/** Pure: absolute expiry timestamp (ms) from a token response expiresIn (s). */
export function computeExpiry(expiresInSeconds: number, nowMs: number = Date.now()): number {
  return nowMs + expiresInSeconds * 1000;
}

/** Pure: should the token be refreshed (expired or within the skew window)? */
export function shouldRefresh(expiresAtMs: number | null, nowMs: number = Date.now(), skewMs: number = REFRESH_SKEW_MS): boolean {
  if (expiresAtMs == null || !Number.isFinite(expiresAtMs)) return true;
  return nowMs >= expiresAtMs - skewMs;
}

async function storeTokens(result: AuthorizeResult): Promise<void> {
  // react-native-app-auth returns an absolute ISO expiration date; prefer it
  const expiresAt = result.accessTokenExpirationDate
    ? new Date(result.accessTokenExpirationDate).getTime()
    : computeExpiry((result as { expiresIn?: number }).expiresIn ?? 0);
  await AsyncStorage.multiSet([
    [TOKEN_KEY, result.accessToken],
    [EXPIRES_KEY, String(expiresAt)],
    ...(result.refreshToken ? [[REFRESH_KEY, result.refreshToken] as [string, string]] : []),
    ...(result.idToken ? [[ID_TOKEN_KEY, result.idToken] as [string, string]] : []),
  ]);
}

/** Interactive sign-in via the system browser. Throws on cancel/failure —
 *  callers must surface the error, never swallow it. */
export async function signIn(): Promise<AuthorizeResult> {
  const result = await authorize(buildOidcConfig());
  await storeTokens(result);
  return result;
}

export async function getStoredAccessToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function getStoredExpiry(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(EXPIRES_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function clearTokens(): Promise<void> {
  await AsyncStorage.multiRemove([TOKEN_KEY, REFRESH_KEY, ID_TOKEN_KEY, EXPIRES_KEY]);
}

/**
 * Refresh the access token using the stored refresh token.
 * Fail-closed: if no refresh token exists or the realm rejects it, all
 * tokens are cleared and an honest error is thrown — the caller (and the
 * axios 401 interceptor) must treat this as "signed out".
 */
export async function refreshAccessToken(): Promise<string> {
  const refreshToken = await AsyncStorage.getItem(REFRESH_KEY);
  if (!refreshToken) {
    await clearTokens();
    throw new Error('No refresh token — please sign in again');
  }
  try {
    const result = await oidcRefresh(buildOidcConfig(), { refreshToken });
    await storeTokens(result as AuthorizeResult);
    return result.accessToken;
  } catch (err) {
    await clearTokens();
    throw new Error('Session expired — please sign in again');
  }
}

/** Returns an access token that is valid for at least REFRESH_SKEW_MS,
 *  refreshing first when necessary. Throws when the session is dead. */
export async function getValidAccessToken(): Promise<string> {
  const [token, expiresAt] = await Promise.all([getStoredAccessToken(), getStoredExpiry()]);
  if (token && !shouldRefresh(expiresAt)) return token;
  return refreshAccessToken();
}

/**
 * Sign out: best-effort token revocation at the realm, then ALWAYS clear
 * local tokens. Revocation failure must not strand tokens on the device.
 */
export async function signOut(): Promise<void> {
  const token = await getStoredAccessToken();
  try {
    if (token) {
      await revoke(buildOidcConfig(), { tokenToRevoke: token, sendClientId: true });
    }
  } catch {
    // best-effort revocation; local clear below is the authoritative logout
  }
  await clearTokens();
}
