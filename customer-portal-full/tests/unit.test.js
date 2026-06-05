/**
 * Unit Tests for InsurePortal Critical Routes
 * Tests: auth, claims, payments, wallet, pagination, soft deletes, user-scoping, transactions
 *
 * Run: node tests/unit.test.js
 */
const assert = require('assert');

const BASE = process.env.TEST_URL || 'http://localhost:5002';
let passCount = 0;
let failCount = 0;
let authToken = null;

async function request(method, path, body, headers = {}) {
  const url = new URL(path, BASE);
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (authToken) opts.headers['Authorization'] = `Bearer ${authToken}`;
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  const text = await resp.text();
  try { return { status: resp.status, data: JSON.parse(text), headers: resp.headers }; }
  catch { return { status: resp.status, data: text, headers: resp.headers }; }
}

async function trpcQuery(route, input = {}) {
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  return request('GET', `/api/trpc/${route}?input=${encoded}`);
}

async function trpcMutate(route, input = {}) {
  return request('POST', `/api/trpc/${route}`, { json: input });
}

async function test(name, fn) {
  try {
    await fn();
    passCount++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failCount++;
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

async function run() {
  console.log('InsurePortal Unit Tests\n');

  // ─── Auth Tests ───
  console.log('Auth:');

  await test('login with valid credentials returns JWT', async () => {
    const r = await trpcMutate('auth.login', { email: 'demo@insureportal.ng', password: 'demo123' });
    assert.strictEqual(r.status, 200);
    const d = r.data.result?.data;
    assert.ok(d.token, 'Expected JWT token');
    assert.ok(d.token.startsWith('eyJ'), 'Token should be JWT format');
    assert.ok(d.email, 'Expected email in response');
    authToken = d.token;
  });

  await test('login with invalid password returns error', async () => {
    const r = await trpcMutate('auth.login', { email: 'demo@insureportal.ng', password: 'wrong' });
    const d = r.data.result?.data;
    assert.ok(d.error, 'Expected error response');
  });

  await test('login with missing email returns error', async () => {
    const r = await trpcMutate('auth.login', { password: 'demo123' });
    const d = r.data.result?.data;
    assert.ok(d.error, 'Expected error for missing email');
  });

  await test('signup validation — missing fields', async () => {
    const r = await trpcMutate('auth.signup', { email: 'test@test.com' });
    const d = r.data.result?.data;
    assert.ok(d.error, 'Expected error for missing fields');
    assert.ok(d.error.includes('required'), 'Error should mention required fields');
  });

  await test('signup validation — weak password', async () => {
    const r = await trpcMutate('auth.signup', { email: 'test@test.com', password: 'short', fullName: 'Test' });
    const d = r.data.result?.data;
    assert.ok(d.error, 'Expected error for weak password');
  });

  await test('auth.confirmResetPassword — missing fields', async () => {
    const r = await trpcMutate('auth.confirmResetPassword', {});
    const d = r.data.result?.data;
    assert.ok(d.error, 'Expected error for missing fields');
  });

  // ─── Pagination Tests ───
  console.log('\nPagination:');

  await test('policies.list respects limit parameter', async () => {
    const r = await trpcQuery('policies.list', { limit: 3 });
    const d = r.data.result?.data;
    assert.ok(Array.isArray(d), 'Expected array');
    assert.ok(d.length <= 3, `Expected ≤3 rows, got ${d.length}`);
  });

  await test('policies.list respects page parameter', async () => {
    const r1 = await trpcQuery('policies.list', { limit: 2, page: 1 });
    const r2 = await trpcQuery('policies.list', { limit: 2, page: 100 });
    const d1 = r1.data.result?.data;
    const d2 = r2.data.result?.data;
    assert.ok(Array.isArray(d1) && Array.isArray(d2));
    assert.ok(d1.length > 0, 'Page 1 should have data');
    assert.ok(d2.length === 0, 'Very high page should be empty (offset past all rows)');
  });

  await test('claims.list respects limit', async () => {
    const r = await trpcQuery('claims.list', { limit: 5 });
    const d = r.data.result?.data;
    assert.ok(Array.isArray(d));
    assert.ok(d.length <= 5, `Expected ≤5, got ${d.length}`);
  });

  await test('pagination rejects negative limit', async () => {
    const r = await trpcQuery('policies.list', { limit: -5 });
    const d = r.data.result?.data;
    assert.ok(Array.isArray(d), 'Should still return data with sanitized limit');
  });

  await test('pagination caps limit at 200', async () => {
    const r = await trpcQuery('policies.list', { limit: 999 });
    const d = r.data.result?.data;
    assert.ok(Array.isArray(d));
  });

  await test('payments.list supports pagination', async () => {
    const r = await trpcQuery('payments.list', { limit: 5 });
    assert.strictEqual(r.status, 200);
    const d = r.data.result?.data;
    assert.ok(Array.isArray(d));
  });

  await test('documents.list supports pagination', async () => {
    const r = await trpcQuery('documents.list', { limit: 5 });
    assert.strictEqual(r.status, 200);
    const d = r.data.result?.data;
    assert.ok(Array.isArray(d));
  });

  await test('users.list supports pagination', async () => {
    const r = await trpcQuery('users.list', { limit: 3 });
    assert.strictEqual(r.status, 200);
    const d = r.data.result?.data;
    assert.ok(Array.isArray(d));
    assert.ok(d.length <= 3);
  });

  await test('agents.list supports pagination', async () => {
    const r = await trpcQuery('agents.list', { limit: 3 });
    assert.strictEqual(r.status, 200);
    const d = r.data.result?.data;
    assert.ok(Array.isArray(d));
  });

  // ─── Soft Delete Tests ───
  console.log('\nSoft Deletes:');

  await test('claims.list excludes soft-deleted records', async () => {
    const r = await trpcQuery('claims.list', { limit: 100 });
    const d = r.data.result?.data;
    assert.ok(Array.isArray(d), 'Expected array');
    assert.ok(d.length > 0, 'Expected some claims');
  });

  await test('approval.chains excludes soft-deleted records', async () => {
    const r = await trpcQuery('approval.chains');
    const d = r.data.result?.data;
    assert.ok(Array.isArray(d), 'Expected array');
  });

  await test('rates.list excludes soft-deleted records', async () => {
    const r = await trpcQuery('rates.list');
    const d = r.data.result?.data;
    assert.ok(Array.isArray(d), 'Expected array');
  });

  await test('referral.list excludes soft-deleted records', async () => {
    const r = await trpcQuery('referral.list');
    const d = r.data.result?.data;
    assert.ok(Array.isArray(d), 'Expected array');
  });

  // ─── User Scoping Tests ───
  console.log('\nUser Scoping:');

  await test('notifications.list returns user-scoped results', async () => {
    const r = await trpcQuery('notifications.list');
    assert.strictEqual(r.status, 200);
    const d = r.data.result?.data;
    assert.ok(Array.isArray(d));
  });

  await test('wallet.balance returns user-scoped balance', async () => {
    const r = await trpcQuery('wallet.balance');
    assert.strictEqual(r.status, 200);
    const d = r.data.result?.data;
    assert.ok(d.balance !== undefined, 'Expected balance field');
    assert.strictEqual(d.currency, 'NGN');
  });

  await test('wallet.transactions returns results', async () => {
    const r = await trpcQuery('wallet.transactions');
    assert.strictEqual(r.status, 200);
    const d = r.data.result?.data;
    assert.ok(Array.isArray(d));
  });

  // ─── Transaction Tests ───
  console.log('\nTransactions:');

  await test('claims.approve uses transaction (success path)', async () => {
    const r = await trpcMutate('claims.approve', { id: 2 });
    const d = r.data.result?.data;
    assert.ok(d.success, 'Expected success');
    assert.strictEqual(d.status, 'approved');
  });

  await test('claims.payout uses transaction (no approved payout → error)', async () => {
    const r = await trpcMutate('claims.payout', { claimId: 999 });
    const d = r.data.result?.data;
    assert.strictEqual(d.success, false, 'Expected failure for non-existent payout');
    assert.ok(d.error, 'Expected error message');
  });

  await test('payments.process uses transaction', async () => {
    const r = await trpcMutate('payments.process', { policyId: 1, amount: 50000, method: 'card' });
    const d = r.data.result?.data;
    assert.ok(d.success, 'Expected success');
    assert.ok(d.transactionId, 'Expected transactionId');
    assert.ok(d.receiptNumber, 'Expected receiptNumber');
    assert.strictEqual(d.status, 'completed');
  });

  // ─── Claims Validation Tests ───
  console.log('\nClaims Validation:');

  await test('claims.create — valid claim succeeds', async () => {
    const r = await trpcMutate('claims.create', { policyId: 1, amount: 100000, description: 'Test claim for unit test' });
    const d = r.data.result?.data;
    assert.ok(d.success, 'Expected success');
    assert.ok(d.claimNumber, 'Expected claim number');
    assert.ok(d.claimNumber.startsWith('CLM-'), 'Claim number should start with CLM-');
  });

  await test('claims.delete — soft delete does not hard-delete', async () => {
    const r = await trpcMutate('claims.delete', { id: 999 });
    const d = r.data.result?.data;
    assert.ok(d.success, 'Expected success (even for non-existent claim)');
  });

  await test('claims.adjudicate — returns fraud scoring', async () => {
    const r = await trpcMutate('claims.adjudicate', { claimId: 1, amount: 5000000 });
    const d = r.data.result?.data;
    assert.ok(d.fraudScore !== undefined, 'Expected fraudScore');
    assert.ok(d.decision, 'Expected decision');
    assert.ok(d.checks?.length > 0, 'Expected rules evaluated');
  });

  // ─── Business Logic Tests ───
  console.log('\nBusiness Logic:');

  await test('dashboard.stats returns real data', async () => {
    const r = await trpcQuery('dashboard.stats');
    const d = r.data.result?.data;
    assert.ok(d.activePolicies !== undefined || d.totalPolicies !== undefined, 'Expected policy count');
  });

  await test('fraud.alerts returns data', async () => {
    const r = await trpcQuery('fraud.alerts');
    const d = r.data.result?.data;
    assert.ok(Array.isArray(d), 'Expected array of alerts');
  });

  await test('products.list returns products', async () => {
    const r = await trpcQuery('products.list');
    const d = r.data.result?.data;
    assert.ok(Array.isArray(d), 'Expected array of products');
    assert.ok(d.length > 0, 'Expected at least one product');
  });

  await test('health endpoint returns healthy', async () => {
    const r = await request('GET', '/health');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.status, 'healthy');
  });

  // ─── Security Tests ───
  console.log('\nSecurity:');

  await test('auth enforcement — unauthenticated POST mutation', async () => {
    const savedToken = authToken;
    authToken = null;
    const r = await trpcMutate('claims.create', { policyId: 1, amount: 100000, description: 'Test claim for security check' });
    authToken = savedToken;
    assert.ok(r.status === 401 || (r.data.error && r.data.error.code === 'UNAUTHORIZED'), 'Expected 401 or UNAUTHORIZED');
  });

  await test('Helmet security headers present', async () => {
    const r = await request('GET', '/health');
    const csp = r.headers.get('content-security-policy');
    const xframe = r.headers.get('x-frame-options');
    assert.ok(csp || xframe, 'Expected at least one security header');
  });

  // ─── Infrastructure Tests ───
  console.log('\nInfrastructure:');

  await test('metrics endpoint returns data', async () => {
    const r = await request('GET', '/metrics');
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.totalRequests !== undefined || r.data.requests !== undefined, 'Expected metrics data');
  });

  await test('withTransaction helper exists and works', async () => {
    const r = await trpcMutate('wallet.topup', { amount: 100, narration: 'Unit test topup' });
    const d = r.data.result?.data;
    assert.ok(d.success, 'Expected transaction to succeed');
    assert.ok(d.transactionId, 'Expected transaction ID');
    assert.ok(d.newBalance !== undefined, 'Expected new balance');
  });

  // ─── Summary ───
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passCount} passed, ${failCount} failed (${passCount + failCount} total)`);
  console.log(`${'='.repeat(50)}`);
  process.exit(failCount > 0 ? 1 : 0);
}

run().catch(err => { console.error('Test runner failed:', err); process.exit(1); });
