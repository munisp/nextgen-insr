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

/** tRPC-over-HTTP helpers (v10 shape: {result:{data}} / {error}). */
export async function trpcQuery<T>(procedure: string, input: unknown, token?: string | null): Promise<T> {
  const res = await fetch(
    `${TRPC_BASE_URL}/${procedure}?input=${encodeURIComponent(JSON.stringify({ json: input ?? null }))}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.error) {
    throw new Error(json?.error?.message || `Request failed (HTTP ${res.status})`);
  }
  return json?.result?.data as T;
}

export async function trpcMutation<T>(procedure: string, input: unknown, token?: string | null): Promise<T> {
  const res = await fetch(`${TRPC_BASE_URL}/${procedure}`, {
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
  return json?.result?.data as T;
}
