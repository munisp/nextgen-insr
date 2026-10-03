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
import { render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DigitalWalletScreen } from '../src/screens/DigitalWalletScreen';

// Auth boundary: a signed-in session with a real token string.
jest.mock('../src/store/authStore', () => ({
  useAuth: () => ({ token: 'test-kc-token' }),
}));

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
        return { ok: true, status: 200, json: async () => ({ result: { data: body } }) };
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

beforeEach(() => {
  mockCacheStore.clear();
  jest.clearAllMocks();
});

afterEach(() => {
  delete (global as any).fetch;
});

describe('DigitalWalletScreen balance states', () => {
  it('shows a loading state while the balance query is in flight', async () => {
    let resolveFetch: any;
    (global as any).fetch = jest.fn(() => new Promise((r) => { resolveFetch = r; }));
    renderScreen();
    expect(await screen.findByTestId('wallet-loading')).toBeTruthy();
    resolveFetch({ ok: true, json: async () => ({ result: { data: { balance: 500, currency: 'NGN' } } }) });
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
