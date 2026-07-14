// k6 Load Test Configuration for InsurePortal
// Run: k6 run tests/load.test.js
// Requires: k6 (https://k6.io/docs/getting-started/installation/)

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5002';

const errorRate = new Rate('errors');
const loginDuration = new Trend('login_duration');
const apiDuration = new Trend('api_duration');

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Ramp up to 10 VUs
    { duration: '1m', target: 50 },    // Ramp to 50 VUs
    { duration: '2m', target: 50 },    // Stay at 50 VUs
    { duration: '30s', target: 100 },  // Peak at 100 VUs
    { duration: '1m', target: 100 },   // Stay at peak
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    errors: ['rate<0.05'],
    login_duration: ['p(95)<3000'],
    api_duration: ['p(95)<1000'],
  },
};

export default function () {
  // Health check
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, { 'health is 200': (r) => r.status === 200 });
  errorRate.add(healthRes.status !== 200);

  // Login
  const loginStart = Date.now();
  const loginRes = http.post(`${BASE_URL}/api/trpc/auth.login`, JSON.stringify({
    json: { email: 'demo@insureportal.ng', password: 'demo123' }
  }), { headers: { 'Content-Type': 'application/json' } });
  loginDuration.add(Date.now() - loginStart);
  check(loginRes, { 'login is 200': (r) => r.status === 200 });
  errorRate.add(loginRes.status !== 200);

  let token = '';
  try {
    const body = JSON.parse(loginRes.body);
    token = body?.result?.data?.token || '';
  } catch (e) { /* ignore */ }

  if (!token) { sleep(1); return; }

  const authHeaders = { headers: { 'Authorization': `Bearer ${token}` } };

  // Dashboard
  const dashStart = Date.now();
  const dashRes = http.get(`${BASE_URL}/api/trpc/dashboard.stats`, authHeaders);
  apiDuration.add(Date.now() - dashStart);
  check(dashRes, { 'dashboard is 200': (r) => r.status === 200 });
  errorRate.add(dashRes.status !== 200);

  // Policies list
  const polRes = http.get(`${BASE_URL}/api/trpc/policies.list?input=${encodeURIComponent('{"json":{"limit":10,"page":1}}')}`, authHeaders);
  check(polRes, { 'policies is 200': (r) => r.status === 200 });
  apiDuration.add(polRes.timings.duration);

  // Claims list
  const clmRes = http.get(`${BASE_URL}/api/trpc/claims.list?input=${encodeURIComponent('{"json":{"limit":10,"page":1}}')}`, authHeaders);
  check(clmRes, { 'claims is 200': (r) => r.status === 200 });
  apiDuration.add(clmRes.timings.duration);

  // KYC status
  const kycRes = http.get(`${BASE_URL}/api/trpc/kyc.status`, authHeaders);
  check(kycRes, { 'kyc is 200': (r) => r.status === 200 });

  sleep(1);
}

export function handleSummary(data) {
  return {
    'tests/load-results.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: '  ', enableColors: true }),
  };
}

function textSummary(data, opts) {
  const metrics = data.metrics;
  const lines = [
    '=== InsurePortal Load Test Results ===',
    `VUs: ${data.root_group?.checks?.length || 'N/A'}`,
    `Requests: ${metrics.http_reqs?.values?.count || 0}`,
    `Avg Duration: ${Math.round(metrics.http_req_duration?.values?.avg || 0)}ms`,
    `P95 Duration: ${Math.round(metrics.http_req_duration?.values?.['p(95)'] || 0)}ms`,
    `P99 Duration: ${Math.round(metrics.http_req_duration?.values?.['p(99)'] || 0)}ms`,
    `Error Rate: ${((metrics.errors?.values?.rate || 0) * 100).toFixed(2)}%`,
    `Login P95: ${Math.round(metrics.login_duration?.values?.['p(95)'] || 0)}ms`,
    `API P95: ${Math.round(metrics.api_duration?.values?.['p(95)'] || 0)}ms`,
  ];
  return lines.join('\n') + '\n';
}
