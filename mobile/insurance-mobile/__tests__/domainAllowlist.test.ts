/**
 * domainAllowlist.test.ts — 2026-10-03 (W9-B6)
 * Tests for the PINNED_DOMAINS JS-layer enforcement (src/services/domainAllowlist.ts).
 * The fetch mock here is the network BOUNDARY: the assertion is that a
 * blocked request never reaches it (no network I/O), and an allowed one does.
 *
 * Scope honesty: this suite pins DOMAIN ALLOWLISTING behavior only. True TLS
 * certificate pinning is a native-layer residual (see domainAllowlist.ts
 * header + BUILD.md) and is NOT claimed here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ALLOWED_DOMAINS,
  assertAxiosConfigAllowed,
  assertUrlAllowed,
  guardedFetch,
  hostOf,
  isAllowedHost,
} from '../src/services/domainAllowlist';
import { api } from '../src/services/api';
import { TOKEN_KEY, REFRESH_KEY, EXPIRES_KEY } from '../src/services/keycloakAuth';

const mockNetFetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));

beforeEach(() => {
  mockNetFetch.mockClear();
  (global as any).fetch = mockNetFetch;
});

afterEach(() => {
  delete (global as any).fetch;
});

describe('hostOf / isAllowedHost', () => {
  it('parses the real destination host, ignoring ports and userinfo tricks', () => {
    expect(hostOf('https://api.insureportal.ng:443/v1/x')).toBe('api.insureportal.ng');
    expect(hostOf('https://user@api.insureportal.ng.evil.com/x')).toBe('api.insureportal.ng.evil.com');
    expect(hostOf('not a url')).toBeNull();
    expect(hostOf('/relative/path')).toBeNull();
  });

  it('allows exactly the allowlisted production hosts', () => {
    for (const d of ALLOWED_DOMAINS) {
      expect(isAllowedHost(d)).toBe(true);
      expect(isAllowedHost(d.toUpperCase())).toBe(true);
    }
  });

  it('allows loopback/emulator hosts only under __DEV__ (jest runs __DEV__)', () => {
    expect(isAllowedHost('127.0.0.1')).toBe(true);
    expect(isAllowedHost('10.0.2.2')).toBe(true);
    expect(isAllowedHost('localhost')).toBe(true);
  });
});

describe('assertUrlAllowed — fail-closed blocking', () => {
  it('rejects non-allowlisted hosts with a loud error', () => {
    expect(() => assertUrlAllowed('https://evil.com/steal')).toThrow(/domainAllowlist.*BLOCKED/);
    expect(() => assertUrlAllowed('https://payments.attacker.ng/')).toThrow(/non-allowlisted host/);
  });

  it('rejects subdomain-spoof attempts — exact host match only', () => {
    // Suffix spoof: allowlisted host as a subdomain of an attacker domain.
    expect(() => assertUrlAllowed('https://api.insureportal.ng.evil.com/')).toThrow(/BLOCKED/);
    expect(() => assertUrlAllowed('https://allowed.com.evil.com/')).toThrow(/BLOCKED/);
    // Prefix spoof: attacker host merely CONTAINING an allowlisted name.
    expect(() => assertUrlAllowed('https://evil-api.insureportal.ng/')).toThrow(/BLOCKED/);
    expect(() => assertUrlAllowed('https://evil-allowed.com/')).toThrow(/BLOCKED/);
    expect(() => assertUrlAllowed('https://staging.54link.ng.attacker.example/')).toThrow(/BLOCKED/);
    // Even legitimate-looking subdomains of allowlisted hosts are blocked
    // (exact match): fail-closed beats convenience.
    expect(() => assertUrlAllowed('https://www.api.insureportal.ng/')).toThrow(/BLOCKED/);
  });

  it('rejects unparseable / relative URLs', () => {
    expect(() => assertUrlAllowed('not-a-url')).toThrow(/BLOCKED/);
    expect(() => assertUrlAllowed('')).toThrow(/BLOCKED/);
  });

  it('accepts allowlisted hosts (https and any path)', () => {
    expect(() => assertUrlAllowed('https://api.insureportal.ng/api/trpc/x')).not.toThrow();
    expect(() => assertUrlAllowed('https://auth.insureportal.ng/realms/insureportal')).not.toThrow();
  });
});

// 2026-10-03 (W9-B6 round 2): regression tests for the protocol-relative
// fail-open. axios isAbsoluteURL('//evil.com/x') is TRUE, so axios discards
// baseURL and dials evil.com — the round-1 guard parsed baseURL+url instead
// and wrongly PASSED. The guard must resolve the effective host exactly the
// way axios will, and reject BEFORE the auth interceptor attaches a token.
describe('assertAxiosConfigAllowed — axios URL-resolution parity (2026-10-03 r2)', () => {
  const BASE = 'https://api.insureportal.ng';

  it('rejects protocol-relative URLs even though baseURL is allowlisted', () => {
    expect(() => assertAxiosConfigAllowed({ baseURL: BASE, url: '//evil.com/x' })).toThrow(/BLOCKED/);
    expect(() => assertAxiosConfigAllowed({ baseURL: BASE, url: '//api.insureportal.ng.evil.com/x' })).toThrow(/BLOCKED/);
  });

  it('rejects absolute URLs to non-allowlisted hosts (baseURL discarded by axios)', () => {
    expect(() => assertAxiosConfigAllowed({ baseURL: BASE, url: 'https://evil.com/x' })).toThrow(/BLOCKED/);
    expect(() => assertAxiosConfigAllowed({ baseURL: BASE, url: 'HTTP://api.insureportal.ng.evil.com/x' })).toThrow(/BLOCKED/);
  });

  it('allows a legitimate relative path resolved against an allowlisted baseURL', () => {
    expect(() => assertAxiosConfigAllowed({ baseURL: BASE, url: '/api/v1/policies' })).not.toThrow();
    expect(() => assertAxiosConfigAllowed({ baseURL: BASE, url: undefined })).not.toThrow();
  });

  it('is fail-closed for unparseable effective URLs', () => {
    expect(() => assertAxiosConfigAllowed({ baseURL: undefined, url: undefined })).toThrow(/BLOCKED/);
    expect(() => assertAxiosConfigAllowed({ baseURL: 'not a url', url: '/x' })).toThrow(/BLOCKED/);
    // Protocol-relative to an ALLOWLISTED host is fine (axios would dial it).
    expect(() => assertAxiosConfigAllowed({ baseURL: BASE, url: '//api.insureportal.ng/x' })).not.toThrow();
  });

  it('api.get("//evil.com/x") is rejected BEFORE the adapter and no token is attached', async () => {
    await AsyncStorage.multiSet([
      [TOKEN_KEY, 'secret-token-123'],
      [REFRESH_KEY, 'rt'],
      [EXPIRES_KEY, String(Date.now() + 3600_000)],
    ]);
    const adapter = jest.fn((config: any) =>
      Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config }));
    (api.defaults as any).adapter = adapter;
    await expect(api.get('//evil.com/x')).rejects.toThrow(/domainAllowlist.*BLOCKED/);
    expect(adapter).not.toHaveBeenCalled(); // request never dispatched
    await AsyncStorage.clear();
  });

  it('api.get("//api.insureportal.ng.evil.com/x") is rejected — suffix spoof via //', async () => {
    const adapter = jest.fn((config: any) =>
      Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config }));
    (api.defaults as any).adapter = adapter;
    await expect(api.get('//api.insureportal.ng.evil.com/x')).rejects.toThrow(/BLOCKED/);
    expect(adapter).not.toHaveBeenCalled();
  });
});

// guardedFetch has NO equivalent hole: it takes a single absolute URL string
// and checks exactly that string — `//evil.com/x` is unparseable by WHATWG
// URL, so hostOf returns null and the request is rejected (fail-closed).
// Pinned here so the parity argument is tested, not just asserted.
describe('guardedFetch — no protocol-relative hole (2026-10-03 r2)', () => {
  it('rejects protocol-relative and relative URLs before any network I/O', async () => {
    await expect(guardedFetch('//evil.com/x' as any)).rejects.toThrow(/BLOCKED/);
    await expect(guardedFetch('//api.insureportal.ng.evil.com/x' as any)).rejects.toThrow(/BLOCKED/);
    await expect(guardedFetch('/relative/path' as any)).rejects.toThrow(/BLOCKED/);
    expect(mockNetFetch).not.toHaveBeenCalled();
  });
});

describe('guardedFetch — transport enforcement', () => {
  it('lets a request to an allowlisted host proceed to the network', async () => {
    const res = await guardedFetch('https://api.insureportal.ng/health');
    expect(mockNetFetch).toHaveBeenCalledTimes(1);
    expect(mockNetFetch).toHaveBeenCalledWith('https://api.insureportal.ng/health', undefined);
    expect((res as any).ok).toBe(true);
  });

  it('BLOCKS a non-allowlisted host BEFORE any network I/O — fetch is never called', async () => {
    await expect(guardedFetch('https://evil.com/exfil')).rejects.toThrow(/BLOCKED/);
    expect(mockNetFetch).not.toHaveBeenCalled();
  });

  it('BLOCKS subdomain spoofs before any network I/O', async () => {
    await expect(guardedFetch('https://api.insureportal.ng.evil.com/')).rejects.toThrow(/BLOCKED/);
    await expect(guardedFetch('https://evil-allowed.com/')).rejects.toThrow(/BLOCKED/);
    expect(mockNetFetch).not.toHaveBeenCalled();
  });
});
