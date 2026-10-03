/**
 * api.test.ts — 2026-10-01 (W9-B3)
 * Tests for the axios interceptor behavior: Bearer attachment, 401 →
 * Keycloak refresh → retry, and fail-closed session teardown. Mocks are at
 * the transport boundary only (axios adapter = the network) and the OIDC
 * native bridge (jest.setup.js).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { refresh as oidcRefresh } from 'react-native-app-auth';
import { api, claimsApi, policyApi, premiumApi } from '../src/services/api';
import { TOKEN_KEY, REFRESH_KEY, EXPIRES_KEY } from '../src/services/keycloakAuth';

const mockRefresh = oidcRefresh as jest.Mock;

/** Install a fake axios adapter (the network boundary) per test. */
function withAdapter(fn: jest.Mock) {
  (api.defaults as any).adapter = fn;
  return fn;
}

function ok(data: any) {
  return (config: any) => Promise.resolve({
    data, status: 200, statusText: 'OK', headers: {}, config,
  });
}

function unauthorizedThenOk(spy: jest.Mock, data: any) {
  return async (config: any) => {
    spy(config);
    if (spy.mock.calls.length === 1) {
      const err: any = new Error('Request failed with status code 401');
      err.config = config;
      err.response = { status: 401, data: {}, headers: {}, config };
      err.isAxiosError = true;
      throw err;
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('request interceptor — Bearer attachment', () => {
  it('attaches the stored Keycloak access token', async () => {
    await AsyncStorage.multiSet([
      [TOKEN_KEY, 'kc-at'],
      [REFRESH_KEY, 'rt'],
      [EXPIRES_KEY, String(Date.now() + 3600_000)],
    ]);
    const seen: any[] = [];
    withAdapter(jest.fn((config: any) => { seen.push(config); return ok({ ok: true })(config); }));
    await api.get('/api/v1/policies');
    expect(seen[0].headers.Authorization).toBe('Bearer kc-at');
  });

  it('sends no Authorization header when signed out (no fabricated token)', async () => {
    const seen: any[] = [];
    withAdapter(jest.fn((config: any) => { seen.push(config); return ok({ ok: true })(config); }));
    await api.get('/api/v1/policies');
    expect(seen[0].headers.Authorization).toBeUndefined();
  });
});

describe('response interceptor — 401 refresh retry', () => {
  it('on 401 refreshes via Keycloak token endpoint and retries once', async () => {
    await AsyncStorage.multiSet([
      [TOKEN_KEY, 'expired-at'],
      [REFRESH_KEY, 'rt'],
      [EXPIRES_KEY, String(Date.now() + 3600_000)], // fresh-looking, server disagrees
    ]);
    mockRefresh.mockResolvedValue({
      accessToken: 'rotated-at', refreshToken: 'rotated-rt',
      accessTokenExpirationDate: new Date(Date.now() + 3600_000).toISOString(),
    });
    const spy = jest.fn();
    withAdapter(jest.fn(unauthorizedThenOk(spy, { policies: [] })));
    const res = await api.get('/api/v1/policies');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][0].headers.Authorization).toBe('Bearer rotated-at');
    expect(res.data).toEqual({ policies: [] });
    // rotated tokens persisted
    expect(await AsyncStorage.getItem(TOKEN_KEY)).toBe('rotated-at');
    expect(await AsyncStorage.getItem(REFRESH_KEY)).toBe('rotated-rt');
  });

  it('clears tokens and rejects when refresh is rejected (fail-closed)', async () => {
    await AsyncStorage.multiSet([
      [TOKEN_KEY, 'expired-at'], [REFRESH_KEY, 'rt'], [EXPIRES_KEY, String(Date.now() + 3600_000)],
    ]);
    mockRefresh.mockRejectedValue(new Error('invalid_grant'));
    const spy = jest.fn();
    withAdapter(jest.fn(unauthorizedThenOk(spy, {})));
    await expect(api.get('/api/v1/policies')).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(1); // no retry with a dead session
    expect(await AsyncStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(REFRESH_KEY)).toBeNull();
  });
});

describe('honest unavailable APIs (no fabricated success)', () => {
  it('premiumApi.pay throws an honest unavailable error', async () => {
    await expect(premiumApi.pay('p1', {})).rejects.toThrow('not available');
  });
  it('policyApi.renew throws an honest unavailable error', async () => {
    await expect(policyApi.renew('p1')).rejects.toThrow('not available');
  });
  it('claimsApi.getTimeline throws an honest unavailable error', async () => {
    await expect(claimsApi.getTimeline('c1')).rejects.toThrow('not available');
  });
});

describe('policyApi.getById — derived from the real list route', () => {
  it('returns the matching policy from /api/v1/policies', async () => {
    withAdapter(jest.fn(ok({ policies: [{ id: 7, type: 'Motor' }, { id: 9, type: 'Health' }] })));
    const res = await policyApi.getById('9');
    expect(res.data).toEqual({ id: 9, type: 'Health' });
  });
  it('throws an honest not-found error instead of fabricating a policy', async () => {
    withAdapter(jest.fn(ok({ policies: [{ id: 7 }] })));
    await expect(policyApi.getById('42')).rejects.toThrow('not found');
  });
});

describe('claimsApi.list — rewired to memberClaims.myClaims (tRPC)', () => {
  it('calls the real tRPC endpoint with the Bearer token', async () => {
    await AsyncStorage.multiSet([
      [TOKEN_KEY, 'kc-at'], [REFRESH_KEY, 'rt'], [EXPIRES_KEY, String(Date.now() + 3600_000)],
    ]);
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { data: [{ id: 1, claimNumber: 'CLM-1' }] } }),
    });
    const fetchSpy = (global as any).fetch as jest.Mock;
    const res = await claimsApi.list();
    expect(res.data.claims).toEqual([{ id: 1, claimNumber: 'CLM-1' }]);
    const [url, init] = fetchSpy.mock.calls[0] as any;
    expect(String(url)).toContain('/api/trpc/memberClaims.myClaims');
    expect(init.headers.Authorization).toBe('Bearer kc-at');
    delete (global as any).fetch;
  });
});
