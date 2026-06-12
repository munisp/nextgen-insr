const http = require('http');
const crypto = require('crypto');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5002';

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, headers: res.headers, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(name, condition, detail) {
    if (condition) { passed++; console.log(`  PASS: ${name}`); }
    else { failed++; console.error(`  FAIL: ${name} — ${detail || ''}`); }
  }

  // 1. Health endpoint
  console.log('\n=== Health ===');
  const health = await request('GET', '/health');
  assert('GET /health returns 200', health.status === 200);
  assert('/health has status=healthy', health.body?.status === 'healthy');
  assert('/health has version', typeof health.body?.version === 'string');

  // 2. Security headers
  console.log('\n=== Security Headers ===');
  assert('X-Content-Type-Options', health.headers['x-content-type-options'] === 'nosniff');
  assert('X-Frame-Options', health.headers['x-frame-options'] === 'DENY');
  assert('Strict-Transport-Security includes preload', (health.headers['strict-transport-security'] || '').includes('preload'));
  assert('Content-Security-Policy present', !!health.headers['content-security-policy']);
  assert('Referrer-Policy present', !!health.headers['referrer-policy']);
  assert('X-Request-ID present', !!health.headers['x-request-id']);
  assert('X-DNS-Prefetch-Control', health.headers['x-dns-prefetch-control'] === 'off');
  assert('X-Download-Options', health.headers['x-download-options'] === 'noopen');
  assert('Permissions-Policy present', !!health.headers['permissions-policy']);

  // 3. Request tracing
  console.log('\n=== Request Tracing ===');
  const customId = 'test-trace-' + Date.now();
  const traced = await request('GET', '/health', null, { 'X-Request-ID': customId });
  assert('Custom X-Request-ID echoed', traced.headers['x-request-id'] === customId);
  assert('Auto-generated X-Request-ID is UUID', /^[0-9a-f-]{36}$/.test(health.headers['x-request-id']));

  // 4. CORS preflight
  console.log('\n=== CORS ===');
  const cors = await request('OPTIONS', '/api/trpc/dashboard.stats', null, { 'Origin': 'http://localhost:5002' });
  assert('OPTIONS returns 204', cors.status === 204);
  assert('Access-Control-Allow-Methods present', !!cors.headers['access-control-allow-methods']);
  assert('Access-Control-Allow-Headers present', !!cors.headers['access-control-allow-headers']);

  // 5. Metrics
  console.log('\n=== Metrics ===');
  const metricsRes = await request('GET', '/metrics');
  assert('GET /metrics returns 200', metricsRes.status === 200);
  assert('/metrics has totalRequests', typeof metricsRes.body?.totalRequests === 'number');

  // 6. tRPC routes
  console.log('\n=== tRPC Query Routes ===');
  const dash = await request('GET', '/api/trpc/dashboard.stats');
  assert('dashboard.stats returns data', dash.body?.result?.data != null);
  assert('dashboard.stats has totalPolicies', typeof dash.body?.result?.data?.totalPolicies === 'number');

  const products = await request('GET', '/api/trpc/products.list');
  assert('products.list returns data', products.body?.result?.data != null);

  const coverageTypes = await request('GET', '/api/trpc/coverage.types');
  assert('coverage.types returns array', Array.isArray(coverageTypes.body?.result?.data));

  // 7. Auth flow
  console.log('\n=== Auth Flow ===');
  const login = await request('POST', '/api/trpc/auth.login', {
    email: 'demo@insureportal.ng', password: 'demo123',
  });
  assert('Demo login returns token', typeof login.body?.result?.data?.token === 'string');
  const token = login.body?.result?.data?.token;

  const me = await request('GET', '/api/trpc/auth.me', null, {
    'Authorization': `Bearer ${token}`,
  });
  assert('auth.me with valid token returns user data', me.body?.result?.data != null);

  // 8. Auth enforcement
  console.log('\n=== Auth Enforcement ===');
  const unauthMutation = await request('POST', '/api/trpc/policies.create', { type: 'motor' });
  assert('POST mutation without auth returns 401', unauthMutation.status === 401);
  assert('401 error has UNAUTHORIZED code', unauthMutation.body?.error?.code === 'UNAUTHORIZED');

  // 9. Rate limiting
  console.log('\n=== Rate Limiting ===');
  const singleRate = await request('GET', '/api/trpc/dashboard.stats');
  assert('Normal request returns 200', singleRate.status === 200);

  // 10. Route not found
  console.log('\n=== Error Handling ===');
  const notFound = await request('GET', '/api/trpc/nonexistent.route');
  assert('Unknown route returns 404', notFound.status === 404);
  assert('404 has NOT_FOUND code', notFound.body?.error?.code === 'NOT_FOUND');

  // 11. Health/ready endpoint
  console.log('\n=== Readiness Probe ===');
  const ready = await request('GET', '/health/ready');
  assert('/health/ready returns status', !!ready.body?.status);

  // Summary
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
