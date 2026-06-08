# InsurePortal POS Shell — Environment Variables Reference

This document lists every environment variable used by the platform, grouped by service. Variables marked **Required** must be set for production deployment. Variables marked **Optional** have sensible defaults.

## Core Application

| Variable          | Required | Default       | Description                                      |
| ----------------- | -------- | ------------- | ------------------------------------------------ |
| `DATABASE_URL`    | Yes      | —             | PostgreSQL connection string                     |
| `POSTGRES_URL`    | Yes      | —             | Alias for DATABASE_URL (used by Drizzle)         |
| `JWT_SECRET`      | Yes      | —             | Secret key for signing agent JWT session cookies |
| `PORT`            | No       | `3000`        | HTTP server port                                 |
| `NODE_ENV`        | No       | `development` | Environment mode (`development`, `production`)   |
| `LOG_LEVEL`       | No       | `info`        | Logging level (`debug`, `info`, `warn`, `error`) |
| `ALLOWED_ORIGINS` | No       | `*`           | Comma-separated CORS allowed origins             |
| `API_VERSION`     | No       | `v1`          | API version prefix                               |

## Manus OAuth

| Variable                | Required | Default | Description                       |
| ----------------------- | -------- | ------- | --------------------------------- |
| `VITE_APP_ID`           | Yes      | —       | Manus OAuth application ID        |
| `OAUTH_SERVER_URL`      | Yes      | —       | Manus OAuth backend base URL      |
| `VITE_OAUTH_PORTAL_URL` | Yes      | —       | Manus login portal URL (frontend) |
| `OWNER_OPEN_ID`         | No       | —       | Owner's Manus OpenID              |

## Manus Built-in APIs

| Variable                      | Required | Default | Description                                      |
| ----------------------------- | -------- | ------- | ------------------------------------------------ |
| `BUILT_IN_FORGE_API_URL`      | Yes      | —       | Manus built-in API base URL (LLM, storage, etc.) |
| `BUILT_IN_FORGE_API_KEY`      | Yes      | —       | Bearer token for server-side Manus API calls     |
| `VITE_FRONTEND_FORGE_API_KEY` | No       | —       | Bearer token for frontend Manus API calls        |
| `VITE_FRONTEND_FORGE_API_URL` | No       | —       | Frontend Manus API URL                           |

## Keycloak IAM

| Variable                 | Required | Default                | Description            |
| ------------------------ | -------- | ---------------------- | ---------------------- |
| `KEYCLOAK_URL`           | No       | `http://keycloak:8080` | Keycloak server URL    |
| `KEYCLOAK_REALM`         | No       | `insureportal`               | Keycloak realm name    |
| `KEYCLOAK_CLIENT_ID`     | No       | `agent-dashboard`            | Keycloak client ID     |
| `KEYCLOAK_CLIENT_SECRET` | No       | —                      | Keycloak client secret |

## TigerBeetle Sidecar

| Variable         | Required | Default                 | Description                     |
| ---------------- | -------- | ----------------------- | ------------------------------- |
| `TB_SIDECAR_URL` | No       | `http://localhost:8030` | TigerBeetle Go sidecar HTTP URL |

## Redis

| Variable    | Required | Default                  | Description                                   |
| ----------- | -------- | ------------------------ | --------------------------------------------- |
| `REDIS_URL` | No       | `redis://localhost:6379` | Redis connection URL (rate limiting, caching) |

## Kafka / Event Streaming

| Variable              | Required | Default          | Description                       |
| --------------------- | -------- | ---------------- | --------------------------------- |
| `KAFKA_ENABLED`       | No       | `false`          | Enable Kafka event streaming      |
| `KAFKA_BROKER`        | No       | `localhost:9092` | Kafka broker address              |
| `KAFKA_BROKERS`       | No       | `localhost:9092` | Comma-separated Kafka broker list |
| `KAFKA_CLIENT_ID`     | No       | `insureportal-pos`     | Kafka client identifier           |
| `KAFKA_SSL`           | No       | `false`          | Enable SSL for Kafka connections  |
| `KAFKA_SASL_USERNAME` | No       | —                | Kafka SASL username               |
| `KAFKA_SASL_PASSWORD` | No       | —                | Kafka SASL password               |

## Temporal Workflows

| Variable              | Required | Default                 | Description              |
| --------------------- | -------- | ----------------------- | ------------------------ |
| `TEMPORAL_ADDRESS`    | No       | `localhost:7233`        | Temporal gRPC address    |
| `TEMPORAL_HTTP_URL`   | No       | `http://localhost:8233` | Temporal HTTP API URL    |
| `TEMPORAL_NAMESPACE`  | No       | `default`               | Temporal namespace       |
| `TEMPORAL_TASK_QUEUE` | No       | `insureportal-tasks`          | Temporal task queue name |

## HashiCorp Vault

| Variable            | Required | Default              | Description                |
| ------------------- | -------- | -------------------- | -------------------------- |
| `VAULT_ADDR`        | No       | `http://vault:8200`  | Vault server address       |
| `VAULT_TOKEN`       | No       | —                    | Vault authentication token |
| `VAULT_ROLE_ID`     | No       | —                    | Vault AppRole role ID      |
| `VAULT_SECRET_ID`   | No       | —                    | Vault AppRole secret ID    |
| `VAULT_SECRET_PATH` | No       | `secret/data/insureportal` | Vault KV secret path       |

## Permify RBAC

| Variable            | Required | Default               | Description               |
| ------------------- | -------- | --------------------- | ------------------------- |
| `PERMIFY_URL`       | No       | `http://permify:3476` | Permify gRPC/HTTP URL     |
| `PERMIFY_TENANT_ID` | No       | `t1`                  | Permify tenant identifier |

## MinIO / S3 Storage

| Variable           | Required | Default             | Description            |
| ------------------ | -------- | ------------------- | ---------------------- |
| `MINIO_ENDPOINT`   | No       | `http://minio:9000` | MinIO/S3 endpoint URL  |
| `MINIO_ACCESS_KEY` | No       | `minioadmin`        | MinIO access key       |
| `MINIO_SECRET_KEY` | No       | `minioadmin`        | MinIO secret key       |
| `MINIO_BUCKET`     | No       | `insureportal-uploads`    | Default S3 bucket name |
| `MINIO_REGION`     | No       | `us-east-1`         | S3 region              |

## SMTP / Email

| Variable      | Required | Default             | Description                  |
| ------------- | -------- | ------------------- | ---------------------------- |
| `SMTP_HOST`   | No       | `localhost`         | SMTP server host             |
| `SMTP_PORT`   | No       | `1025`              | SMTP server port             |
| `SMTP_USER`   | No       | —                   | SMTP authentication username |
| `SMTP_PASS`   | No       | —                   | SMTP authentication password |
| `SMTP_SECURE` | No       | `false`             | Use TLS for SMTP             |
| `SMTP_FROM`   | No       | `noreply@insureportal.ng` | Default sender email address |

## SMS / Termii

| Variable         | Required | Default | Description                     |
| ---------------- | -------- | ------- | ------------------------------- |
| `TERMII_API_KEY` | No       | —       | Termii API key for SMS delivery |

## Push Notifications (VAPID)

| Variable            | Required | Default                  | Description                    |
| ------------------- | -------- | ------------------------ | ------------------------------ |
| `VAPID_PUBLIC_KEY`  | No       | Auto-generated           | VAPID public key for web push  |
| `VAPID_PRIVATE_KEY` | No       | Auto-generated           | VAPID private key for web push |
| `VAPID_SUBJECT`     | No       | `mailto:admin@insureportal.ng` | VAPID subject (email or URL)   |

## mTLS

| Variable        | Required | Default             | Description                               |
| --------------- | -------- | ------------------- | ----------------------------------------- |
| `MTLS_ENABLED`  | No       | `false`             | Enable mutual TLS for inter-service calls |
| `MTLS_CERT_DIR` | No       | `/etc/insureportal/certs` | Directory containing TLS certificates     |

## Microservices (Go/Rust/Python)

| Variable                | Required | Default                 | Description                  |
| ----------------------- | -------- | ----------------------- | ---------------------------- |
| `RESILIENCE_AGENT_URL`  | No       | `http://localhost:8031` | Go resilience agent URL      |
| `OFFLINE_QUEUE_URL`     | No       | `http://localhost:8032` | Rust offline queue URL       |
| `ANALYTICS_SERVICE_URL` | No       | `http://localhost:8033` | Python analytics service URL |

## Platform Services

| Variable                    | Required | Default                             | Description                       |
| --------------------------- | -------- | ----------------------------------- | --------------------------------- |
| `PLATFORM_BASE_URL`         | No       | `http://localhost:4000`             | Platform API gateway base URL     |
| `PLATFORM_API_KEY`          | No       | —                                   | Platform API authentication key   |
| `PLATFORM_SERVICE_TOKEN`    | No       | —                                   | Platform service-to-service token |
| `PLATFORM_FRAUD_URL`        | No       | `${PLATFORM_BASE_URL}/fraud`        | Fraud service URL                 |
| `PLATFORM_FLOAT_URL`        | No       | `${PLATFORM_BASE_URL}/float`        | Float service URL                 |
| `PLATFORM_KYC_URL`          | No       | `${PLATFORM_BASE_URL}/kyc`          | KYC service URL                   |
| `PLATFORM_SETTLEMENT_URL`   | No       | `${PLATFORM_BASE_URL}/settlement`   | Settlement service URL            |
| `PLATFORM_LOYALTY_URL`      | No       | `${PLATFORM_BASE_URL}/loyalty`      | Loyalty service URL               |
| `PLATFORM_NOTIFICATION_URL` | No       | `${PLATFORM_BASE_URL}/notification` | Notification service URL          |
| `PLATFORM_ANALYTICS_URL`    | No       | `${PLATFORM_BASE_URL}/analytics`    | Analytics service URL             |
| `PLATFORM_DISPUTE_URL`      | No       | `${PLATFORM_BASE_URL}/dispute`      | Dispute service URL               |
| `PLATFORM_GEOFENCING_URL`   | No       | `${PLATFORM_BASE_URL}/geofencing`   | Geofencing service URL            |
| `PLATFORM_VIDEO_KYC_URL`    | No       | `${PLATFORM_BASE_URL}/video-kyc`    | Video KYC service URL             |

## Observability

| Variable                      | Required | Default                      | Description                      |
| ----------------------------- | -------- | ---------------------------- | -------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No       | `http://otel-collector:4318` | OpenTelemetry collector endpoint |
| `OTEL_SERVICE_NAME`           | No       | `insureportal-pos`                 | Service name for traces          |
| `OTEL_SERVICE_VERSION`        | No       | `4.0.0`                      | Service version for traces       |
| `VITE_ANALYTICS_ENDPOINT`     | No       | —                            | Frontend analytics endpoint      |
| `VITE_ANALYTICS_WEBSITE_ID`   | No       | —                            | Frontend analytics website ID    |

## Other

| Variable                    | Required | Default                 | Description                                 |
| --------------------------- | -------- | ----------------------- | ------------------------------------------- |
| `CRON_SECRET`               | No       | —                       | Secret for authenticating cron job triggers |
| `INTERNAL_API_KEY`          | No       | —                       | Internal API authentication key             |
| `LAKEHOUSE_SERVICE_URL`     | No       | `http://localhost:8040` | Data lakehouse service URL                  |
| `LAKEHOUSE_SERVICE_TOKEN`   | No       | —                       | Lakehouse authentication token              |
| `CBN_REPORTING_SERVICE_URL` | No       | `http://localhost:8041` | CBN reporting service URL                   |
| `FLUVIO_ENDPOINT`           | No       | —                       | Fluvio streaming endpoint                   |
| `FLUVIO_HTTP_URL`           | No       | —                       | Fluvio HTTP API URL                         |
| `FLUVIO_API_KEY`            | No       | —                       | Fluvio API key                              |
| `APISIX_ADMIN_URL`          | No       | `http://apisix:9180`    | Apache APISIX admin API URL                 |
| `APISIX_ADMIN_KEY`          | No       | —                       | APISIX admin API key                        |
| `MDM_COMPLIANCE_ENGINE_URL` | No       | —                       | MDM compliance engine URL                   |
| `MDM_GEOFENCE_SERVICE_URL`  | No       | —                       | MDM geofence service URL                    |
| `MQTT_BROKER_URL`           | No       | `mqtt://localhost:1883` | MQTT broker URL for IoT                     |
| `MQTT_CLIENT_ID`            | No       | `insureportal-server`         | MQTT client identifier                      |
| `MQTT_USERNAME`             | No       | —                       | MQTT authentication username                |
| `MQTT_PASSWORD`             | No       | —                       | MQTT authentication password                |
| `POS_PRINTER_URL`           | No       | —                       | POS thermal printer URL                     |

## Multi-Currency

| Variable                | Required | Default                       | Description                              |
| ----------------------- | -------- | ----------------------------- | ---------------------------------------- |
| `DEFAULT_CURRENCY`      | No       | `NGN`                         | Default base currency code               |
| `EXCHANGE_RATE_API_URL` | No       | —                             | External exchange rate API endpoint      |
| `EXCHANGE_RATE_API_KEY` | No       | —                             | Exchange rate API authentication key     |
| `SUPPORTED_CURRENCIES`  | No       | `NGN,USD,GBP,EUR,GHS,KES,ZAR` | Comma-separated supported currency codes |

## Notification Preferences

| Variable                       | Required | Default  | Description                                                     |
| ------------------------------ | -------- | -------- | --------------------------------------------------------------- |
| `NOTIFICATION_DEFAULT_CHANNEL` | No       | `in_app` | Default notification channel (`in_app`, `sms`, `email`, `push`) |
| `NOTIFICATION_BATCH_SIZE`      | No       | `100`    | Max notifications per batch dispatch                            |

---

**Total: 98 environment variables across 18 service groups.**

> **Production minimum:** Set `DATABASE_URL`, `JWT_SECRET`, `VITE_APP_ID`, `OAUTH_SERVER_URL`, `VITE_OAUTH_PORTAL_URL`, `BUILT_IN_FORGE_API_URL`, and `BUILT_IN_FORGE_API_KEY`. All other variables have sensible defaults for development.
