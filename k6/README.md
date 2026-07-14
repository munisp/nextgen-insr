# InsurePortal POS Shell — k6 Load Tests

This directory contains [k6](https://k6.io) load test scenarios for the three highest-traffic paths in the InsurePortal Platform.

## Prerequisites

Install k6 on the test machine:

```bash
# macOS
brew install k6

# Ubuntu/Debian
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
     --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
     | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Docker
docker pull grafana/k6
```

## Test Scenarios

| File                        | Path Under Test                                  | Default VUs | Duration |
| --------------------------- | ------------------------------------------------ | ----------- | -------- |
| `transaction-throughput.js` | `transactions.create` (premium collection/out/transfer)     | 50 peak     | ~3.5 min |
| `float-topup.js`            | `premiumTopUp.request` + `premiumTopUp.listRequests` | 40 peak     | ~1.7 min |
| `dispute-creation.js`       | `disputes.raise` + `disputes.addMessage`         | 30 peak     | ~1.7 min |

## Running Tests

### Quick smoke test (5 VUs, 30 seconds)

```bash
k6 run --vus 5 --duration 30s k6/transaction-throughput.js
```

### Full load test against staging

```bash
BASE_URL=https://staging.insureportal.io \
AGENT_TOKEN=<pre-authenticated-cookie-value> \
k6 run k6/transaction-throughput.js
```

### All three scenarios in parallel

```bash
BASE_URL=https://staging.insureportal.io \
AGENT_TOKEN=<token> \
k6 run k6/transaction-throughput.js &

BASE_URL=https://staging.insureportal.io \
AGENT_TOKEN=<token> \
ADMIN_TOKEN=<admin-token> \
k6 run k6/float-topup.js &

BASE_URL=https://staging.insureportal.io \
AGENT_TOKEN=<token> \
k6 run k6/dispute-creation.js &

wait
```

### With Grafana Cloud k6 (CI integration)

```bash
K6_CLOUD_TOKEN=<token> k6 cloud k6/transaction-throughput.js
```

## Getting a Pre-Authenticated Token

1. Log in via the InsurePortal Platform UI as an agent.
2. Open DevTools → Application → Cookies → copy the `agent_session` value.
3. Pass it as `AGENT_TOKEN=<value>` in the k6 command.

Alternatively, use the setup function built into `transaction-throughput.js` — it will authenticate with `AGT001 / 123456` automatically if no `AGENT_TOKEN` is provided.

## Thresholds

Each scenario enforces the following SLOs:

| Metric            | Threshold                                                    |
| ----------------- | ------------------------------------------------------------ |
| p95 response time | < 500ms (transactions), < 800ms (float), < 1000ms (disputes) |
| Success rate      | > 99% (transactions), > 98% (float), > 97% (disputes)        |
| HTTP error rate   | < 1–3% depending on scenario                                 |

## Interpreting Results

k6 exits with code 0 if all thresholds pass, code 99 if any threshold fails. In CI, a non-zero exit code will fail the pipeline.

Results are written to `k6/results/` as JSON files when running locally.
