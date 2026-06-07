# InsurePortal Agency Banking Platform — Production Deployment Checklist

> Version: Phase 163 | Last updated: April 2026

---

## Pre-Deployment

### Secrets & Environment Variables

- [ ] Rotate all default passwords in `.env.production` before first deploy
- [ ] Generate fresh VAPID keys: `npx web-push generate-vapid-keys`
- [ ] Set `TERMII_API_KEY` to your production Termii API key
- [ ] Set `JWT_SECRET` to a 64+ character random string
- [ ] Set `SESSION_SECRET` to a 32+ character random string
- [ ] Set `POSTGRES_PASSWORD` to a strong unique password
- [ ] Set `REDIS_PASSWORD` to a strong unique password
- [ ] Set `KEYCLOAK_ADMIN_PASSWORD` and `KEYCLOAK_CLIENT_SECRET`
- [ ] Set `VAULT_ROOT_TOKEN` and `VAULT_APP_TOKEN`
- [ ] Set `SMTP_PASS` to your email app password
- [ ] Set `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID`
- [ ] Set `SLACK_WEBHOOK_URL` for operational alerts
- [ ] Set `SENTRY_DSN` for error tracking
- [ ] Set `SMILE_IDENTITY_API_KEY` and `SMILE_IDENTITY_PARTNER_ID` for KYC

### Database

- [ ] Run `pnpm db:push` to apply all schema migrations
- [ ] Run `pnpm db:seed` to populate demo/initial data
- [ ] Verify database connection with `pnpm db:push` (should report no changes)
- [ ] Set up automated daily backups (pg_dump → S3)
- [ ] Test restore procedure from backup

### Infrastructure

- [ ] Deploy PostgreSQL with replication (primary + 1 replica minimum)
- [ ] Deploy Redis with persistence enabled (`appendonly yes`)
- [ ] Deploy Kafka with 3 brokers for production reliability
- [ ] Deploy TigerBeetle 3-node cluster for ledger
- [ ] Deploy MinIO with erasure coding (4+ nodes)
- [ ] Configure nginx reverse proxy with SSL termination
- [ ] Set up Keycloak realm and import `keycloak-realm.json`
- [ ] Initialize HashiCorp Vault and unseal
- [ ] Configure APISix routes and rate limiting

### Security

- [ ] Enable HTTPS/TLS for all external endpoints
- [ ] Configure CORS to allow only your production domain
- [ ] Enable mTLS for service-to-service communication (`MTLS_ENABLED=true`)
- [ ] Set up WAF (Web Application Firewall) rules
- [ ] Enable rate limiting (`RATE_LIMIT_MAX_REQUESTS=100`)
- [ ] Rotate all default API keys and secrets
- [ ] Audit all `admin` role users in the database
- [ ] Enable audit logging for all financial transactions
- [ ] Configure CBN reporting schedule (`SETTLEMENT_CRON`)

### Monitoring & Observability

- [ ] Deploy Grafana + Prometheus stack
- [ ] Import InsurePortal Grafana dashboards from `monitoring/dashboards/`
- [ ] Configure PagerDuty integration for critical alerts
- [ ] Set up OpenTelemetry collector (`OTEL_EXPORTER_OTLP_ENDPOINT`)
- [ ] Configure Sentry error tracking (`SENTRY_DSN`)
- [ ] Set up log aggregation (ELK or Loki)
- [ ] Configure uptime monitoring for `/api/health` endpoint

---

## Deployment Steps

### 1. Build

```bash
pnpm install
pnpm build
```

### 2. Database Migration

```bash
pnpm db:push
pnpm db:seed
```

### 3. Start Services

```bash
# Using Docker Compose (recommended)
docker-compose -f docker-compose.yml up -d

# Or directly
NODE_ENV=production node dist/index.js
```

### 4. Health Check

```bash
curl https://your-domain.com/api/health
# Expected: { "status": "ok", "services": { ... } }
```

### 5. Smoke Tests

- [ ] Login with test agent credentials
- [ ] Perform a cash-in transaction
- [ ] Perform a cash-out transaction
- [ ] Send an airtime purchase
- [ ] Verify OTP SMS delivery via Termii
- [ ] Check push notification delivery
- [ ] Verify CBN report generation
- [ ] Test fraud alert triggering
- [ ] Verify settlement cron runs at 23:00

---

## Post-Deployment

- [ ] Monitor error rates in Sentry for 24 hours
- [ ] Verify all Kafka consumers are processing messages
- [ ] Check TigerBeetle cluster health
- [ ] Verify Temporal workflow workers are running
- [ ] Run integration test suite: `pnpm test:integration`
- [ ] Notify CBN of go-live date
- [ ] Update DNS records to point to production servers
- [ ] Enable CDN caching for static assets
- [ ] Set `OTEL_TRACES_SAMPLER_RATIO=0.1` (10% sampling in production)

---

## Rollback Plan

1. Keep the previous Docker image tagged as `insureportal-pos:previous`
2. Database rollback: restore from pre-deployment backup
3. Run: `docker-compose down && docker-compose -f docker-compose.previous.yml up -d`
4. Verify health endpoint returns 200
5. Notify team via Slack `#deployments` channel

---

## Contacts

| Role           | Contact              |
| -------------- | -------------------- |
| Platform Lead  | platform@insureportal.ng   |
| DevOps         | devops@insureportal.ng     |
| CBN Compliance | compliance@insureportal.ng |
| Security       | security@insureportal.ng   |
| On-call        | pagerduty@insureportal.ng  |
