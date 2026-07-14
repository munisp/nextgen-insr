# Alertmanager Setup Guide — InsurePortal POS Shell

This document covers deploying and configuring the full open-source alerting stack for the InsurePortal POS Shell. The stack uses **Grafana OnCall** as the on-call rotation and escalation engine (replacing commercial tools like PagerDuty), **Alertmanager** for alert routing, and **Slack** for team notifications.

---

## Architecture

```
Prometheus ──(fires alerts)──► Alertmanager ──► Grafana OnCall webhook
                                            └──► Slack #pos-alerts-critical
                                            └──► Slack #pos-alerts-warning
                                            └──► Slack #pos-fraud-alerts
```

All components are open-source and self-hosted via `monitoring/docker-compose.monitoring.yml`.

| Component      | Image                       | Port | Purpose                               |
| -------------- | --------------------------- | ---- | ------------------------------------- |
| Prometheus     | `prom/prometheus:v2.53.0`   | 9090 | Metrics scraping + alert evaluation   |
| Grafana        | `grafana/grafana:11.1.0`    | 3001 | Dashboards + OnCall UI                |
| Grafana OnCall | `grafana/oncall:v1.8.9`     | 8080 | On-call rotations + escalation chains |
| Alertmanager   | `prom/alertmanager:v0.27.0` | 9093 | Alert routing + deduplication         |
| Node Exporter  | `prom/node-exporter:v1.8.2` | 9100 | Host-level metrics                    |
| Redis          | `redis:7.2-alpine`          | 6379 | OnCall message broker                 |

---

## Quick Start

### 1. Start the monitoring stack

```bash
cd monitoring/
docker-compose -f docker-compose.monitoring.yml up -d
```

Wait approximately 60 seconds for Grafana OnCall to initialise its database.

### 2. Access the services

| Service        | URL                                        | Default credentials                |
| -------------- | ------------------------------------------ | ---------------------------------- |
| Grafana        | http://localhost:3001                      | admin / admin-change-in-production |
| Prometheus     | http://localhost:9090                      | —                                  |
| Alertmanager   | http://localhost:9093                      | —                                  |
| Grafana OnCall | http://localhost:3001/a/grafana-oncall-app | (via Grafana)                      |

### 3. Configure Grafana OnCall

1. Open Grafana → **Apps** → **Grafana OnCall**.
2. Complete the initial setup wizard (connect to Grafana backend).
3. Navigate to **Integrations** → **New Integration** → **Alertmanager**.
4. Copy the generated webhook URL (format: `http://oncall:8080/integrations/v1/alertmanager/<token>/`).
5. Paste the URL into `monitoring/alertmanager.yml` under the `grafana-oncall-critical` receiver.

### 4. Create an on-call schedule

1. In Grafana OnCall → **Schedules** → **New Schedule**.
2. Add team members and configure rotation (e.g., weekly rotation).
3. In **Escalation Chains** → **New Chain**, add:
   - Step 1: Notify on-call person (5 min)
   - Step 2: Notify entire team (15 min)
   - Step 3: Repeat (30 min)
4. Link the escalation chain to the Alertmanager integration.

### 5. Configure Slack

1. Create a Slack App at https://api.slack.com/apps.
2. Enable **Incoming Webhooks** and create webhooks for:
   - `#pos-alerts-critical`
   - `#pos-alerts-warning`
   - `#pos-fraud-alerts`
   - `#pos-alerts-info`
3. Replace the placeholder webhook URLs in `monitoring/alertmanager.yml`.
4. For Grafana OnCall Slack integration: add the `SLACK_CLIENT_OAUTH_ID`, `SLACK_CLIENT_OAUTH_SECRET`, and `SLACK_SIGNING_SECRET` to `docker-compose.monitoring.yml`.

### 6. Reload Alertmanager configuration

After editing `alertmanager.yml`:

```bash
curl -X POST http://localhost:9093/-/reload
```

---

## Alert Rules

All alerting rules are defined in `monitoring/prometheus-rules.yml`. The file is automatically loaded by Prometheus via the `rule_files` directive in `monitoring/prometheus.yml`.

| Alert                              | Severity | Threshold        | For    | Channel                         |
| ---------------------------------- | -------- | ---------------- | ------ | ------------------------------- |
| `PlatformShellHighTransactionLatency`   | critical | p95 > 500 ms     | 2 min  | OnCall + Slack critical         |
| `PlatformShellHighTransactionErrorRate` | critical | error rate > 5%  | 3 min  | OnCall + Slack critical         |
| `PlatformShellNoTransactions`           | warning  | rate = 0         | 10 min | Slack warning                   |
| `PlatformShellFraudAlertSpike`          | critical | > 10 alerts/min  | 1 min  | OnCall + Slack critical + fraud |
| `PlatformShellFloatLockContention`      | warning  | > 5 locks/min    | 2 min  | Slack warning                   |
| `PlatformShellPlatformDegradation`      | warning  | error rate > 10% | 3 min  | Slack warning                   |
| `PlatformShellHighMemoryUsage`          | warning  | heap > 512 MB    | 5 min  | Slack warning                   |
| `PlatformShellEventLoopLag`             | warning  | lag > 100 ms     | 2 min  | Slack warning                   |

### Adding a new alert rule

1. Edit `monitoring/prometheus-rules.yml` and add a new entry under the appropriate group.
2. Reload Prometheus: `curl -X POST http://localhost:9090/-/reload`
3. Verify the rule appears at http://localhost:9090/rules.

---

## Grafana Dashboard Annotations from k6

The load test runner (`tests/load/run-all.sh`) automatically posts Grafana annotations at the start and end of each test run. This creates vertical markers on the dashboard so latency regressions can be correlated with load test windows.

To enable annotations, set these environment variables before running the suite:

```bash
export GRAFANA_URL=http://localhost:3001
export GRAFANA_API_KEY=glsa_xxxxxxxxxxxxxxxxxxxx   # Grafana → Profile → API Keys → New
export GRAFANA_DASHBOARD_UID=insurance-portal-prod-v1

./tests/load/run-all.sh http://localhost:3000 AGT001 1234
```

The annotation API key requires at minimum the **Editor** role in Grafana.

---

## Production Secrets Checklist

Before deploying to production, replace all placeholder values:

| File                            | Placeholder                                                | Replace with                    |
| ------------------------------- | ---------------------------------------------------------- | ------------------------------- |
| `alertmanager.yml`              | `slack-webhook-url-change-in-production`                   | Real Slack incoming webhook URL |
| `alertmanager.yml`              | `insurance-portal-integration-token-change-in-production`         | Grafana OnCall webhook token    |
| `docker-compose.monitoring.yml` | `admin-change-in-production`                               | Strong Grafana admin password   |
| `docker-compose.monitoring.yml` | `oncall-secret-key-change-in-production-min-50-chars-long` | 50+ char random string          |
| `docker-compose.monitoring.yml` | `slack-oauth-id-change-in-production`                      | Slack App OAuth client ID       |
| `docker-compose.monitoring.yml` | `slack-oauth-secret-change-in-production`                  | Slack App OAuth client secret   |
| `docker-compose.monitoring.yml` | `slack-signing-secret-change-in-production`                | Slack App signing secret        |

Generate strong secrets with:

```bash
openssl rand -base64 50
```

---

## Troubleshooting

| Symptom                      | Cause                                  | Fix                                                                  |
| ---------------------------- | -------------------------------------- | -------------------------------------------------------------------- |
| OnCall webhook returns 404   | Wrong integration token                | Re-copy webhook URL from OnCall UI                                   |
| Slack messages not delivered | Invalid webhook URL                    | Test webhook: `curl -X POST -d '{"text":"test"}' <webhook_url>`      |
| Alerts not firing            | Prometheus not scraping `/api/metrics` | Check `http://localhost:9090/targets`                                |
| OnCall not starting          | Redis not ready                        | `docker-compose logs redis` — wait for "Ready to accept connections" |
| Alertmanager config invalid  | YAML syntax error                      | `amtool check-config alertmanager.yml`                               |
