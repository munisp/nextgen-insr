/**
 * memberRewire.test.ts — 2026-10-03 (W9-B4)
 * Coverage for the W9-B4 rewire of the mobile data layer onto the hardened
 * member* tRPC routers (server/routers/member*.ts). Mocks are at the
 * transport boundary only (global fetch = the network; AsyncStorage is the
 * real in-memory jest mock). Asserts:
 *   - the correct member* procedure is called with the correct input,
 *   - Bearer comes from the Keycloak token store,
 *   - payments never send an amount and use STABLE per-intent idempotency keys,
 *   - UNAUTHORIZED → one Keycloak refresh → one retry; refresh failure is
 *     fail-closed (tokens cleared, error propagates),
 *   - error paths propagate (no fabricated data).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { refresh as oidcRefresh } from 'react-native-app-auth';
// 2026-10-03 (W9-B4 round 2): real superjson — the mock envelope must be
// byte-for-byte what the monolith's `transformer: superjson`
// (server/_core/trpc.ts:12) emits over the wire.
import superjson from 'superjson';
import { policyApi, claimsApi, premiumApi } from '../src/services/api';
import { TOKEN_KEY, REFRESH_KEY, EXPIRES_KEY } from '../src/services/keycloakAuth';

const mockRefresh = oidcRefresh as jest.Mock;

function mockFetchOnce(payload: any, ok = true, status = 200) {
  (global as any).fetch = jest.fn().mockResolvedValue({
    ok, status,
    json: async () => payload,
  });
  return (global as any).fetch as jest.Mock;
}

/**
 * 2026-10-03 (W9-B4 round 2): honest-contract rewrite. The pre-round-2
 * helper returned `{result:{data}}` — an envelope shape the real server
 * NEVER produces. With `transformer: superjson`, a tRPC v10 success
 * response is `{result:{data:{json:<payload>, meta?}}}`. Mock with the real
 * serializer so these tests certify the actual wire contract.
 */
function trpcResult(data: any) {
  return { result: { data: superjson.serialize(data) } };
}

async function seedSession() {
  await AsyncStorage.multiSet([
    [TOKEN_KEY, 'kc-at'],
    [REFRESH_KEY, 'rt'],
    [EXPIRES_KEY, String(Date.now() + 3600_000)],
  ]);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

afterEach(() => {
  delete (global as any).fetch;
});

describe('policyApi — memberPolicies rewire', () => {
  it('list calls memberPolicies.myPolicies and maps real fields (no invented fields)', async () => {
    await seedSession();
    const fetchSpy = mockFetchOnce(trpcResult({
      policies: [{
        id: 7, policyNumber: 'POL-7', status: 'active', coverageType: 'motor',
        sumInsured: '5000000', annualPremium: '120000', startDate: '2026-01-01',
        endDate: '2027-01-01', renewalDate: '2027-01-01', productId: 3,
        productName: 'Motor Comprehensive', currency: 'NGN',
      }],
      count: 1,
    }));
    const res = await policyApi.list();
    const [url, init] = fetchSpy.mock.calls[0] as any;
    expect(String(url)).toContain('/api/trpc/memberPolicies.myPolicies');
    expect(init.headers.Authorization).toBe('Bearer kc-at');
    const row = res.data.policies[0];
    expect(row).toMatchObject({
      id: 7, policyNumber: 'POL-7', status: 'active', type: 'motor',
      provider: 'Motor Comprehensive', premiumAmount: 120000,
      coverageAmount: 5000000, currency: 'NGN',
    });
    expect(res.data.count).toBe(1);
  });

  it('getById calls memberPolicies.myPolicy with a numeric id', async () => {
    await seedSession();
    const fetchSpy = mockFetchOnce(trpcResult({
      id: 9, policyNumber: 'POL-9', status: 'bound', coverageType: 'health',
      sumInsured: '1000000', annualPremium: '45000', startDate: null,
      endDate: null, productId: 4, productName: 'HMO Basic', currency: 'NGN',
    }));
    const res = await policyApi.getById('9');
    const [url] = fetchSpy.mock.calls[0] as any;
    expect(String(url)).toContain('/api/trpc/memberPolicies.myPolicy');
    expect(decodeURIComponent(String(url))).toContain('"id":9');
    expect(res.data.premiumAmount).toBe(45000);
  });

  it('getById propagates a server NOT_FOUND (no fabricated policy)', async () => {
    await seedSession();
    mockFetchOnce({ error: { message: 'Policy not found' } }, false, 404);
    await expect(policyApi.getById('42')).rejects.toThrow('Policy not found');
  });

  it('renew calls the REAL memberRenewals.requestRenewal mutation', async () => {
    await seedSession();
    const fetchSpy = mockFetchOnce(trpcResult({ id: 11, status: 'pending' }));
    await policyApi.renew('7');
    const [url, init] = fetchSpy.mock.calls[0] as any;
    expect(String(url)).toContain('/api/trpc/memberRenewals.requestRenewal');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).json).toEqual({ policyId: 7 });
  });
});

describe('premiumApi — memberPayments rewire (funds, fail-closed)', () => {
  it('due calls memberPayments.myPremiumDue', async () => {
    await seedSession();
    const fetchSpy = mockFetchOnce(trpcResult({ duePremiums: [], policies: [], disclosure: 'd' }));
    const res = await premiumApi.due();
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/trpc/memberPayments.myPremiumDue');
    expect(res.duePremiums).toEqual([]);
  });

  it('initiate sends NO amount and a stable per-intent idempotency key', async () => {
    await seedSession();
    const initiated = {
      reference: 'PP-POL-1-k', authorizationUrl: 'https://paystack.test/x',
      amount: '120000', currency: 'NGN', paymentId: 5, idempotent: false,
    };
    const fetchSpy = mockFetchOnce(trpcResult(initiated));
    const r1 = await premiumApi.initiate(1, 100);
    expect(r1.reference).toBe('PP-POL-1-k');
    const body1 = JSON.parse(fetchSpy.mock.calls[0][1].body).json;
    expect(body1.policyId).toBe(1);
    expect(body1.premiumId).toBe(100);
    expect(body1).not.toHaveProperty('amount'); // server-derived only
    expect(typeof body1.idempotencyKey).toBe('string');
    expect(body1.idempotencyKey.length).toBeGreaterThanOrEqual(8);

    // Retry of the SAME intent reuses the SAME key (crash-safe replay).
    mockFetchOnce(trpcResult({ ...initiated, idempotent: true }));
    await premiumApi.initiate(1, 100);
    const body2 = JSON.parse((global as any).fetch.mock.calls[0][1].body).json;
    expect(body2.idempotencyKey).toBe(body1.idempotencyKey);

    // A DIFFERENT due row is a different intent → different key.
    mockFetchOnce(trpcResult(initiated));
    await premiumApi.initiate(1, 101);
    const body3 = JSON.parse((global as any).fetch.mock.calls[0][1].body).json;
    expect(body3.idempotencyKey).not.toBe(body1.idempotencyKey);
  });

  it('verify calls memberPayments.verifyPremiumPayment; success retires the intent key', async () => {
    await seedSession();
    // establish a key for intent (1,100)
    mockFetchOnce(trpcResult({
      reference: 'PP-POL-1-k', authorizationUrl: null, amount: '10',
      currency: 'NGN', paymentId: 5, idempotent: false,
    }));
    await premiumApi.initiate(1, 100);
    const keyBefore = JSON.parse((global as any).fetch.mock.calls[0][1].body).json.idempotencyKey;

    const fetchSpy = mockFetchOnce(trpcResult({
      reference: 'PP-POL-1-k', status: 'success', amount: '10',
      currency: 'NGN', paymentId: 5, idempotent: false,
    }));
    const res = await premiumApi.verify('PP-POL-1-k', 1, 100);
    expect(res.status).toBe('success');
    const [url, init] = fetchSpy.mock.calls[0] as any;
    expect(String(url)).toContain('/api/trpc/memberPayments.verifyPremiumPayment');
    expect(JSON.parse(init.body).json).toEqual({ reference: 'PP-POL-1-k' });

    // success retired the key — a new initiation mints a fresh key
    mockFetchOnce(trpcResult({
      reference: 'PP-POL-1-k2', authorizationUrl: null, amount: '10',
      currency: 'NGN', paymentId: 6, idempotent: false,
    }));
    await premiumApi.initiate(1, 100);
    const keyAfter = JSON.parse((global as any).fetch.mock.calls[0][1].body).json.idempotencyKey;
    expect(keyAfter).not.toBe(keyBefore);
  });

  it('verify surfaces an honest non-success status (no fake paid state)', async () => {
    await seedSession();
    mockFetchOnce(trpcResult({
      reference: 'PP-POL-1-k', status: 'pending', amount: '10',
      currency: 'NGN', paymentId: 5, idempotent: false,
    }));
    const res = await premiumApi.verify('PP-POL-1-k', 1, 100);
    expect(res.status).toBe('pending');
  });

  it('initiate propagates PRECONDITION_FAILED when the gateway is not configured', async () => {
    await seedSession();
    mockFetchOnce({ error: { message: 'Payment gateway is not configured on this deployment' } }, false, 400);
    await expect(premiumApi.initiate(1, 100)).rejects.toThrow('not configured');
  });
});

describe('memberTrpc — auth semantics', () => {
  it('fails closed when there is no session (request never sent)', async () => {
    const fetchSpy = jest.fn();
    (global as any).fetch = fetchSpy;
    await expect(policyApi.list()).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('on UNAUTHORIZED refreshes via Keycloak and retries once', async () => {
    await seedSession();
    mockRefresh.mockResolvedValue({
      accessToken: 'rotated-at', refreshToken: 'rotated-rt',
      accessTokenExpirationDate: new Date(Date.now() + 3600_000).toISOString(),
    });
    const fetchSpy = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: { message: 'UNAUTHORIZED' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => trpcResult({ policies: [], count: 0 }) });
    (global as any).fetch = fetchSpy;
    const res = await policyApi.list();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect((fetchSpy.mock.calls[1] as any)[1].headers.Authorization).toBe('Bearer rotated-at');
    expect(res.data.policies).toEqual([]);
  });

  it('refresh failure clears tokens and rejects (honest logout)', async () => {
    await seedSession();
    mockRefresh.mockRejectedValue(new Error('invalid_grant'));
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false, status: 401, json: async () => ({ error: { message: 'UNAUTHORIZED' } }),
    });
    await expect(policyApi.list()).rejects.toThrow();
    expect(await AsyncStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(REFRESH_KEY)).toBeNull();
  });
});

describe('claimsApi — memberClaims (unchanged contract, memberTrpc transport)', () => {
  it('getById calls memberClaims.myClaim with a numeric id', async () => {
    await seedSession();
    const fetchSpy = mockFetchOnce(trpcResult({ id: 3, claimType: 'Motor Accident' }));
    const res = await claimsApi.getById(3);
    const [url] = fetchSpy.mock.calls[0] as any;
    expect(String(url)).toContain('/api/trpc/memberClaims.myClaim');
    expect(decodeURIComponent(String(url))).toContain('"id":3');
    expect(res.data.claimType).toBe('Motor Accident');
  });

  // 2026-10-03 (W9-B4 round 2): regression — myClaims returns
  // `{claims, count}` (server/routers/memberClaims.ts:111), not a bare
  // array. Pre-round-2 `Array.isArray(rows) ? rows : []` silently emptied
  // the claims list; the old mock used a fabricated bare array so the bug
  // was invisible. This test mocks the REAL shape and would have caught it.
  it('list maps the real {claims, count} shape (not a fabricated array)', async () => {
    await seedSession();
    mockFetchOnce(trpcResult({ claims: [{ id: 1, claimNumber: 'CLM-1' }], count: 1 }));
    const res = await claimsApi.list();
    expect(res.data.claims).toEqual([{ id: 1, claimNumber: 'CLM-1' }]);
  });
});

describe('superjson envelope unwrap — regression for the round-1 envelope bug', () => {
  // 2026-10-03 (W9-B4 round 2): regression tests that would have caught the
  // pre-round-2 defect where trpcQuery/trpcMutation returned `result.data`
  // (the `{json, meta}` envelope) instead of the payload. With the old code
  // both tests fail: `res.data.policies` would be undefined and the claim
  // count shape would never be reached.
  it('trpcQuery unwraps {result:{data:{json, meta}}} to the payload', async () => {
    await seedSession();
    mockFetchOnce(trpcResult({ policies: [{ id: 1, policyNumber: 'P-1' }], count: 1 }));
    const res = await policyApi.list();
    expect(res.data.count).toBe(1);
    expect(res.data.policies[0].policyNumber).toBe('P-1');
  });

  it('superjson meta types are restored like the web client (Date round-trip)', async () => {
    await seedSession();
    // Dates inside a payload get a superjson `meta` entry on the wire; the
    // web client (@trpc/client + superjson) restores them as Date objects.
    // Mobile must replicate that contract.
    mockFetchOnce(trpcResult({ duePremiums: [], policies: [], disclosure: 'd', asOf: new Date('2026-10-03T00:00:00.000Z') }));
    const res = await premiumApi.due() as any;
    expect(res.asOf).toBeInstanceOf(Date);
    expect((res.asOf as Date).toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });
});
