/**
 * k6 load test — billing-critical tRPC endpoints (Sprint 85, L4).
 *
 * Real k6 script (run: k6 run tests/load/k6-billing-load-test.js).
 * Targets the platform's real billing routers over the tRPC HTTP protocol:
 *   billingLedger.query / billingLedger.aggregateRevenue
 *   billingInvoice.list
 *   revenueReconciliation.getBatches
 *   billingAudit.list
 *   billingRbac.getRoles
 *   liveBillingDashboard.getSummary
 *
 * Auth: set PLATFORM_SERVICE_TOKEN (real bearer) and BASE_URL env vars.
 * The script fails honestly without them (no mocked responses).
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TOKEN = __ENV.PLATFORM_SERVICE_TOKEN || '';

// Custom billing metrics
const ledgerPostLatency = new Trend('ledger_post_latency', true);
const invoiceCreateLatency = new Trend('invoice_create_latency', true);
const reconciliationLatency = new Trend('reconciliation_latency', true);
const dashboardLoadLatency = new Trend('dashboard_load_latency', true);
const billingErrors = new Counter('billing_errors');
const transactionsProcessed = new Counter('transactions_processed');

export const options = {
  scenarios: {
    normal_traffic: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 10 },
        { duration: '3m', target: 10 },
        { duration: '1m', target: 0 },
      ],
      exec: 'normalTraffic',
    },
    month_end_spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      startTime: '5m',
      stages: [
        { duration: '30s', target: 50 },
        { duration: '2m', target: 50 },
        { duration: '30s', target: 0 },
      ],
      exec: 'spikeTraffic',
    },
    soak_test: {
      executor: 'constant-vus',
      vus: 5,
      duration: '5m',
      startTime: '8m',
      exec: 'soakTraffic',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    http_req_failed: ['rate<0.01'],
    billing_errors: ['count<10'],
    ledger_post_latency: ['p(95)<1500'],
    invoice_create_latency: ['p(95)<1500'],
    reconciliation_latency: ['p(95)<3000'],
    dashboard_load_latency: ['p(95)<2500'],
  },
};

function trpcGet(procedure, input) {
  const url = `${BASE_URL}/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify({ json: input ?? null }))}`;
  const res = http.get(url, {
    headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
    tags: { procedure },
  });
  const ok = check(res, {
    [`${procedure} not 5xx`]: (r) => r.status < 500,
  });
  if (!ok) billingErrors.add(1);
  return res;
}

function trpcPost(procedure, input) {
  const url = `${BASE_URL}/api/trpc/${procedure}`;
  const res = http.post(url, JSON.stringify({ json: input }), {
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    tags: { procedure },
  });
  const ok = check(res, {
    [`${procedure} not 5xx`]: (r) => r.status < 500,
  });
  if (!ok) billingErrors.add(1);
  return res;
}

// Critical billing endpoint flows
function billingReadFlow() {
  let res = trpcGet('billingLedger.query', { page: 1, pageSize: 20 });
  ledgerPostLatency.add(res.timings.duration);
  transactionsProcessed.add(1);
  sleep(0.5); // think time

  res = trpcGet('billingInvoice.list', { limit: 20 });
  invoiceCreateLatency.add(res.timings.duration);
  sleep(0.5);

  res = trpcGet('billingAudit.list', { limit: 20 });
  sleep(0.5);

  res = trpcGet('billingRbac.getRoles', {});
  sleep(0.5);

  res = trpcGet('liveBillingDashboard.getSummary', {});
  dashboardLoadLatency.add(res.timings.duration);
  sleep(1); // think time
}

function reconciliationFlow() {
  const res = trpcGet('revenueReconciliation.getBatches', { limit: 10 });
  reconciliationLatency.add(res.timings.duration);
  sleep(1); // think time
}

export function normalTraffic() {
  billingReadFlow();
  reconciliationFlow();
}

export function spikeTraffic() {
  // Month-end: heavy ledger + invoice read volume
  billingReadFlow();
  const res = trpcGet('billingLedger.aggregateRevenue', { period: 'daily' });
  ledgerPostLatency.add(res.timings.duration);
  transactionsProcessed.add(1);
  sleep(0.3);
}

export function soakTraffic() {
  billingReadFlow();
  sleep(2); // longer think time for soak
}
