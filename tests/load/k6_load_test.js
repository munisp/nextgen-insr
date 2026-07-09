// ─── InsurePortal Load Test Suite (k6) ───────────────────────────────────────
// Simulates realistic insurance platform traffic patterns.
//
// Run:
//   k6 run --vus 50 --duration 5m tests/load/k6_load_test.js
//   k6 run --vus 200 --duration 30m tests/load/k6_load_test.js  # stress test
//
// Environment:
//   BASE_URL      — API base URL (default: http://localhost:8080)
//   AUTH_TOKEN     — JWT bearer token for authenticated endpoints

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ─── Custom Metrics ──────────────────────────────────────────────────────────

const errorRate = new Rate('errors');
const healthLatency = new Trend('health_latency');
const crudLatency = new Trend('crud_latency');
const searchLatency = new Trend('search_latency');
const totalRequests = new Counter('total_requests');

// ─── Configuration ───────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';

const headers = {
  'Content-Type': 'application/json',
  'X-Request-ID': `k6-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
};

if (AUTH_TOKEN) {
  headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
}

// ─── Test Scenarios ──────────────────────────────────────────────────────────

export const options = {
  stages: [
    { duration: '1m', target: 20 },   // Ramp up
    { duration: '3m', target: 50 },   // Sustained load
    { duration: '1m', target: 100 },  // Peak load
    { duration: '1m', target: 50 },   // Scale down
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],  // 95% < 2s, 99% < 5s
    errors: ['rate<0.05'],                              // <5% error rate
    health_latency: ['p(95)<500'],                      // Health checks < 500ms
    crud_latency: ['p(95)<3000'],                       // CRUD ops < 3s
  },
};

// ─── Helper Functions ────────────────────────────────────────────────────────

function randomService() {
  const services = [
    { name: 'claims', port: 8081, entity: 'claim' },
    { name: 'policies', port: 8082, entity: 'renewal_task' },
    { name: 'agents', port: 8083, entity: 'commission' },
    { name: 'kyc', port: 8084, entity: 'verification' },
    { name: 'notifications', port: 8085, entity: 'notification_log' },
    { name: 'audit', port: 8086, entity: 'audit_event' },
  ];
  return services[Math.floor(Math.random() * services.length)];
}

// ─── Test Execution ──────────────────────────────────────────────────────────

export default function () {
  const svc = randomService();

  group('Health Checks', () => {
    const res = http.get(`${BASE_URL}/health`, { headers, tags: { type: 'health' } });
    totalRequests.add(1);
    healthLatency.add(res.timings.duration);
    const success = check(res, {
      'health status 200': (r) => r.status === 200,
      'health body valid': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.status === 'healthy';
        } catch { return false; }
      },
    });
    errorRate.add(!success);
  });

  sleep(0.5);

  group('Readiness & Liveness', () => {
    const ready = http.get(`${BASE_URL}/ready`, { headers, tags: { type: 'probe' } });
    const live = http.get(`${BASE_URL}/live`, { headers, tags: { type: 'probe' } });
    totalRequests.add(2);
    check(ready, { 'ready 200': (r) => r.status === 200 });
    check(live, { 'live 200': (r) => r.status === 200 });
  });

  sleep(0.5);

  group('List Records (paginated)', () => {
    const page = Math.floor(Math.random() * 5) + 1;
    const res = http.get(`${BASE_URL}/api/v1/${svc.entity}s?page=${page}&limit=20`, {
      headers, tags: { type: 'list' },
    });
    totalRequests.add(1);
    crudLatency.add(res.timings.duration);
    const success = check(res, {
      'list status 200': (r) => r.status === 200,
      'list has data array': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body.data);
        } catch { return false; }
      },
    });
    errorRate.add(!success);
  });

  sleep(0.3);

  group('Create Record', () => {
    const payload = JSON.stringify({
      customer_id: Math.floor(Math.random() * 10000) + 1,
      status: 'pending',
    });
    const res = http.post(`${BASE_URL}/api/v1/${svc.entity}s/create`, payload, {
      headers, tags: { type: 'create' },
    });
    totalRequests.add(1);
    crudLatency.add(res.timings.duration);
    const success = check(res, {
      'create status 201': (r) => r.status === 201,
    });
    errorRate.add(!success);
  });

  sleep(0.3);

  group('Get By ID', () => {
    const id = Math.floor(Math.random() * 100) + 1;
    const res = http.get(`${BASE_URL}/api/v1/${svc.entity}?id=${id}`, {
      headers, tags: { type: 'get' },
    });
    totalRequests.add(1);
    crudLatency.add(res.timings.duration);
    check(res, {
      'get status 200 or 404': (r) => r.status === 200 || r.status === 404,
    });
  });

  sleep(0.3);

  group('Metrics Endpoint', () => {
    const res = http.get(`${BASE_URL}/metrics`, { headers, tags: { type: 'metrics' } });
    totalRequests.add(1);
    check(res, {
      'metrics status 200': (r) => r.status === 200,
      'metrics has counters': (r) => r.body && r.body.includes('http_requests_total'),
    });
  });

  sleep(Math.random() * 2);
}

// ─── Spike Test Scenario ─────────────────────────────────────────────────────

export function spikeTest() {
  // Simulates sudden traffic spike (e.g., after a disaster announcement)
  for (let i = 0; i < 10; i++) {
    http.get(`${BASE_URL}/health`, { headers });
    http.get(`${BASE_URL}/api/v1/renewal_tasks?page=1&limit=50`, { headers });
  }
}

// ─── Soak Test Configuration ─────────────────────────────────────────────────
// Run with: k6 run --vus 30 --duration 2h tests/load/k6_load_test.js

export function handleSummary(data) {
  return {
    'tests/load/results/summary.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: '  ', enableColors: true }),
  };
}

function textSummary(data, opts) {
  const metrics = data.metrics;
  let out = '\n══════ InsurePortal Load Test Summary ══════\n\n';
  out += `  Total Requests:    ${metrics.total_requests?.values?.count || 0}\n`;
  out += `  Error Rate:        ${((metrics.errors?.values?.rate || 0) * 100).toFixed(2)}%\n`;
  out += `  Health p95:        ${(metrics.health_latency?.values?.['p(95)'] || 0).toFixed(0)}ms\n`;
  out += `  CRUD p95:          ${(metrics.crud_latency?.values?.['p(95)'] || 0).toFixed(0)}ms\n`;
  out += `  HTTP p95:          ${(metrics.http_req_duration?.values?.['p(95)'] || 0).toFixed(0)}ms\n`;
  out += `  HTTP p99:          ${(metrics.http_req_duration?.values?.['p(99)'] || 0).toFixed(0)}ms\n`;
  out += '\n════════════════════════════════════════════\n';
  return out;
}
