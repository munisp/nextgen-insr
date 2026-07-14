# InsurePortal — Production Deployment Runbook

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Gap 1: Cross-Service Integration Tests](#gap-1-cross-service-integration-tests)
3. [Gap 2: Load/Stress Testing](#gap-2-loadstress-testing)
4. [Gap 3: TLS/mTLS Configuration](#gap-3-tlsmtls-configuration)
5. [Gap 4: Vault/Secrets Management](#gap-4-vaultsecrets-management)
6. [Gap 5: E2E Specialty Service Tests](#gap-5-e2e-specialty-service-tests)
7. [Full Pipeline Execution](#full-pipeline-execution)
8. [Monitoring & Observability](#monitoring--observability)
9. [Rollback Procedures](#rollback-procedures)

---

## Prerequisites

### Tools Required
```bash
go >= 1.21
k6 >= 0.45        # Load testing
openssl >= 1.1    # TLS certificate generation
vault >= 1.14     # HashiCorp Vault CLI
helm >= 3.12      # Kubernetes package manager
kubectl >= 1.27   # Kubernetes CLI
docker >= 24.0    # Container builds
psql >= 15        # PostgreSQL client
```

### Infrastructure Required
- PostgreSQL 15+ (production instance, not localhost)
- Kubernetes cluster (EKS/GKE/AKS or self-managed)
- Container registry (ECR/GCR/ACR or Docker Hub)
- DNS configured for `*.insureportal.ng`
- Load balancer (ALB/NLB/nginx-ingress)

### Environment Variables
```bash
export DATABASE_URL="postgres://user:pass@host:5432/insureportal?sslmode=require"
export KAFKA_BROKERS="broker1:9092,broker2:9092"
export REDIS_URL="redis://:password@host:6379/0"
export JWT_SECRET="$(openssl rand -hex 64)"
export ENCRYPTION_KEY="$(openssl rand -hex 32)"
export REGISTRY="your-registry.example.com/insureportal"
export IMAGE_TAG="$(git rev-parse --short HEAD)"
export KUBE_NAMESPACE="insureportal-prod"
```

---

## Gap 1: Cross-Service Integration Tests

### What It Tests
Full insurance lifecycle across 10 microservices:
1. Health checks on all 10 services
2. Create quote + underwrite (agentic-underwriting)
3. Fraud screening (fraud-detection)
4. Bind policy (policy-lifecycle)
5. Collect premium (premium-collection)
6. Reinsurance cession (reinsurance-management)
7. File claim (claims-adjudication)
8. Adjudicate claim + verify metrics
9. Process payout (instant-payout)
10. Send notification (communication)
11. Record audit trail (audit-trail)
12. Submit NAICOM regulatory report (naicom-compliance)
13. Verify stats across all services
14. Cleanup test data

### Running Locally
```bash
# Start all 10 services (adjust ports to match each service's default)
cd tests/integration
export DATABASE_URL="postgres://ubuntu:testpass123@localhost:5432/insureportal_test?sslmode=disable"
export UNDERWRITING_URL=http://localhost:9301
export POLICY_LIFECYCLE_URL=http://localhost:8097
export PREMIUM_COLLECTION_URL=http://localhost:8098
export CLAIMS_URL=http://localhost:8091
export PAYOUT_URL=http://localhost:9305
export COMMUNICATION_URL=http://localhost:8093
export AUDIT_URL=http://localhost:9307
export REINSURANCE_URL=http://localhost:9308
export NAICOM_URL=http://localhost:9309
export FRAUD_URL=http://localhost:9310

go test -v -timeout 120s -run TestFullInsuranceWorkflow
```

### Running in Staging/Production
```bash
# Use the runner script
./tests/integration/run_integration_tests.sh staging
# or
./tests/integration/run_integration_tests.sh production
```

The runner script maps service URLs to the appropriate environment:
- **staging**: `https://<service>.staging.insureportal.ng`
- **production**: `https://<service>.api.insureportal.ng`

### Expected Output
```
=== 10/10 services healthy
=== Quote created: ID=5
=== Policy bound: ID=2
=== Claim adjudicated: decision=pending_review, risk_score=40, confidence=0.75
=== Payout processed: ID=5
=== Stats: underwriting=2, policy=1, payout=4
--- PASS: TestFullInsuranceWorkflow (0.05s)
```

---

## Gap 2: Load/Stress Testing

### Scenarios
| Scenario | VUs | Duration | Purpose |
|----------|-----|----------|---------|
| Steady State | 50→100 | 18 min | Normal business hours |
| Spike | 0→200 | 3 min | Flash sale / news event |
| Soak | 30 | 30 min | Memory leak detection |

### Thresholds
| Metric | Threshold |
|--------|-----------|
| P95 response time | < 2,000ms |
| P99 response time | < 5,000ms |
| Error rate | < 5% |
| Quote creation P95 | < 3,000ms |
| Policy binding P95 | < 2,000ms |
| Claim filing P95 | < 3,000ms |
| Health check P95 | < 500ms |

### Running
```bash
# Install k6
brew install grafana/k6/k6  # macOS
# or: snap install k6       # Linux

# Local
BASE_URL=http://localhost:8080 k6 run tests/load/nationwide_load_test.js

# Staging
BASE_URL=https://api.staging.insureportal.ng k6 run tests/load/nationwide_load_test.js

# Production (reduced VUs)
BASE_URL=https://api.insureportal.ng k6 run --vus 10 --duration 5m tests/load/nationwide_load_test.js
```

### Traffic Distribution
- 30% Quote creation + underwriting
- 20% Policy binding
- 15% Claim filing
- 15% Health checks
- 10% List operations
- 10% Stats/metrics

---

## Gap 3: TLS/mTLS Configuration

### Certificate Hierarchy
```
Root CA (4096-bit, 10-year validity)
├── Server Certificates (2048-bit, 1-year, with SAN)
│   ├── underwriting.insureportal.ng
│   ├── policy-lifecycle.insureportal.ng
│   ├── ... (20 services)
│   └── enterprise-mdm.insureportal.ng
└── Client Certificates (2048-bit, 1-year)
    ├── underwriting-client
    └── ... (20 services)
```

### Setup
```bash
# Generate all certificates
./infra/tls/setup_tls.sh generate

# Validate all certificates
./infra/tls/setup_tls.sh validate

# Deploy to Kubernetes
./infra/tls/setup_tls.sh deploy

# Setup Let's Encrypt auto-renewal
./infra/tls/setup_tls.sh renew
```

### Deploying to Another Environment
```bash
# Set environment-specific vars
export CERT_DIR=/etc/insureportal/certs
export KUBE_NAMESPACE=insureportal-prod

# Generate + validate + deploy
./infra/tls/setup_tls.sh generate
./infra/tls/setup_tls.sh validate
./infra/tls/setup_tls.sh deploy
```

### Verifying TLS
```bash
# Verify server cert
openssl s_client -connect underwriting.insureportal.ng:443 -CAfile certs/ca/ca.crt

# Verify mTLS
openssl s_client -connect underwriting.insureportal.ng:443 \
  -cert certs/client/underwriting/underwriting-client.crt \
  -key certs/client/underwriting/underwriting-client.key \
  -CAfile certs/ca/ca.crt
```

---

## Gap 4: Vault/Secrets Management

### Architecture
```
Vault (HA, 3 replicas via Raft)
├── KV v2: insureportal/
│   ├── global/database     (PostgreSQL credentials)
│   ├── global/kafka        (Kafka SASL credentials)
│   ├── global/redis        (Redis credentials)
│   ├── global/jwt          (JWT signing secret)
│   ├── global/encryption   (AES-256-GCM key)
│   ├── services/<name>     (per-service API keys)
│   └── integrations/       (Paystack, Flutterwave, NAICOM)
└── Kubernetes auth method
    ├── insureportal-prod namespace
    └── insureportal-staging namespace
```

### Setup
```bash
# Initialize Vault + seed all secrets
./infra/vault/setup_vault.sh init

# Validate all secrets are accessible
./infra/vault/setup_vault.sh validate

# Deploy Vault to Kubernetes (HA mode)
./infra/vault/setup_vault.sh deploy

# Generate sidecar injection config for all services
./infra/vault/setup_vault.sh sidecar
```

### Secret Rotation
```bash
# Manual rotation
./infra/vault/setup_vault.sh rotate

# Automated (cron)
# Monthly: JWT secret + per-service API keys
# Quarterly: AES encryption key
0 2 1 * * /path/to/infra/vault/setup_vault.sh rotate
```

### Go Service Integration
Services use `shared/vault/client.go` to read secrets:
```go
import "insureportal/shared/vault"

vc := vault.New()
dbURL := vc.GetDatabaseURL()  // Falls back to DATABASE_URL env var
apiKey := vc.GetSecret("insureportal/services/underwriting", "api_key", "API_KEY")
```

---

## Gap 5: E2E Specialty Service Tests

### Services Tested
| # | Service | Domain Logic Tested |
|---|---------|-------------------|
| 1 | AI Claims | High-risk → auto_rejected, Low-risk → auto_approved |
| 2 | Parametric Insurance | Drought trigger (20mm < 50mm), Flight delay (180min > 120min) |
| 3 | Fraud Network Graph | 7 nodes + 6 edges → risk score |
| 4 | Predictive Churn | High engagement vs disengaged |
| 5 | Digital Twin | Flood simulation → estimated losses |
| 6 | Insurance-as-a-Service | Embedded product creation |
| 7 | Takaful | Sharia-compliant certificate with tabarru/investment split |
| 8 | Microinsurance | USSD-initiated crop insurance |
| 9 | USSD Gateway | Menu navigation + session tracking |
| 10 | Usage-Based Insurance | OBD telemetry → driving score |
| 11 | Enhanced KYC | BVN + NIN verification |
| 12 | NDPR Compliance | Data subject access request |

### Running
```bash
# Local
./tests/e2e/run_e2e_tests.sh local

# Staging
./tests/e2e/run_e2e_tests.sh staging

# Production
./tests/e2e/run_e2e_tests.sh production
```

---

## Full Pipeline Execution

### 10-Step Automated Pipeline
```bash
# Staging deployment (full pipeline)
./scripts/deploy/production_deploy.sh staging

# Production deployment (requires manual approval)
./scripts/deploy/production_deploy.sh production

# Preflight check only (no deployment)
./scripts/deploy/production_deploy.sh preflight

# Rollback
./scripts/deploy/production_deploy.sh rollback
```

### Pipeline Steps
| Step | Description | Duration |
|------|-------------|----------|
| 1 | Preflight checks (tools, K8s, env vars, compilation) | 2 min |
| 2 | TLS certificate generation + validation + deployment | 1 min |
| 3 | Vault initialization + secret seeding + K8s auth | 2 min |
| 4 | Docker build + push (all 76 services) | 15 min |
| 5 | Kubernetes deployment (Helm charts) | 5 min |
| 6 | Health check verification (all pods) | 3 min |
| 7 | Integration tests (14-step workflow) | 1 min |
| 8 | Load tests (k6 steady state + spike + soak) | 50 min |
| 9 | E2E specialty service tests | 5 min |
| 10 | Deployment report + next steps | 1 min |

### Deploying to a New Environment

1. **Set environment variables** (see Prerequisites)
2. **Configure Kubernetes context**: `kubectl config use-context <your-cluster>`
3. **Run preflight**: `./scripts/deploy/production_deploy.sh preflight`
4. **Deploy staging first**: `./scripts/deploy/production_deploy.sh staging`
5. **Validate staging**: Review integration + E2E test results
6. **Deploy production**: `./scripts/deploy/production_deploy.sh production`

---

## Monitoring & Observability

### Health Endpoints
Every service exposes:
- `GET /health` — Overall health + database connectivity
- `GET /ready` — Readiness probe (Kubernetes)
- `GET /live` — Liveness probe (Kubernetes)
- `GET /stats` — Service statistics (record counts, uptime)

### Prometheus Metrics
Services expose metrics at `/metrics`:
- `http_requests_total` — Request count by method/path/status
- `http_request_duration_seconds` — Latency histogram
- `db_query_duration_seconds` — Database query latency

### Alerting Rules
```yaml
# Service down
- alert: ServiceDown
  expr: up{job=~"insureportal-.*"} == 0
  for: 2m

# High error rate
- alert: HighErrorRate
  expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05

# Slow responses
- alert: SlowResponses
  expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
```

---

## Rollback Procedures

### Kubernetes Rollback
```bash
# Rollback all services
./scripts/deploy/production_deploy.sh rollback

# Rollback specific service
kubectl rollout undo deployment/underwriting -n insureportal-prod

# Check rollout status
kubectl rollout status deployment/underwriting -n insureportal-prod
```

### Database Rollback
```bash
# Restore from backup
pg_restore -h $DB_HOST -U $DB_USER -d insureportal backup/insureportal_$(date +%Y%m%d).dump

# Point-in-time recovery (if WAL archiving enabled)
pg_restore --target-time="2026-06-08 12:00:00" ...
```

### DNS Rollback
If new version has issues:
1. Update DNS to point to previous deployment
2. Scale down new deployment: `kubectl scale deployment --replicas=0 -n insureportal-prod -l version=new`
3. Scale up previous: `kubectl scale deployment --replicas=3 -n insureportal-prod -l version=previous`
