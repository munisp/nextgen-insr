/**
 * memberTrpc.ts — 2026-10-03 (W9-B4)
 * Member-scoped tRPC client for the hardened member* routers
 * (server/routers/member*.ts, mounted in server/routers.ts).
 *
 * - Bearer attachment: the Keycloak access token from keycloakAuth
 *   (getValidAccessToken refreshes proactively inside the skew window).
 *   No stored token → the call is NOT sent bare; the server would 401, so
 *   we fail-closed locally with an honest signed-out error.
 * - Error mapping: a UNAUTHORIZED/401 response triggers ONE refresh via
 *   the existing Keycloak rotation logic and ONE retry. If refresh fails,
 *   refreshAccessToken has already cleared the tokens (honest logout) and
 *   the error propagates — no silent fallback, no fabricated data.
 *
 * Only the transport boundary (fetch) lives in config.ts; this module owns
 * auth semantics. Screens/services must call member* procedures through
 * here, never through raw fetch.
 */
import { trpcQuery, trpcMutation } from '../config';
import { getValidAccessToken, refreshAccessToken } from './keycloakAuth';

function isUnauthorized(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /unauthorized|HTTP 401/i.test(msg);
}

async function callWithAuth<T>(
  fn: (procedure: string, input: unknown, token?: string | null) => Promise<T>,
  procedure: string,
  input: unknown,
): Promise<T> {
  // getValidAccessToken throws when the session is dead — fail-closed:
  // the request is never sent without a real token.
  const token = await getValidAccessToken();
  try {
    return await fn(procedure, input, token);
  } catch (err) {
    if (!isUnauthorized(err)) throw err;
    // One refresh via the existing Keycloak single-flight rotation, one
    // retry. Refresh failure clears tokens and rethrows (honest logout).
    const rotated = await refreshAccessToken();
    return fn(procedure, input, rotated);
  }
}

/** Call a member* tRPC query with the caller's Keycloak Bearer token. */
export function memberQuery<T>(procedure: string, input: unknown = null): Promise<T> {
  return callWithAuth(trpcQuery<T>, procedure, input);
}

/** Call a member* tRPC mutation with the caller's Keycloak Bearer token. */
export function memberMutation<T>(procedure: string, input: unknown = null): Promise<T> {
  return callWithAuth(trpcMutation<T>, procedure, input);
}
