# InsurePortal — Production Deployment Runbook

## Overview

This runbook covers deploying the InsurePortal platform to any production-grade environment.
It addresses all 5 previously identified gaps in production readiness.

## Pre-requisites

| Tool | Version | Purpose |
|------|---------|---------|
| Go | 1.21+ | Compile microservices |
| Docker | 24+ | Container builds |
| kubectl | 1.28+ | Kubernetes management |
| Helm | 3.13+ | Chart deployments |
| k6 | 0.47+ | Load testing |
| Vault | 1.15+ | Secrets management |
| openssl | 3.0+ | TLS certificate generation |
| PostgreSQL | 15+ | Database |

## Gap 1: Cross-Service Integration Tests

### What it tests
The full insurance lifecycle across 10 services:
1. Quote creation (underwriting-engine)
2. Fraud screening (fraud-detection-go)
3. Policy binding (policy-lifecycle-service)
4. Premium collection (premium-collection-service)
5. Reinsurance cession (reinsurance-management)
6. Claim filing (claims-adjudication-engine)
7. Claim adjudication
8. Payout processing (instant-payout-service)
9. Notification dispatch (communication-service)
10. Audit trail + NAICOM reporting

### How to run

```bash
# Local
cd tests/integration
./run_integration_tests.sh local

# Staging
STAGING_DOMAIN=staging.insureportal.ng ./run_integration_tests.sh staging

# Production (read-only smoke test)
PRODUCTION_DOMAIN=api.insureportal.ng ./run_integration_tests.sh production
```

### Expected results
- All 10 services respond to health checks
- Full CRUD lifecycle completes: create quote → bind policy → collect premium → file claim → process payout
- Stats endpoints show correct counts after operations

---

## Gap 2: Load/Stress Testing

### Scenarios

| Scenario | VUs | Duration | Purpose |
|----------|-----|----------|---------|
| Steady State | 50-100 | 18 min | Normal business hours |
| Spike Test | 200 | 3 min | Natural disaster mass claims |
| Soak Test | 30 | 30 min | Sustained overnight processing |

### Thresholds

| Metric | Target |
|--------|--------|
| P95 latency | < 2,000 ms |
| P99 latency | < 5,000 ms |
| Error rate | < 5% |
| Quote creation P95 | < 3,000 ms |
| Health check P95 | < 500 ms |

### How to run

```bash
# Install k6
# Ubuntu: sudo gpg -k && sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D68 && echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list && sudo apt-get update && sudo apt-get install k6
# macOS: brew install k6

# Run against local
k6 run --env ENV=local tests/load/nationwide_load_test.js

# Run against staging
k6 run --env ENV=staging --env DOMAIN=staging.insureportal.ng tests/load/nationwide_load_test.js

# Shorter smoke test (5 minutes)
k6 run --env ENV=local --duration 5m --vus 10 tests/load/nationwide_load_test.js
```

---

## Gap 3: TLS/mTLS Configuration

### Certificate hierarchy

```
Root CA (self-signed, 10-year validity)
├── Server certificates (per-service, 1-year, with SAN)
│   ├── underwriting.insureportal.ng
│   ├── policy.insureportal.ng
│   └── ... (20 services)
└── Client certificates (per-service, 1-year, for mTLS)
    ├── underwriting-client
    ├── policy-client
    └── ... (20 services)
```

### How to set up

```bash
# Generate all certificates
cd infra/tls
chmod +x setup_tls.sh
./setup_tls.sh generate

# Validate certificates
./setup_tls.sh validate

# Deploy to Kubernetes
./setup_tls.sh deploy

# Set up Let's Encrypt for production
DOMAIN=insureportal.ng ./setup_tls.sh renew
kubectl apply -f certs/cert-manager-issuer.yaml
```

### For production environments
1. Install cert-manager: `kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml`
2. Configure DNS for `*.insureportal.ng` pointing to your load balancer
3. Run `./setup_tls.sh renew` to generate Let's Encrypt issuer
4. Apply: `kubectl apply -f certs/cert-manager-issuer.yaml`

---

## Gap 4: Vault/Secrets Management

### Secret categories

| Category | Path | Contents |
|----------|------|----------|
| Database | `insureportal/global/database` | Host, port, credentials, pool config |
| Kafka | `insureportal/global/kafka` | Brokers, SASL credentials |
| Redis | `insureportal/global/redis` | Host, password, TLS config |
| JWT | `insureportal/global/jwt` | Secret, issuer, TTL |
| Encryption | `insureportal/global/encryption` | AES-256-GCM key |
| Per-service | `insureportal/services/<name>` | API keys, service accounts |
| Integrations | `insureportal/integrations/<name>` | Paystack, Flutterwave, NAICOM |

### How to set up

```bash
# Initialize Vault and seed secrets
cd infra/vault
chmod +x setup_vault.sh
export VAULT_ADDR=http://127.0.0.1:8200
export VAULT_TOKEN=<your-root-token>

./setup_vault.sh init

# Validate all secrets are stored
./setup_vault.sh validate

# Rotate secrets
./setup_vault.sh rotate

# Deploy Vault to Kubernetes (HA mode with 3 replicas)
./setup_vault.sh deploy

# Generate sidecar injection annotations for each service
./setup_vault.sh sidecar
```

### Secret rotation schedule

| Secret Type | Rotation Frequency | Automated |
|-------------|-------------------|-----------|
| JWT secret | Monthly | Yes (via cron) |
| AES encryption key | Quarterly | Yes |
| Per-service API keys | Monthly | Yes |
| Database password | Quarterly | Manual |
| Payment gateway keys | Annual | Manual |

---

## Gap 5: E2E Specialty Service Testing

### Services tested

| Service | Test Type | Key Assertions |
|---------|-----------|---------------|
| AI Claims Auto-Adjudication | ML risk scoring | High-risk → rejected, low-risk → approved |
| Parametric Insurance | Trigger evaluation | Drought (20mm < 50mm) → triggered, normal rain → not triggered |
| Fraud Network Graph | Graph analysis | 7 nodes, 6 edges → risk score calculated |
| Predictive Churn | ML prediction | High churn risk for disengaged customers |
| Digital Twin Risk | Simulation | Flood scenario → estimated losses |
| Insurance-as-a-Service | Partner API | Embedded product creation |
| Takaful Module | Sharia-compliant | Certificate with tabarru/investment split |
| Microinsurance | Mobile-first | USSD-initiated crop insurance |
| USSD Gateway | Session management | Menu navigation, session tracking |
| Usage-Based Insurance | IoT telemetry | OBD device data → driving score |
| Enhanced KYC/KYB | Identity verification | BVN + NIN verification |
| NDPR Compliance | Data rights | Subject access request processing |

### How to run

```bash
# Local
cd tests/e2e
./run_e2e_tests.sh local

# Staging
STAGING_DOMAIN=staging.insureportal.ng ./run_e2e_tests.sh staging
```

---

## Full Deployment Pipeline

```bash
# 1. Pre-flight checks (no deployment)
./scripts/deploy/production_deploy.sh preflight

# 2. Deploy to staging
./scripts/deploy/production_deploy.sh staging

# 3. After staging validation, deploy to production
./scripts/deploy/production_deploy.sh production

# 4. If issues arise, rollback
./scripts/deploy/production_deploy.sh rollback
```

### Pipeline steps (automated)
1. Pre-flight checks (tools, connectivity, secrets)
2. TLS certificate generation + validation
3. Vault initialization + secret seeding
4. Docker image builds + registry push
5. Kubernetes deployment via Helm
6. Health verification (all pods ready)
7. Integration tests (cross-service workflow)
8. Load tests (k6 nationwide simulation)
9. E2E specialty service tests
10. Post-deployment report

---

## Monitoring

### Grafana dashboards
- System health: CPU, memory, request rates
- Agent operations: field agent device metrics
- Fraud detection: real-time alert rates
- CBN compliance: regulatory reporting status

### Alerting rules (Prometheus)
- Service down > 30s → PagerDuty
- Error rate > 5% → Slack
- P95 latency > 3s → Slack
- Database connection pool exhausted → PagerDuty
- Certificate expiry < 30 days → Email

---

## Rollback procedure

```bash
# Automatic rollback (reverts all deployments to previous revision)
./scripts/deploy/production_deploy.sh rollback

# Manual rollback for specific service
kubectl rollout undo deployment/<service-name> -n insureportal-prod

# Check rollback status
kubectl rollout status deployment/<service-name> -n insureportal-prod

# View revision history
kubectl rollout history deployment/<service-name> -n insureportal-prod
```
