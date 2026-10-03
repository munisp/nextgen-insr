/**
 * keycloakAuth.test.ts — 2026-10-01 (W9-B3)
 * Tests for the real OIDC auth flow logic. Only native-module boundaries
 * (react-native-app-auth bridge, AsyncStorage device store) are mocked —
 * see jest.setup.js. Token storage, expiry math, refresh decisions and
 * fail-closed behavior are the real production code under test.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authorize, refresh as oidcRefresh, revoke } from 'react-native-app-auth';
import {
  TOKEN_KEY, REFRESH_KEY, EXPIRES_KEY,
  buildOidcConfig, computeExpiry, shouldRefresh,
  signIn, signOut, getValidAccessToken, refreshAccessToken, clearTokens,
} from '../src/services/keycloakAuth';

const mockAuthorize = authorize as jest.Mock;
const mockRefresh = oidcRefresh as jest.Mock;
const mockRevoke = revoke as jest.Mock;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('buildOidcConfig', () => {
  it('builds an authorization-code + PKCE config with offline_access', () => {
    // 2026-10-03 (W9-B6): honest-contract rewrite — buildOidcConfig now
    // enforces the PINNED_DOMAINS domain allowlist fail-closed, so a custom
    // issuer MUST be an allowlisted host (auth.example.com is correctly
    // rejected now; that rejection is pinned by the test below).
    const cfg = buildOidcConfig('https://auth.insureportal.ng/realms/x', 'client-1', 'app://cb');
    expect(cfg).toEqual({
      issuer: 'https://auth.insureportal.ng/realms/x',
      clientId: 'client-1',
      redirectUrl: 'app://cb',
      scopes: ['openid', 'profile', 'email', 'offline_access'],
    });
  });

  it('refuses a non-allowlisted issuer host (W9-B6 domain allowlist, fail-closed)', () => {
    expect(() => buildOidcConfig('https://auth.example.com/realms/x', 'c', 'app://cb'))
      .toThrow(/domainAllowlist.*BLOCKED/);
    expect(() => buildOidcConfig('https://auth.insureportal.ng.evil.com/realms/x', 'c', 'app://cb'))
      .toThrow(/BLOCKED/);
  });
});

describe('expiry math (pure)', () => {
  it('computeExpiry converts expiresIn seconds to an absolute ms timestamp', () => {
    expect(computeExpiry(3600, 1_000_000)).toBe(1_000_000 + 3_600_000);
  });
  it('shouldRefresh refreshes inside the skew window', () => {
    const now = Date.now();
    expect(shouldRefresh(now + 30_000, now)).toBe(true); // < 60s skew
    expect(shouldRefresh(now + 120_000, now)).toBe(false);
    expect(shouldRefresh(now - 1, now)).toBe(true); // expired
    expect(shouldRefresh(null, now)).toBe(true); // unknown → refresh
  });
});

describe('signIn', () => {
  it('stores access/refresh tokens and expiry from the authorize result', async () => {
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    mockAuthorize.mockResolvedValue({
      accessToken: 'at-1', refreshToken: 'rt-1', idToken: 'id-1',
      accessTokenExpirationDate: expiresAt,
    });
    await signIn();
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: expect.arrayContaining(['openid', 'offline_access']) }),
    );
    expect(await AsyncStorage.getItem(TOKEN_KEY)).toBe('at-1');
    expect(await AsyncStorage.getItem(REFRESH_KEY)).toBe('rt-1');
    expect(Number(await AsyncStorage.getItem(EXPIRES_KEY))).toBe(new Date(expiresAt).getTime());
  });

  it('propagates IdP/user-cancel errors honestly (no swallow, no storage)', async () => {
    mockAuthorize.mockRejectedValue(new Error('User cancelled flow'));
    await expect(signIn()).rejects.toThrow('cancelled');
    expect(await AsyncStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});

describe('getValidAccessToken', () => {
  it('returns the stored token when it is fresh (no refresh call)', async () => {
    await AsyncStorage.multiSet([
      [TOKEN_KEY, 'fresh-at'],
      [REFRESH_KEY, 'rt'],
      [EXPIRES_KEY, String(Date.now() + 3600_000)],
    ]);
    const token = await getValidAccessToken();
    expect(token).toBe('fresh-at');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('refreshes when the token is inside the skew window', async () => {
    await AsyncStorage.multiSet([
      [TOKEN_KEY, 'stale-at'],
      [REFRESH_KEY, 'rt'],
      [EXPIRES_KEY, String(Date.now() + 10_000)],
    ]);
    mockRefresh.mockResolvedValue({
      accessToken: 'new-at', refreshToken: 'new-rt',
      accessTokenExpirationDate: new Date(Date.now() + 3600_000).toISOString(),
    });
    const token = await getValidAccessToken();
    expect(token).toBe('new-at');
    expect(mockRefresh).toHaveBeenCalledWith(expect.anything(), { refreshToken: 'rt' });
    expect(await AsyncStorage.getItem(TOKEN_KEY)).toBe('new-at');
    expect(await AsyncStorage.getItem(REFRESH_KEY)).toBe('new-rt');
  });
});

describe('refreshAccessToken — fail-closed', () => {
  it('throws and clears tokens when no refresh token exists', async () => {
    await AsyncStorage.setItem(TOKEN_KEY, 'orphan-at');
    await expect(refreshAccessToken()).rejects.toThrow('No refresh token');
    expect(await AsyncStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('clears ALL tokens when the realm rejects the refresh token', async () => {
    await AsyncStorage.multiSet([[TOKEN_KEY, 'at'], [REFRESH_KEY, 'rt'], [EXPIRES_KEY, '1']]);
    mockRefresh.mockRejectedValue(new Error('invalid_grant'));
    await expect(refreshAccessToken()).rejects.toThrow('Session expired');
    expect(await AsyncStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(REFRESH_KEY)).toBeNull();
  });
});

describe('signOut', () => {
  it('revokes at the realm and clears local tokens', async () => {
    await AsyncStorage.multiSet([[TOKEN_KEY, 'at'], [REFRESH_KEY, 'rt']]);
    mockRevoke.mockResolvedValue(undefined);
    await signOut();
    expect(mockRevoke).toHaveBeenCalledWith(expect.anything(), { tokenToRevoke: 'at', sendClientId: true });
    expect(await AsyncStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(REFRESH_KEY)).toBeNull();
  });

  it('still clears local tokens when revocation fails (best-effort revoke)', async () => {
    await AsyncStorage.multiSet([[TOKEN_KEY, 'at'], [REFRESH_KEY, 'rt']]);
    mockRevoke.mockRejectedValue(new Error('network down'));
    await signOut();
    expect(await AsyncStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});

describe('clearTokens', () => {
  it('removes every auth key', async () => {
    await AsyncStorage.multiSet([[TOKEN_KEY, 'a'], [REFRESH_KEY, 'b'], [EXPIRES_KEY, '1']]);
    await clearTokens();
    expect(await AsyncStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(REFRESH_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(EXPIRES_KEY)).toBeNull();
  });
});
