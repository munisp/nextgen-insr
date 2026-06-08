# Grafana + Prometheus Monitoring Setup

## Overview

The InsurePortal POS Shell exposes a Prometheus-compatible metrics endpoint at `GET /api/metrics`. This guide walks through connecting it to a Prometheus scraper and importing the pre-built Grafana dashboard.

---

## Step 1 — Add the Prometheus Scrape Job

Copy the job block from `docs/prometheus-scrape-config.yml` into your `prometheus.yml` under the `scrape_configs:` key:

```yaml
scrape_configs:
  - job_name: "agent-dashboard"
    scrape_interval: 15s
    scrape_timeout: 10s
    metrics_path: /api/metrics
    scheme: https
    static_configs:
      - targets:
          - "agent-dashboard.insureportal.internal:443"
        labels:
          environment: "production"
          service: "agent-dashboard"
          region: "ng-west-1"
```

For local development, use `scheme: http` and `targets: ["localhost:3000"]`.

Reload Prometheus after editing:

```bash
curl -X POST http://localhost:9090/-/reload
# or
kill -HUP $(pgrep prometheus)
```

Verify the target is healthy at `http://localhost:9090/targets` — the `agent-dashboard` job should show **UP**.

---

## Step 2 — Import the Grafana Dashboard

1. Open Grafana and navigate to **Dashboards → Import**.
2. Click **Upload JSON file** and select `docs/grafana-dashboard.json`.
3. When prompted, select your Prometheus data source from the `DS_PROMETHEUS` dropdown.
4. Click **Import**.

The dashboard UID is `agent-dashboard-prod-v1`. If you already have a dashboard with that UID, Grafana will offer to overwrite it.

---

## Dashboard Panels

The dashboard contains four row groups:

| Row                         | Panels                   | Key Metrics                                                                             |
| --------------------------- | ------------------------ | --------------------------------------------------------------------------------------- |
| **Transaction Volume**      | Stat cards + time series | `pos_transactions_total`, `pos_http_request_duration_ms`                                |
| **Float & Fraud**           | Time series              | `pos_float_topup_requests_total`, `pos_float_locks_total`, `pos_fraud_alerts_total`     |
| **Platform Service Health** | Time series              | `pos_platform_calls_total`, `pos_platform_call_duration_ms`                             |
| **Node.js Process Health**  | Time series              | `pos_node_heap_size_*`, `pos_node_gc_duration_seconds`, `pos_node_active_handles_total` |

The **Environment** template variable (top-left) filters all panels by the `environment` label set during scraping.

---

## Step 3 — Configure Alerting Rules

Add these recording and alerting rules to a new file `agent-dashboard-rules.yml` and reference it in `prometheus.yml` under `rule_files:`:

```yaml
# agent-dashboard-rules.yml
groups:
  - name: pos_shell_alerts
    interval: 1m
    rules:
      # ── SLA: p95 latency > 500 ms for 2 consecutive minutes ────────────────
      - alert: PosShellHighLatency
        expr: |
          histogram_quantile(0.95,
            sum(rate(pos_http_request_duration_ms_bucket[5m])) by (le)
          ) > 500
        for: 2m
        labels:
          severity: warning
          service: agent-dashboard
        annotations:
          summary: "POS Shell p95 latency above 500 ms SLA"
          description: "p95 HTTP latency is {{ $value | humanizeDuration }} — above the 500 ms SLA threshold."

      # ── Error rate > 5% for 1 minute ────────────────────────────────────────
      - alert: PosShellHighErrorRate
        expr: |
          sum(rate(pos_transaction_errors_total[5m]))
          /
          sum(rate(pos_transactions_total[5m])) > 0.05
        for: 1m
        labels:
          severity: critical
          service: agent-dashboard
        annotations:
          summary: "POS Shell transaction error rate above 5%"
          description: "Transaction error rate is {{ $value | humanizePercentage }}."

      # ── High fraud alert volume ──────────────────────────────────────────────
      - alert: PosShellFraudSpike
        expr: sum(increase(pos_fraud_alerts_total{severity="critical"}[10m])) > 10
        for: 0m
        labels:
          severity: critical
          service: agent-dashboard
        annotations:
          summary: "Critical fraud alert spike detected"
          description: "{{ $value }} critical fraud alerts in the last 10 minutes."

      # ── Platform service degradation ─────────────────────────────────────────
      - alert: PosShellPlatformErrors
        expr: |
          sum(rate(pos_platform_calls_total{status="error"}[5m]))
          /
          sum(rate(pos_platform_calls_total[5m])) > 0.10
        for: 2m
        labels:
          severity: warning
          service: agent-dashboard
        annotations:
          summary: "Platform service error rate above 10%"
          description: "Platform call error rate is {{ $value | humanizePercentage }}."
```

---

## Grafana Cloud k6 Integration

To push k6 load test results directly into Grafana Cloud for correlation with production metrics:

```bash
# Set your Grafana Cloud credentials
export K6_CLOUD_TOKEN="your-grafana-cloud-token"
export K6_CLOUD_PROJECT_ID="your-project-id"

# Run with cloud output
k6 run --out cloud tests/load/transaction-throughput.js \
  -e BASE_URL=https://agent-dashboard.insureportal.internal \
  -e AGENT_CODE=AGT001 \
  -e AGENT_PIN=1234
```

This streams VU count, RPS, and latency percentiles into Grafana Cloud in real time, overlaid with the production `pos_transactions_total` counter for direct comparison.

---

## Metric Reference

| Metric                           | Type      | Labels                           | Description                      |
| -------------------------------- | --------- | -------------------------------- | -------------------------------- |
| `pos_transactions_total`         | Counter   | `type`, `status`, `channel`      | Total transactions processed     |
| `pos_transaction_errors_total`   | Counter   | `type`, `reason`                 | Transaction failures by reason   |
| `pos_float_locks_total`          | Counter   | `trigger`                        | Float account lock events        |
| `pos_disputes_raised_total`      | Counter   | `type`                           | Disputes raised by type          |
| `pos_float_topup_requests_total` | Counter   | `status`                         | Float top-up request submissions |
| `pos_platform_calls_total`       | Counter   | `service`, `status`              | Outbound platform service calls  |
| `pos_fraud_alerts_total`         | Counter   | `severity`                       | Fraud alerts by severity         |
| `pos_transaction_duration_ms`    | Histogram | `type`                           | Transaction processing time      |
| `pos_platform_call_duration_ms`  | Histogram | `service`                        | Platform service call latency    |
| `pos_http_request_duration_ms`   | Histogram | `method`, `route`, `status_code` | HTTP request duration            |
| `pos_node_*`                     | Various   | —                                | Default Node.js process metrics  |
