# NGApp — Nigerian Insurance Platform

A comprehensive, production-grade insurance technology platform built for the Nigerian market. Covers the full insurance value chain: policy administration, claims adjudication, agent network management, KYC/AML compliance, regulatory reporting (NAICOM), and financial accounting (IFRS 17).

## Repository status

- **Canonical layout:** the application lives at the repository root — `client/` (React/Vite frontend), `server/` (tRPC/Express backend), `drizzle/` (schema/migrations). The nested `insureportal/` directory is a deprecated, reference-only duplicate and must not be deployed (see `insureportal/README-DEPRECATED.md`).
- **Build commands:** `pnpm install --frozen-lockfile` then `pnpm build` from the repo root.
- **Verified state (latest build verification):** `pnpm build` is green; Go services compile ~130+/140 (`go build ./...` per service); Rust crates pass `cargo check` 22/22; Python checks clean. Remaining known issues are concentrated in a few `server/insurance-journeys-*.ts` TypeScript files.
- **Audit trail:** see `AUDIT_REPORT.md`, `SECURITY_AUDIT_REPORT.md`, and the `test-report-*.md` / `PRODUCTION_READINESS_REPORT.md` files at the repo root for detailed findings.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Customer Portal (React/Vite)              │
│  533 pages • PWA • Offline-capable • WCAG 2.1 AA                │
├─────────────────────────────────────────────────────────────────┤
│                     API Gateway (APISIX)                          │
│  Rate limiting • Auth • Request routing                          │
├────────────────┬────────────────────────────────────────────────┤
│  tRPC Server   │              Go Microservices (81)              │
│  454 routers   │  Claims • Policies • Agents • KYC • Fraud      │
│  TypeScript    │  NAICOM • IFRS17 • DR/BCP • MDM • USSD        │
├────────────────┴────────────────────────────────────────────────┤
│                     Middleware Layer                              │
│  PostgreSQL • Redis • Kafka • Temporal • Keycloak • OpenSearch  │
│  Permify • TigerBeetle • Mojaloop • APISIX • Fluvio • Dapr     │
├─────────────────────────────────────────────────────────────────┤
│                     Infrastructure                                │
│  Kubernetes • Helm • Docker • Prometheus • OpenTelemetry         │
│  Grafana • Network Policies • HPA • PDB                         │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- Go 1.22+
- Python 3.11+
- Docker & Docker Compose
- PostgreSQL 16, Redis 7, Kafka 3.7

### Development Setup

```bash
# Clone the repository
git clone https://github.com/munisp/NGApp.git
cd NGApp

# Install frontend dependencies
npm install

# Copy environment configuration
cp .env.example .env
# Edit .env with your local database/redis URLs

# Start middleware (Postgres, Redis, Kafka, etc.)
docker compose -f deploy/staging/docker-compose.staging.yml up -d

# Seed the database
node server/seed-comprehensive.mjs

# Start the development server
npm run dev
```

### Build

```bash
# Frontend build
npx vite build

# Go services (example)
cd claims-adjudication-engine && go build ./...

# All Go services
for svc in $(find . -name "go.mod" -exec dirname {} \;); do
  (cd "$svc" && GONOSUMCHECK=* GOFLAGS=-mod=mod go build ./...)
done
```

### Testing

```bash
# Frontend unit tests (vitest)
npx vitest run

# Go tests
cd tigerbeetle-implementation && go test ./...

# Integration tests (requires running backend)
npx vitest run tests/integration/
```

## Project Structure

```
NGApp/
├── client/src/           # React frontend (533 pages)
│   ├── components/       # Shared UI components
│   ├── pages/            # Page components by domain
│   └── _core/            # Core hooks and utilities
├── server/               # tRPC backend
│   ├── routers/          # 454 tRPC routers (domain logic)
│   ├── middleware/       # Security, observability, settlements
│   ├── lib/              # Shared utilities
│   └── db.ts             # Drizzle ORM database layer
├── [81 Go services]/     # Microservices (see below)
├── shared/               # Shared libraries
│   └── observability/    # Prometheus metrics + OpenTelemetry
├── helm/                 # Kubernetes Helm chart
├── monitoring/           # Prometheus, Grafana, OTel configs
├── deploy/               # Deployment configurations
│   └── staging/          # Docker Compose staging environment
├── .github/workflows/    # CI/CD (build + security scanning)
└── docs/                 # Architecture and deployment docs
```

## Microservices

### Core Insurance (Go)

| Service | Description | Port |
|---------|-------------|------|
| claims-adjudication-engine | Automated claims processing with CBN rules | 8090 |
| disaster-recovery-module | DR/BCP with Temporal orchestration | 8091 |
| naicom-compliance-module | Automated NAICOM regulatory reporting | 8092 |
| ussd-gateway | USSD service for 36-state rollout | 8093 |
| enterprise-mdm | Master data management | 8094 |
| api-marketplace | Developer API portal with TigerBeetle billing | 8095 |
| it-governance-itsm | ITSM with Dapr/Temporal | 8096 |
| agent-network-platform | Agent management and commissions | 8097 |
| enhanced-kyc-kyb | KYC/KYB with NIN/BVN verification | 8101 |
| fraud-detection-go | Real-time fraud detection | 8102 |
| microinsurance-engine | Micro/parametric insurance products | 8105 |
| notification-service | Multi-channel notifications | 8107 |

### Security (Rust)

| Service | Description | Port |
|---------|-------------|------|
| security-operations | SIEM with OpenSearch + threat detection | 8130 |
| zero-trust-network | mTLS + policy enforcement via Permify | 8131 |

### AI/ML (Python)

| Service | Description | Port |
|---------|-------------|------|
| ifrs17-engine | IFRS 17 compliance calculations | 8140 |
| mlops-governance | Model registry + drift monitoring | 8141 |

## Middleware Stack

| Component | Purpose | Default Port |
|-----------|---------|------|
| PostgreSQL 16 | Primary datastore | 5432 |
| Redis 7 | Caching, sessions, rate limiting | 6379 |
| Kafka (KRaft) | Event streaming, async processing | 9092 |
| Temporal 1.23 | Workflow orchestration (DR, claims, ITSM) | 7233 |
| Keycloak | Identity & access management (SSO, RBAC) | 8080 |
| OpenSearch 2.11 | Full-text search, log analytics, SIEM | 9200 |
| Permify | Fine-grained authorization (ABAC/RBAC) | 3476 |
| TigerBeetle | Financial ledger (double-entry accounting) | 3000 |
| Mojaloop | Mobile money interop (payments) | 3001 |
| APISIX | API gateway (rate limiting, auth, routing) | 9080 |
| Fluvio | Real-time data streaming (ML features) | 9003 |
| Dapr | Service mesh, pub/sub, state management | 3500 |

## Deployment

### Staging (Docker Compose)

```bash
docker compose -f deploy/staging/docker-compose.staging.yml up -d
```

### Production (Kubernetes + Helm)

```bash
# Install the platform
helm install ngapp helm/ngapp-platform/ \
  -f helm/ngapp-platform/values.yaml \
  -n ngapp --create-namespace

# Install monitoring stack
helm install monitoring prometheus-community/kube-prometheus-stack \
  -f monitoring/prometheus-values.yaml \
  -n observability --create-namespace
```

### Environment Variables

All configuration is externalized via environment variables. See `.env.example` for the complete list (317 variables). Key categories:

- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `KAFKA_BROKERS` — Kafka broker addresses
- `KEYCLOAK_*` — Identity provider configuration
- `TEMPORAL_*` — Workflow engine configuration
- `OPENSEARCH_*` — Search/analytics configuration

## CI/CD

Two GitHub Actions workflows:

1. **platform-ci.yml** — Builds and tests all services
   - 50 Go services (matrix build)
   - 2 Python services (pytest)
   - Shared package validation

2. **security-scan.yml** — Security scanning
   - govulncheck (Go vulnerabilities)
   - Semgrep (SAST)
   - gitleaks (secret scanning)
   - License compliance

## Security

- Keycloak SSO with RBAC
- Zero-trust network with mTLS (Rust service)
- Permify fine-grained authorization
- AML/KYC compliance (NIN, BVN verification)
- NDPR/GDPR data protection
- Secret scanning in CI
- Network policies (default deny)

## Regulatory Compliance

- **NAICOM** — Nigerian insurance regulator (automated quarterly returns)
- **CBN** — Central Bank of Nigeria (AML rules, payment processing)
- **NDPR** — Nigeria Data Protection Regulation
- **IFRS 17** — International Financial Reporting Standard
- **GDPR** — General Data Protection Regulation

## License

Proprietary. All rights reserved.
