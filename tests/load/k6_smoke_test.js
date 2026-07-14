import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
var errorRate = new Rate('errors');
var fraudLatency = new Trend('fraud_scoring_latency');
var crudLatency = new Trend('crud_latency');

export var options = {
    scenarios: {
        // Steady state: 50 concurrent users for 30s
        steady_state: {
            executor: 'constant-vus',
            vus: 50,
            duration: '30s',
            gracefulStop: '5s',
        },
        // Spike: ramp to 200 users
        spike: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '10s', target: 200 },
                { duration: '20s', target: 200 },
                { duration: '5s', target: 0 },
            ],
            startTime: '35s',
        },
    },
    thresholds: {
        http_req_duration: ['p(95)<500', 'p(99)<2000'],
        errors: ['rate<0.05'],
        fraud_scoring_latency: ['p(95)<200'],
        crud_latency: ['p(95)<300'],
    },
};

var BASE_FRAUD = __ENV.FRAUD_URL || 'http://localhost:9310';
var BASE_UW = __ENV.UNDERWRITING_URL || 'http://localhost:9301';
var BASE_PREMIUM = __ENV.PREMIUM_URL || 'http://localhost:9303';

export default function () {
    var scenario = Math.random();

    if (scenario < 0.3) {
        // 30%: Fraud scoring (high-value transactions)
        var amount = Math.floor(Math.random() * 20000000);
        var payload = JSON.stringify({
            amount: amount,
            account_id: 'ACC-' + __VU,
            merchant: 'test-merchant',
            location: 'Lagos',
            device_id: 'D-' + __VU,
            hour_of_day: Math.floor(Math.random() * 24),
        });
        var res = http.post(BASE_FRAUD + '/api/v1/score', payload, {
            headers: { 'Content-Type': 'application/json' },
        });
        fraudLatency.add(res.timings.duration);
        check(res, { 'fraud score 200': function(r) { return r.status === 200; } });
        errorRate.add(res.status !== 200);

    } else if (scenario < 0.6) {
        // 30%: CRUD list (pagination)
        var page = Math.floor(Math.random() * 5) + 1;
        var res = http.get(BASE_UW + '/api/v1/decisions?page=' + page + '&limit=20');
        crudLatency.add(res.timings.duration);
        check(res, { 'list 200': function(r) { return r.status === 200; } });
        errorRate.add(res.status !== 200);

    } else if (scenario < 0.8) {
        // 20%: Health checks (monitoring simulation)
        var services = [BASE_FRAUD, BASE_UW, BASE_PREMIUM];
        var svc = services[Math.floor(Math.random() * services.length)];
        var res = http.get(svc + '/health');
        check(res, { 'health 200': function(r) { return r.status === 200; } });
        errorRate.add(res.status !== 200);

    } else {
        // 20%: Premium collection
        var payload = JSON.stringify({
            policy_id: 'POL-' + __VU + '-' + __ITER,
            amount: Math.floor(Math.random() * 500000) + 10000,
            channel: Math.random() > 0.5 ? 'card' : 'bank_transfer',
            customer_id: 'CUST-' + __VU,
        });
        var res = http.post(BASE_PREMIUM + '/api/v1/collect', payload, {
            headers: { 'Content-Type': 'application/json' },
        });
        crudLatency.add(res.timings.duration);
        check(res, { 'collect 200': function(r) { return r.status === 200; } });
        errorRate.add(res.status !== 200);
    }

    sleep(0.1);
}
