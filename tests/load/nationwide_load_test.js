// =============================================================================
// k6 Load Test — Nationwide Traffic Simulation
// Simulates realistic insurance platform traffic for Nigeria nationwide rollout
//
// Usage:
//   LOCAL:      k6 run --env ENV=local nationwide_load_test.js
//   STAGING:    k6 run --env ENV=staging --env DOMAIN=staging.insureportal.ng nationwide_load_test.js
//   PRODUCTION: k6 run --env ENV=production --env DOMAIN=api.insureportal.ng nationwide_load_test.js
// =============================================================================

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const quoteDuration = new Trend('quote_creation_duration');
const policyDuration = new Trend('policy_binding_duration');
const claimDuration = new Trend('claim_filing_duration');
const healthCheckDuration = new Trend('health_check_duration');
const totalTransactions = new Counter('total_transactions');

// ---------------------------------------------------------------------------
// Load profiles — simulate real nationwide traffic patterns
// ---------------------------------------------------------------------------
export const options = {
  scenarios: {
    // Scenario 1: Normal business hours (9am-5pm) — steady state
    steady_state: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 50 },    // Ramp up to 50 users
        { duration: '5m', target: 50 },    // Hold at 50 users (steady state)
        { duration: '2m', target: 100 },   // Ramp to 100 (lunch rush)
        { duration: '5m', target: 100 },   // Hold at 100
        { duration: '2m', target: 50 },    // Back to normal
        { duration: '2m', target: 0 },     // Ramp down
      ],
      gracefulStop: '30s',
    },
    // Scenario 2: Spike test — sudden traffic surge (e.g., natural disaster causing mass claims)
    spike_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      startTime: '20m',
      stages: [
        { duration: '30s', target: 200 },  // Sudden spike to 200 users
        { duration: '2m', target: 200 },   // Hold spike
        { duration: '30s', target: 0 },    // Drop back
      ],
      gracefulStop: '30s',
    },
    // Scenario 3: Soak test — sustained load over time
    soak_test: {
      executor: 'constant-vus',
      vus: 30,
      duration: '30m',
      startTime: '25m',
      gracefulStop: '60s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],   // 95th < 2s, 99th < 5s
    http_req_failed: ['rate<0.05'],                      // Error rate < 5%
    errors: ['rate<0.1'],                                // Custom error rate < 10%
    quote_creation_duration: ['p(95)<3000'],              // Quote creation < 3s
    policy_binding_duration: ['p(95)<2000'],              // Policy binding < 2s
    claim_filing_duration: ['p(95)<3000'],                // Claim filing < 3s
    health_check_duration: ['p(95)<500'],                 // Health check < 500ms
  },
};

// ---------------------------------------------------------------------------
// Environment configuration
// ---------------------------------------------------------------------------
const ENV = __ENV.ENV || 'local';
const DOMAIN = __ENV.DOMAIN || 'localhost';

function getBaseURL(service) {
  if (ENV === 'local') {
    const ports = {
      underwriting: 9301,
      policy: 9302,
      premium: 9303,
      claims: 9304,
      payout: 9305,
      communication: 9306,
      audit: 9307,
      reinsurance: 9308,
      naicom: 9309,
      fraud: 9310,
    };
    return `http://localhost:${ports[service]}`;
  }
  return `https://${service}.${DOMAIN}`;
}

const HEADERS = { 'Content-Type': 'application/json' };
const NIGERIAN_STATES = ['Lagos', 'Abuja', 'Rivers', 'Kano', 'Oyo', 'Kaduna', 'Enugu', 'Delta', 'Edo', 'Anambra'];
const PRODUCTS = ['motor_comprehensive', 'motor_third_party', 'fire_burglary', 'marine_cargo', 'life_term', 'group_life', 'health_individual'];
const VEHICLE_MAKES = ['Toyota', 'Honda', 'Mercedes', 'Hyundai', 'Kia', 'Nissan', 'Peugeot', 'Innoson'];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// Test scenarios
// ---------------------------------------------------------------------------
export default function () {
  const scenario = Math.random();

  if (scenario < 0.30) {
    quoteAndUnderwrite();
  } else if (scenario < 0.50) {
    bindPolicy();
  } else if (scenario < 0.65) {
    fileClaim();
  } else if (scenario < 0.80) {
    healthChecks();
  } else if (scenario < 0.90) {
    listOperations();
  } else {
    statsAndMetrics();
  }

  sleep(Math.random() * 2 + 0.5);
}

function quoteAndUnderwrite() {
  group('Quote and Underwrite', function () {
    const payload = JSON.stringify({
      customer_name: `Customer_${__VU}_${__ITER}`,
      product_type: randomItem(PRODUCTS),
      sum_insured: randomBetween(500000, 10000000),
      vehicle_year: randomBetween(2015, 2026),
      vehicle_make: randomItem(VEHICLE_MAKES),
      location_state: randomItem(NIGERIAN_STATES),
      customer_age: randomBetween(25, 65),
      risk_score: Math.random() * 0.5,
    });

    const start = Date.now();
    const res = http.post(
      `${getBaseURL('underwriting')}/api/v1/underwriting_assessments/create`,
      payload,
      { headers: HEADERS, timeout: '10s' }
    );
    quoteDuration.add(Date.now() - start);
    totalTransactions.add(1);

    const success = check(res, {
      'quote created': (r) => r.status === 201,
      'response has id': (r) => {
        try { return JSON.parse(r.body).id !== undefined; } catch { return false; }
      },
    });
    errorRate.add(!success);
  });
}

function bindPolicy() {
  group('Bind Policy', function () {
    const payload = JSON.stringify({
      policy_number: `POL-${Date.now()}-${__VU}`,
      customer_name: `Customer_${__VU}`,
      product_type: randomItem(PRODUCTS),
      sum_insured: randomBetween(1000000, 5000000),
      premium_amount: randomBetween(25000, 200000),
      status: 'active',
      effective_date: '2026-01-15',
      expiry_date: '2027-01-14',
    });

    const start = Date.now();
    const res = http.post(
      `${getBaseURL('policy')}/api/v1/policies/create`,
      payload,
      { headers: HEADERS, timeout: '10s' }
    );
    policyDuration.add(Date.now() - start);
    totalTransactions.add(1);

    const success = check(res, {
      'policy created': (r) => r.status === 201,
    });
    errorRate.add(!success);
  });
}

function fileClaim() {
  group('File Claim', function () {
    const payload = JSON.stringify({
      claimant_name: `Claimant_${__VU}_${__ITER}`,
      claim_type: randomItem(['accident', 'theft', 'fire', 'flood', 'medical']),
      description: `Claim filed during load test iteration ${__ITER}`,
      claimed_amount: randomBetween(50000, 2000000),
      incident_date: '2026-06-01',
      status: 'submitted',
    });

    const start = Date.now();
    const res = http.post(
      `${getBaseURL('claims')}/api/v1/claims/create`,
      payload,
      { headers: HEADERS, timeout: '10s' }
    );
    claimDuration.add(Date.now() - start);
    totalTransactions.add(1);

    const success = check(res, {
      'claim filed': (r) => r.status === 201,
    });
    errorRate.add(!success);
  });
}

function healthChecks() {
  group('Health Checks', function () {
    const services = ['underwriting', 'policy', 'claims', 'payout', 'audit'];
    for (const svc of services) {
      const start = Date.now();
      const res = http.get(`${getBaseURL(svc)}/health`, { timeout: '5s' });
      healthCheckDuration.add(Date.now() - start);

      check(res, {
        [`${svc} healthy`]: (r) => r.status === 200,
      });
    }
  });
}

function listOperations() {
  group('List Operations', function () {
    const endpoints = [
      { svc: 'underwriting', path: '/api/v1/underwriting_assessments' },
      { svc: 'policy', path: '/api/v1/policies' },
      { svc: 'claims', path: '/api/v1/claims' },
    ];
    for (const ep of endpoints) {
      const res = http.get(`${getBaseURL(ep.svc)}${ep.path}`, { timeout: '10s' });
      totalTransactions.add(1);
      check(res, {
        [`${ep.svc} list OK`]: (r) => r.status === 200,
      });
    }
  });
}

function statsAndMetrics() {
  group('Stats and Metrics', function () {
    const services = ['underwriting', 'policy', 'claims', 'audit', 'naicom'];
    for (const svc of services) {
      const res = http.get(`${getBaseURL(svc)}/stats`, { timeout: '5s' });
      check(res, {
        [`${svc} stats OK`]: (r) => r.status === 200,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Summary output
// ---------------------------------------------------------------------------
export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    environment: ENV,
    total_requests: data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0,
    total_transactions: data.metrics.total_transactions ? data.metrics.total_transactions.values.count : 0,
    error_rate: data.metrics.errors ? data.metrics.errors.values.rate : 0,
    p95_duration_ms: data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(95)'] : 0,
    p99_duration_ms: data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(99)'] : 0,
    thresholds_passed: Object.values(data.root_group.checks || {}).every(c => c.fails === 0),
  };

  return {
    'results/load_test_summary.json': JSON.stringify(summary, null, 2),
    stdout: textSummary(data, { indent: '  ', enableColors: true }),
  };
}

function textSummary(data) {
  return `
=== Nationwide Load Test Summary ===
Environment: ${ENV}
Total Requests: ${data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 'N/A'}
Error Rate: ${data.metrics.errors ? (data.metrics.errors.values.rate * 100).toFixed(2) : 'N/A'}%
P95 Duration: ${data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(95)'].toFixed(0) : 'N/A'}ms
P99 Duration: ${data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(99)'].toFixed(0) : 'N/A'}ms
`;
}
