/**
 * harness.tsx — 2026-10-03 (W9-B6)
 * Shared smoke-test harness for the screen suites. Import this module FIRST
 * in every screen test file (`import { ... } from './harness'`) so its
 * jest.mock boundary registrations are active before the screen under test
 * is loaded.
 *
 * Mock policy (same as jest.setup.js and the pre-existing suites): only
 * boundaries are mocked —
 *   - the network boundary (global.fetch) with the REAL superjson tRPC
 *     envelope shape `{result:{data:{json:<payload>}}}` (W9-B4 pattern,
 *     matching server/_core/trpc.ts:12);
 *   - the offline-sync React boundary (useOfflineSync) backed by a real
 *     in-memory Map with the production method signatures;
 *   - the auth-store React boundary (useAuth) with a real-value object.
 * The component under test, memberTrpc/config transport (including the
 * W9-B6 domain allowlist), and all state logic are production code.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TOKEN_KEY, REFRESH_KEY, EXPIRES_KEY } from '../src/services/keycloakAuth';

/** In-memory offline cache behind the useOfflineSync boundary mock. */
export const mockCacheStore = new Map<string, any>();

/** Real-value offline-sync boundary: same shape the production provider
 *  exposes (state/enqueue/syncNow/clearQueue/getCachedData/setCachedData). */
export const mockOfflineSync = {
  state: { isOnline: true, isSyncing: false, pendingCount: 0, lastSyncAt: null, syncErrors: [], bandwidthMode: 'full' as const },
  enqueue: jest.fn(async () => {}),
  syncNow: jest.fn(async () => {}),
  clearQueue: jest.fn(async () => {}),
  getCachedData: async (key: string): Promise<any> => mockCacheStore.get(key) ?? null,
  setCachedData: async (key: string, data: any) => { mockCacheStore.set(key, data); },
};

jest.mock('../src/services/offlineSync', () => ({
  useOfflineSync: () => mockOfflineSync,
}));

/** Real-value auth boundary; suites mutate fields per-test. */
export const mockAuth = {
  user: {
    id: '42', email: 'ada@example.ng', firstName: 'Ada', lastName: 'Obi',
    phone: '', role: 'customer' as const, kycVerified: true,
  },
  token: 'test-kc-token',
  isLoading: false,
  isAuthenticated: true,
  biometricEnabled: false,
  biometricType: null as null,
  login: jest.fn(async () => {}),
  loginWithBiometric: jest.fn(async () => {}),
  logout: jest.fn(async () => {}),
  enableBiometric: jest.fn(async () => true),
  disableBiometric: jest.fn(async () => {}),
  refreshProfile: jest.fn(async () => {}),
};

jest.mock('../src/store/authStore', () => ({
  useAuth: () => mockAuth,
}));

/** Seed a valid Keycloak session so memberTrpc's getValidAccessToken
 *  succeeds against the real in-memory AsyncStorage mock. */
export async function seedSession(): Promise<void> {
  await AsyncStorage.multiSet([
    [TOKEN_KEY, 'test-kc-token'],
    [REFRESH_KEY, 'rt'],
    [EXPIRES_KEY, String(Date.now() + 3600_000)],
  ]);
}

/**
 * Network boundary mock with the REAL superjson envelope
 * (`{result:{data:{json:<payload>}}}`). Handlers keyed by URL substring;
 * returning an Error produces a 500 with the tRPC error shape.
 */
export function mockFetchSequence(handlers: Record<string, (url: string) => any>): jest.Mock {
  const fn = jest.fn(async (url: string) => {
    for (const [needle, handler] of Object.entries(handlers)) {
      if (String(url).includes(needle)) {
        const body = handler(String(url));
        if (body instanceof Error) {
          return { ok: false, status: 500, json: async () => ({ error: { message: body.message } }) };
        }
        return { ok: true, status: 200, json: async () => ({ result: { data: { json: body } } }) };
      }
    }
    return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) };
  });
  (global as any).fetch = fn;
  return fn;
}

/** Render a screen inside a fresh react-query client (no retries — tests
 *  assert the honest error state, not the retry schedule). */
export function renderScreen(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Standard per-suite reset; call from beforeEach. */
export async function resetHarness(): Promise<void> {
  mockCacheStore.clear();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await seedSession();
}

export const mockNavigation = { navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() };
