// 2026-10-02 (W7-B2): regression tests proving the 44 formerly-fabricated
// mutations in server.cjs no longer return fabricated success.
//
//   - Every converted endpoint must answer 501 + { error: "NOT_IMPLEMENTED" }
//     when no real backend is configured (fail-closed).
//   - Endpoints wired to the monolith (familyCoverage.add/remove,
//     policies.renew) must pass through to MONOLITH_URL with the caller's
//     bearer token, relay the real response, and relay upstream rejections
//     verbatim (no fake 200s).
//   - Unauthenticated POSTs must still be 401 (never fabricated success).
//
// Run: node --test tests/w7b2-fabricated-mutations.test.cjs

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const SERVER = path.join(__dirname, '..', 'server.cjs');
const JWT_SECRET = 'w7b2-test-secret';
const PORTAL_PORT = 4591;
const MONOLITH_PORT = 4592;

// The 42 endpoints converted in W7-B2.
const CONVERTED_501 = [
  'abTesting.update', 'abTesting.delete', 'agriculturalInsurance.purchase',
  'aiClaims.process', 'application.update', 'bancassurance.submitApplication',
  'bankIntegrations.verifyAccount', 'batch.run', 'claimsEvidence.upload',
  'digitalConsumer.activate', 'documents.upload', 'embeddedDistribution.createPartner',
  'embedded.activate', 'embedded.create', 'fraudNetwork.analyze',
  'gigEconomy.activate', 'groupLife.enroll', 'health.submit',
  'loyalty.redeem', 'marketplace.purchase', 'microinsurance.enroll',
  'naicom.submit', 'niiraInsurance.purchase', 'nmid.verify',
  'parametric.claim', 'payments.initiate', 'payments.verify',
  'reinsurance.create', 'reviews.create', 'reviews.delete',
  'sme.submitApplication', 'telcoCredit.submitApplication', 'telematics.submit',
  'naicom.sendData', 'auditTrail.export', 'onboarding.complete',
  'takaful.join', 'payments.webhook', 'naicom.receiveData',
  'agricultural.submitApplication', 'compliance.run', 'disasterRecovery.test',
  'reports.generate', 'modelSecurity.scan',
];
const WIRED = ['familyCoverage.add', 'familyCoverage.remove', 'policies.renew', 'policyRenewal.renew'];

function token() {
  return jwt.sign({ sub: 1, email: 'w7b2@test.local', type: 'access' }, JWT_SECRET, { issuer: 'insureportal' });
}

function post(port, route, body, auth = true) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ json: body || {} });
    const req = http.request({
      host: '127.0.0.1', port, path: `/api/trpc/${route}`, method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(data),
        ...(auth ? { authorization: `Bearer ${token()}` } : {}),
      },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch { /* html error page etc. */ }
        resolve({ status: res.statusCode, json, raw: buf });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

function startPortal(extraEnv = {}) {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(PORTAL_PORT),
      JWT_SECRET,
      PGHOST: '127.0.0.1', PGPORT: '1', // unreachable DB — converted endpoints must not need it
      REDIS_URL: 'redis://127.0.0.1:1',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', () => {});
  return child;
}

async function waitReady(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: PORTAL_PORT, path: '/api/routes' }, (res) => {
          res.resume();
          resolve(res.statusCode);
        }).on('error', reject);
      });
      if (r === 200) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('portal did not become ready');
}

let portal;
before(async () => {
  portal = startPortal(); // MONOLITH_URL intentionally unset → fail-closed
  await waitReady();
});
after(() => { if (portal) portal.kill('SIGKILL'); });

test('all 44 backend-less mutations return 501 NOT_IMPLEMENTED (no fabricated success)', async () => {
  for (const route of CONVERTED_501) {
    const r = await post(PORTAL_PORT, route, { id: 1, amount: 100, name: 'x', nmid: 'NMID-1' });
    assert.strictEqual(r.status, 501, `${route} must fail closed 501, got ${r.status}: ${r.raw?.slice(0, 200)}`);
    assert.strictEqual(r.json?.error, 'NOT_IMPLEMENTED', `${route} must return NOT_IMPLEMENTED`);
    assert.strictEqual(r.json?.success, false, `${route} must not claim success`);
    assert.ok(r.json?.detail?.includes('/member'), `${route} must point to member portal`);
  }
});

test('wired endpoints fail closed 501 when MONOLITH_URL is not configured', async () => {
  for (const route of WIRED) {
    const r = await post(PORTAL_PORT, route, { policyId: 1, name: 'Ada', relationship: 'spouse', percentage: 50 });
    assert.strictEqual(r.status, 501, `${route} must fail closed when monolith unconfigured, got ${r.status}`);
    assert.strictEqual(r.json?.error, 'NOT_IMPLEMENTED');
  }
});

test('unauthenticated POST to a converted endpoint is 401, never fabricated success', async () => {
  const r = await post(PORTAL_PORT, 'loyalty.redeem', { points: 100 }, false);
  assert.strictEqual(r.status, 401);
  assert.notStrictEqual(r.json?.result?.data?.success, true);
});

// ── Batch-path regression tests (verifier findings) ──────────────────────────

function getBatch(port, route, input, auth = true) {
  return new Promise((resolve, reject) => {
    const q = input ? `?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': { json: input } }))}` : '?batch=1';
    const req = http.request({
      host: '127.0.0.1', port, path: `/api/trpc/${route}${q}`, method: 'GET',
      headers: auth ? { authorization: `Bearer ${token()}` } : {},
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch { /* non-JSON */ }
        resolve({ status: res.statusCode, json, raw: buf });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('batch auth.me does not crash the process and returns a result item', async () => {
  const r = await getBatch(PORTAL_PORT, 'auth.me');
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.json), 'batch response must be an array');
  assert.ok(r.json[0]?.result?.data?.json, 'auth.me batch item must carry data');
  // process survived: server still answers afterwards
  const alive = await getBatch(PORTAL_PORT, 'auth.me');
  assert.strictEqual(alive.status, 200);
});

test('batch loyalty.redeem returns honest NOT_IMPLEMENTED error item, never empty success', async () => {
  const r = await getBatch(PORTAL_PORT, 'loyalty.redeem', { points: 100 });
  assert.strictEqual(r.status, 200, 'tRPC batch returns 200 with per-item errors');
  const item = r.json?.[0];
  assert.ok(item?.error, `batch item must be an error, got: ${r.raw?.slice(0, 200)}`);
  assert.strictEqual(item.error.code, 'NOT_IMPLEMENTED');
  assert.strictEqual(item.error.httpStatus, 501);
  assert.ok(!item.result, 'must not contain a success result');
});

test('batch internal error returns honest error item, not empty success payload', async () => {
  // payments.process throws on broken DB (KYC gate query fails) → must surface as error item
  const r = await getBatch(PORTAL_PORT, 'payments.process', { policyId: 1, amount: 100 });
  const item = r.json?.[0];
  assert.ok(item?.error || (item?.result && item.result.data?.json?.success === false),
    `must never be an empty success array, got: ${r.raw?.slice(0, 200)}`);
  if (item?.error) assert.ok(item.error.code, 'error item carries a code');
});

test('unauthenticated GET mutation attempt on savings.contribute is 401', async () => {
  const r = await new Promise((resolve, reject) => {
    const q = `?input=${encodeURIComponent(JSON.stringify({ json: { planId: 1, amount: 50 } }))}`;
    http.request({ host: '127.0.0.1', port: PORTAL_PORT, path: `/api/trpc/savings.contribute${q}`, method: 'GET' }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, raw: buf }));
    }).on('error', reject).end();
  });
  assert.strictEqual(r.status, 401, `unauthenticated GET mutation must be 401, got ${r.status}: ${r.raw?.slice(0, 120)}`);
});

test('wired endpoint passes through to monolith with caller token and relays real response', async (t) => {
  // Fake monolith tRPC server capturing auth and returning a real response.
  const seen = { auth: null, path: null };
  const monolith = http.createServer((req, res) => {
    seen.auth = req.headers.authorization;
    seen.path = req.url;
    if (req.url.includes('memberBeneficiaries.upsertBeneficiary')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ result: { data: { json: { beneficiaryId: 42, persisted: true } } } }));
    } else {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'UNAUTHORIZED', code: 'UNAUTHORIZED' } }));
    }
  });
  await new Promise((r) => monolith.listen(MONOLITH_PORT, '127.0.0.1', r));

  portal.kill('SIGKILL');
  portal = startPortal({ MONOLITH_URL: `http://127.0.0.1:${MONOLITH_PORT}` });
  await waitReady();

  try {
    // happy path: real passthrough
    const ok = await post(PORTAL_PORT, 'familyCoverage.add', { policyId: 7, name: 'Ada', relationship: 'spouse', percentage: 50 });
    assert.strictEqual(ok.status, 200, `expected passthrough 200, got ${ok.status}: ${ok.raw?.slice(0, 200)}`);
    assert.strictEqual(ok.json?.result?.data?.beneficiaryId, 42);
    assert.ok(seen.auth?.startsWith('Bearer '), 'caller bearer token must be forwarded to monolith');
    assert.ok(seen.path.includes('memberBeneficiaries.upsertBeneficiary'));

    // upstream rejection must be relayed honestly (no fabricated success)
    const denied = await post(PORTAL_PORT, 'policies.renew', { id: 5 });
    assert.strictEqual(denied.status, 401, 'monolith 401 must be relayed, not hidden');
    assert.strictEqual(denied.json?.success, false);
  } finally {
    monolith.close();
  }
});
