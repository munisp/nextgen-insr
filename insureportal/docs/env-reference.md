# InsurePortal — Environment Variables Reference

Copy and rename this file to `.env` for your environment. Never commit `.env` to version control.

## Application

| Variable   | Default                 | Description      |
| ---------- | ----------------------- | ---------------- |
| `NODE_ENV` | `production`            | Node environment |
| `PORT`     | `3000`                  | HTTP server port |
| `APP_URL`  | `https://pos.insureportal.ng` | Public URL       |

## Database

| Variable       | Default                                                     | Description                  |
| -------------- | ----------------------------------------------------------- | ---------------------------- |
| `POSTGRES_URL` | `postgresql://insureportal:changeme@localhost:5432/insureportal_db` | PostgreSQL connection string |

## Redis

| Variable    | Default                  | Description          |
| ----------- | ------------------------ | -------------------- |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `REDIS_TLS` | `false`                  | Enable TLS for Redis |

## JWT / Session

| Variable     | Default                     | Description        |
| ------------ | --------------------------- | ------------------ |
| `JWT_SECRET` | _(must set — min 64 bytes)_ | JWT signing secret |
| `JWT_EXPIRY` | `8h`                        | Token expiry       |

## Keycloak (OIDC / SSO)

| Variable             | Default                | Description         |
| -------------------- | ---------------------- | ------------------- |
| `KEYCLOAK_URL`       | `http://keycloak:8080` | Keycloak server URL |
| `KEYCLOAK_REALM`     | `insureportal`               | Realm name          |
| `KEYCLOAK_CLIENT_ID` | `insureportal`            | Client ID           |

## MinIO / S3 Object Storage

| Variable           | Default             | Description    |
| ------------------ | ------------------- | -------------- |
| `MINIO_ENDPOINT`   | `http://minio:9000` | MinIO endpoint |
| `MINIO_ACCESS_KEY` | `minioadmin`        | Access key     |
| `MINIO_SECRET_KEY` | `minioadmin123`     | Secret key     |
| `MINIO_BUCKET`     | `insureportal-insureportal`  | Default bucket |

## Kafka / Redpanda

| Variable          | Default               | Description    |
| ----------------- | --------------------- | -------------- |
| `KAFKA_BROKERS`   | `redpanda:9092`       | Broker list    |
| `KAFKA_CLIENT_ID` | `insureportal-server`    | Client ID      |
| `KAFKA_GROUP_ID`  | `insureportal-consumers` | Consumer group |

## HashiCorp Vault

| Variable            | Default                 | Description          |
| ------------------- | ----------------------- | -------------------- |
| `VAULT_ADDR`        | `http://vault:8200`     | Vault server address |
| `VAULT_TOKEN`       | _(must set)_            | Root/service token   |
| `VAULT_SECRET_PATH` | `secret/data/insureportal` | Secret mount path    |

## Temporal Workflow Engine

| Variable              | Default           | Description             |
| --------------------- | ----------------- | ----------------------- |
| `TEMPORAL_ADDRESS`    | `localhost:7233`  | Temporal server address |
| `TEMPORAL_NAMESPACE`  | `insureportal`       | Namespace               |
| `TEMPORAL_TASK_QUEUE` | `insureportal-tasks` | Task queue name         |

## Email (SMTP)

| Variable    | Default             | Description  |
| ----------- | ------------------- | ------------ |
| `SMTP_HOST` | `mailhog`           | SMTP host    |
| `SMTP_PORT` | `1025`              | SMTP port    |
| `SMTP_FROM` | `noreply@insureportal.ng` | From address |

## VAPID Push Notifications

Generate keys with: `npx web-push generate-vapid-keys`

| Variable            | Default                  | Description       |
| ------------------- | ------------------------ | ----------------- |
| `VAPID_PUBLIC_KEY`  | _(must generate)_        | VAPID public key  |
| `VAPID_PRIVATE_KEY` | _(must generate)_        | VAPID private key |
| `VAPID_SUBJECT`     | `mailto:admin@insureportal.ng` | VAPID subject     |

## Webhook Delivery

| Variable                 | Default      | Description          |
| ------------------------ | ------------ | -------------------- |
| `WEBHOOK_SIGNING_SECRET` | _(must set)_ | HMAC signing secret  |
| `WEBHOOK_MAX_RETRIES`    | `5`          | Max delivery retries |
| `WEBHOOK_RETRY_DELAY_MS` | `5000`       | Retry delay          |
| `WEBHOOK_TIMEOUT_MS`     | `10000`      | Delivery timeout     |

## Microservices (all have graceful fallback if unavailable)

| Variable                 | Default                          | Description           |
| ------------------------ | -------------------------------- | --------------------- |
| `KYC_SERVICE_URL`        | `http://kyc-service:8001`        | KYC service           |
| `FRAUD_SERVICE_URL`      | `http://fraud-detection:8004`    | Fraud detection       |
| `AGENT_PERFORMANCE_URL`  | `http://agent-performance:8005`  | Agent performance     |
| `CREDIT_SCORING_URL`     | `http://credit-scoring:8006`     | Credit scoring        |
| `GEOSPATIAL_SERVICE_URL` | `http://geospatial-service:8007` | Geospatial/Sedona     |
| `ANALYTICS_PLATFORM_URL` | `http://analytics-platform:8008` | DataFusion analytics  |
| `CBN_REPORTING_URL`      | `http://cbn-reporting:8009`      | CBN reporting         |
| `WORKFLOW_SERVICE_URL`   | `http://workflow-service:8010`   | Workflow orchestrator |
| `TB_SIDECAR_URL`         | `http://tb-sidecar:3001`         | TigerBeetle ledger    |
| `ERP_BASE_URL`           | `http://erp-service:8000`        | ERP integration       |

## CBN Regulatory Limits

| Variable                    | Default     | Description                   |
| --------------------------- | ----------- | ----------------------------- |
| `CBN_DAILY_LIMIT_TIER1`     | `50000`     | Tier 1 daily limit (NGN)      |
| `CBN_DAILY_LIMIT_TIER2`     | `200000`    | Tier 2 daily limit (NGN)      |
| `CBN_DAILY_LIMIT_TIER3`     | `500000`    | Tier 3 daily limit (NGN)      |
| `CBN_SINGLE_TX_LIMIT_TIER1` | `20000`     | Tier 1 single tx limit (NGN)  |
| `CBN_SINGLE_TX_LIMIT_TIER2` | `100000`    | Tier 2 single tx limit (NGN)  |
| `CBN_SINGLE_TX_LIMIT_TIER3` | `200000`    | Tier 3 single tx limit (NGN)  |
| `CBN_CTR_THRESHOLD`         | `5000000`   | CTR reporting threshold (NGN) |
| `CBN_SAR_THRESHOLD`         | `10000000`  | SAR reporting threshold (NGN) |
| `CBN_INSTITUTION_CODE`      | `INSURE001` | NAICOM institution code       |

## Float Management

| Variable                           | Default | Description                  |
| ---------------------------------- | ------- | ---------------------------- |
| `FLOAT_LOW_BALANCE_THRESHOLD`      | `10000` | Low balance alert (NGN)      |
| `FLOAT_CRITICAL_BALANCE_THRESHOLD` | `5000`  | Critical balance alert (NGN) |

## Commission Rates

| Variable                       | Default | Description       |
| ------------------------------ | ------- | ----------------- |
| `COMMISSION_CASH_IN_RATE`      | `0.005` | Cash in (0.5%)    |
| `COMMISSION_CASH_OUT_RATE`     | `0.008` | Cash out (0.8%)   |
| `COMMISSION_TRANSFER_RATE`     | `0.003` | Transfer (0.3%)   |
| `COMMISSION_BILL_PAYMENT_RATE` | `0.01`  | Bill payment (1%) |
| `COMMISSION_AIRTIME_RATE`      | `0.02`  | Airtime (2%)      |

## Loyalty Program

| Variable                     | Default | Description          |
| ---------------------------- | ------- | -------------------- |
| `LOYALTY_POINTS_PER_NAIRA`   | `0.001` | Points per NGN 1     |
| `LOYALTY_SILVER_THRESHOLD`   | `5000`  | Silver tier points   |
| `LOYALTY_GOLD_THRESHOLD`     | `20000` | Gold tier points     |
| `LOYALTY_PLATINUM_THRESHOLD` | `50000` | Platinum tier points |

## Security

| Variable           | Default                 | Description            |
| ------------------ | ----------------------- | ---------------------- |
| `BCRYPT_ROUNDS`    | `12`                    | bcrypt hash rounds     |
| `CORS_ORIGIN`      | `https://pos.insureportal.ng` | CORS allowed origin    |
| `COOKIE_SECURE`    | `true`                  | Secure cookie flag     |
| `COOKIE_SAME_SITE` | `strict`                | SameSite cookie policy |

## Grafana / Prometheus

| Variable               | Default      | Description               |
| ---------------------- | ------------ | ------------------------- |
| `PROMETHEUS_PORT`      | `9090`       | Prometheus port           |
| `GRAFANA_PORT`         | `3001`       | Grafana port              |
| `GRAFANA_ADMIN_USER`   | `admin`      | Grafana admin username    |
| `METRICS_BEARER_TOKEN` | _(must set)_ | Bearer token for /metrics |

## Logging

| Variable     | Default | Description           |
| ------------ | ------- | --------------------- |
| `LOG_LEVEL`  | `info`  | debug/info/warn/error |
| `LOG_FORMAT` | `json`  | json/text             |
