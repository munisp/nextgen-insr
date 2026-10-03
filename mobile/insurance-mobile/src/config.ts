/**
 * config.ts — 2026-10-01 (R1c)
 * Centralized endpoint configuration. Previously screens hardcoded
 * `http://localhost:3000/api/trpc`, so production builds silently talked to
 * the developer's machine and every call failed. Base URLs now come from
 * build-time env (react-native-config / babel-inline-environment); localhost
 * fallbacks exist ONLY behind __DEV__ and never ship in release builds.
 */
import { Platform } from 'react-native';

declare const __DEV__: boolean;

// Android emulators reach the host machine via 10.0.2.2, not localhost.
const DEV_HOST = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';

function requireEnv(value: string | undefined, name: string, devFallback: string): string {
  if (value && value.trim() !== '') return value.trim().replace(/\/+$/, '');
  if (__DEV__) return devFallback;
  // Fail-closed in production: a missing endpoint must throw at module load,
  // not silently route funds/identity traffic to a default address.
  throw new Error(`[config] ${name} is not set — build-time env required in production`);
}

/** Go BFF (insurance-mobile-app) — offline sync, auth, policy passthrough. */
export const API_BASE_URL = requireEnv(
  process.env.API_URL,
  'API_URL',
  `http://${DEV_HOST}:8113`,
);

/** Monolith tRPC base (…/api/trpc). */
export const TRPC_BASE_URL = requireEnv(
  process.env.MONOLITH_API_URL,
  'MONOLITH_API_URL',
  `http://${DEV_HOST}:3000`,
) + '/api/trpc';

/**
 * 2026-10-03 (W9-B4 round 2): the monolith tRPC server is configured with
 * `transformer: superjson` (server/_core/trpc.ts:12), so a success response
 * is `{result:{data:{json:<payload>, meta?}}}` — `result.data` is the
 * superjson ENVELOPE, not the payload. The web client never sees this
 * because @trpc/client is configured with the same transformer and
 * deserializes natively; mobile calls over raw HTTP and must replicate that
 * contract manually. Returning `result.data` unwrapped (the pre-round-2 bug)
 * silently delivered `{json: payload}` to every screen, rendering empty or
 * broken data without erroring.
 *
 * `unwrapTrpcData` deserializes the envelope with superjson (which also
 * restores meta-typed values such as Dates — matching the web client's
 * behavior exactly). A bare non-envelope payload is returned as-is so this
 * never crashes against a hypothetical non-superjson deployment.
 */
import superjson, { type SuperJSONResult } from 'superjson';
// 2026-10-03 (W9-B6): every tRPC egress passes through the PINNED_DOMAINS
// domain allowlist (fail-closed, checked BEFORE any network I/O). This is
// domain-allowlisting, NOT TLS certificate pinning — true pinning needs the
// native layer; see services/domainAllowlist.ts.
import { guardedFetch } from './services/domainAllowlist';

function unwrapTrpcData<T>(data: unknown): T {
  if (
    data !== null &&
    typeof data === 'object' &&
    'json' in (data as Record<string, unknown>)
  ) {
    return superjson.deserialize(data as SuperJSONResult) as T;
  }
  return data as T;
}

/** tRPC-over-HTTP helpers (v10 + superjson envelope: {result:{data:{json,meta?}}} / {error}). */
export async function trpcQuery<T>(procedure: string, input: unknown, token?: string | null): Promise<T> {
  const res = await guardedFetch(
    `${TRPC_BASE_URL}/${procedure}?input=${encodeURIComponent(JSON.stringify({ json: input ?? null }))}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.error) {
    throw new Error(json?.error?.message || `Request failed (HTTP ${res.status})`);
  }
  return unwrapTrpcData<T>(json?.result?.data);
}

export async function trpcMutation<T>(procedure: string, input: unknown, token?: string | null): Promise<T> {
  const res = await guardedFetch(`${TRPC_BASE_URL}/${procedure}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ json: input ?? null }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.error) {
    throw new Error(json?.error?.message || `Request failed (HTTP ${res.status})`);
  }
  return unwrapTrpcData<T>(json?.result?.data);
}
