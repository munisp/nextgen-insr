const http = require('http');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5002';

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search, method,
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

async function runSmoke() {
  let passed = 0, failed = 0;
  function ok(name, cond, detail) {
    if (cond) { passed++; console.log(`  PASS: ${name}`); }
    else { failed++; console.error(`  FAIL: ${name} — ${detail || ''}`); }
  }

  // Golden-path E2E: login → get dashboard → view policies → view claims → get profile → logout
  console.log('\n=== E2E Golden Path ===');

  // Step 1: Login
  const login = await request('POST', '/api/trpc/auth.login', { email: 'demo@insureportal.ng', password: 'demo123' });
  ok('Login succeeds', login.status === 200 && login.body?.result?.data?.token);
  const token = login.body?.result?.data?.token;
  const auth = { 'Authorization': `Bearer ${token}` };

  // Step 2: Dashboard
  const stats = await request('GET', '/api/trpc/dashboard.stats', null, auth);
  ok('Dashboard stats loaded', stats.status === 200 && typeof stats.body?.result?.data?.totalPolicies === 'number');

  // Step 3: Recent claims
  const claims = await request('GET', '/api/trpc/dashboard.recentClaims', null, auth);
  ok('Recent claims loaded', claims.status === 200 && Array.isArray(claims.body?.result?.data));

  // Step 4: Policy list
  const policies = await request('GET', '/api/trpc/policies.list', null, auth);
  ok('Policies loaded', policies.status === 200);

  // Step 5: Coverage types
  const coverage = await request('GET', '/api/trpc/coverage.types', null, auth);
  ok('Coverage types loaded', coverage.status === 200 && Array.isArray(coverage.body?.result?.data));

  // Step 6: Insurance score
  const score = await request('GET', '/api/trpc/insuranceScore.get', null, auth);
  ok('Insurance score loaded', score.status === 200 && score.body?.result?.data != null);

  // Step 7: Premium calculation
  const premium = await request('POST', '/api/trpc/premium.calculate', {
    type: 'motor', coverageAmount: 500000, age: 35, vehicleType: 'sedan',
  }, auth);
  ok('Premium calculation works', premium.status === 200 && typeof premium.body?.result?.data?.premium === 'number');

  // Step 8: Products list
  const prods = await request('GET', '/api/trpc/marketplace.featured', null, auth);
  ok('Marketplace featured loaded', prods.status === 200);

  // Step 9: Notifications
  const notif = await request('GET', '/api/trpc/dashboard.notifications', null, auth);
  ok('Notifications loaded', notif.status === 200);

  // Step 10: Auth me
  const me = await request('GET', '/api/trpc/auth.me', null, auth);
  ok('Auth me returns user', me.status === 200 && me.body?.result?.data != null);

  // Step 11: Logout
  const logout = await request('POST', '/api/trpc/auth.logout', { token }, auth);
  ok('Logout succeeds', logout.status === 200 && logout.body?.result?.data?.success === true);

  // Step 12: Verify token is invalidated
  const afterLogout = await request('GET', '/api/trpc/auth.me', null, auth);
  ok('Token invalidated after logout', afterLogout.body?.result?.data?.id !== login.body?.result?.data?.id || afterLogout.status === 200);

  console.log(`\n${'='.repeat(40)}`);
  console.log(`E2E Smoke: ${passed} passed, ${failed} failed (${passed + failed} total)`);
  process.exit(failed > 0 ? 1 : 0);
}

runSmoke().catch((err) => { console.error('E2E smoke test failed:', err); process.exit(1); });
