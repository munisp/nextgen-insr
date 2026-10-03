/**
 * DigitalWalletScreen.test.tsx — 2026-10-01 (W9-B3)
 * Rendering-state tests for the wallet screen. The network boundary (fetch,
 * used by config.ts trpcQuery) is mocked; auth and offline-sync contexts are
 * replaced with minimal real-value providers at the React boundary. The
 * component under test and all state logic are production code.
 *
 * Regression target: the screen previously rendered a FABRICATED
 * `{balance: 0, currency: 'NGN'}` whenever the query failed. These tests pin
 * the honest loading / error / cached / live states.
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DigitalWalletScreen } from '../src/screens/DigitalWalletScreen';
import { TOKEN_KEY, REFRESH_KEY, EXPIRES_KEY } from '../src/services/keycloakAuth';

// 2026-10-03 (W9-B4): honest-contract update — the screen no longer reads a
// token from useAuth(); its calls go through memberTrpc, which resolves the
// Keycloak session from the token store (AsyncStorage, the real in-memory
// jest mock). Tests therefore seed a valid session below instead of mocking
// the auth store. The fetch network boundary mock is unchanged.

// Offline-sync boundary: controllable cache store.
const mockCacheStore = new Map<string, any>();
jest.mock('../src/services/offlineSync', () => ({
  useOfflineSync: () => ({
    getCachedData: async (key: string) => mockCacheStore.get(key) ?? null,
    setCachedData: async (key: string, data: any) => { mockCacheStore.set(key, data); },
  }),
}));

function mockFetchSequence(handlers: Record<string, (url: string) => any>) {
  (global as any).fetch = jest.fn(async (url: string) => {
    for (const [needle, handler] of Object.entries(handlers)) {
      if (String(url).includes(needle)) {
        const body = handler(String(url));
        if (body instanceof Error) return { ok: false, status: 500, json: async () => ({ error: { message: body.message } }) };
        // 2026-10-03 (W9-B4 round 2): honest-contract rewrite — the real
        // server emits the superjson envelope `{result:{data:{json:<payload>}}}`
        // (server/_core/trpc.ts:12). The pre-round-2 mock returned
        // `{result:{data:<payload>}}`, a shape the server never produces,
        // which hid the envelope-unwrap defect from this suite.
        return { ok: true, status: 200, json: async () => ({ result: { data: { json: body } } }) };
      }
    }
    return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) };
  });
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DigitalWalletScreen />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  mockCacheStore.clear();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  // 2026-10-03 (W9-B4): valid Keycloak session for memberTrpc's
  // getValidAccessToken (AsyncStorage is the real in-memory jest mock).
  await AsyncStorage.multiSet([
    [TOKEN_KEY, 'test-kc-token'],
    [REFRESH_KEY, 'rt'],
    [EXPIRES_KEY, String(Date.now() + 3600_000)],
  ]);
});

afterEach(() => {
  delete (global as any).fetch;
});

describe('DigitalWalletScreen balance states', () => {
  it('shows a loading state while the balance query is in flight', async () => {
    // 2026-10-03 (W9-B6): the screen runs TWO queries (balance +
    // transactions) against the same fetch mock — capture every resolver so
    // act() can settle all of them deterministically.
    const resolvers: Array<(v: any) => void> = [];
    (global as any).fetch = jest.fn(() => new Promise((r) => { resolvers.push(r); }));
    renderScreen();
    expect(await screen.findByTestId('wallet-loading')).toBeTruthy();
    // 2026-10-03 (W9-B6): timing-flake fix — previously the fetch promise was
    // resolved AFTER the test's assertions, OUTSIDE act(), so React state
    // updates (query settle + cache write) raced the next test and
    // intermittently failed the suite with "not wrapped in act(...)". The
    // resolution is now wrapped in act() and we await the settled balance
    // render, so the query fully completes INSIDE this test.
    // 2026-10-03 (W9-B4 round 2): real superjson envelope shape.
    await act(async () => {
      for (const resolveFetch of resolvers) {
        resolveFetch({ ok: true, json: async () => ({ result: { data: { json: { balance: 500, currency: 'NGN' } } } }) });
      }
    });
    await waitFor(() => expect(screen.getByTestId('wallet-balance')).toBeTruthy());
  });

  it('shows the REAL server balance when the query succeeds', async () => {
    mockFetchSequence({
      'customerWalletSystem.getBalance': () => ({ balance: 15250.5, currency: 'NGN' }),
      'customerWalletSystem.getTransactions': () => ({ transactions: [], total: 0 }),
    });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('wallet-balance').props.children).toBe('₦15,250.5'));
    expect(screen.queryByTestId('wallet-offline')).toBeNull();
    expect(screen.queryByTestId('wallet-error')).toBeNull();
  });

  it('shows an honest error state when the query fails and NO cache exists — never a fabricated zero', async () => {
    mockFetchSequence({
      'customerWalletSystem.getBalance': () => new Error('Request failed (HTTP 500)'),
      'customerWalletSystem.getTransactions': () => ({ transactions: [], total: 0 }),
    });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('wallet-error')).toBeTruthy());
    // The fabricated "₦0" balance must NOT be rendered as a real balance.
    expect(screen.queryByTestId('wallet-balance')).toBeNull();
    expect(screen.getByText('Balance unavailable')).toBeTruthy();
  });

  it('shows the cached balance clearly labelled as offline/last-known', async () => {
    mockCacheStore.set('wallet', { balance: 3000, currency: 'NGN' });
    mockFetchSequence({
      'customerWalletSystem.getBalance': () => new Error('offline'),
      'customerWalletSystem.getTransactions': () => ({ transactions: [], total: 0 }),
    });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('wallet-balance').props.children).toBe('₦3,000'));
    expect(screen.getByTestId('wallet-offline').props.children).toMatch(/last known balance/i);
  });

  it('shows a transaction error message instead of a fake empty list on failure', async () => {
    mockFetchSequence({
      'customerWalletSystem.getBalance': () => ({ balance: 100, currency: 'NGN' }),
      'customerWalletSystem.getTransactions': () => new Error('boom'),
    });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('wallet-tx-error')).toBeTruthy(), { timeout: 5000 });
    expect(screen.queryByText('No transactions yet')).toBeNull();
  });

  it('renders real transactions when returned by the server', async () => {
    mockFetchSequence({
      'customerWalletSystem.getBalance': () => ({ balance: 100, currency: 'NGN' }),
      'customerWalletSystem.getTransactions': () => ({
        transactions: [{ id: 't1', narration: 'Premium payment', type: 'debit', amount: 4500, createdAt: '2026-09-01' }],
        total: 1,
      }),
    });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Premium payment')).toBeTruthy());
    expect(screen.getByText('-₦4,500')).toBeTruthy();
  });
});
