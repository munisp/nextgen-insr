# InsurePortal — Nigerian Insurance Platform

A production-grade insurance technology platform built for the Nigerian market. Covers the full insurance value chain: policy administration, claims adjudication, agent network management, KYC/AML compliance, regulatory reporting (NAICOM), and financial accounting (IFRS 17).

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    React Frontend (Vite PWA)                     │
│  115 pages • Offline-capable • Mobile-responsive                │
├─────────────────────────────────────────────────────────────────┤
│                    Express + tRPC Server                         │
│  458 routes • JWT auth • PostgreSQL • Redis • WebSocket         │
├─────────────────────────────────────────────────────────────────┤
│                    Middleware (opt-in)                            │
│  Kafka • TigerBeetle • OpenSearch • S3                          │
├─────────────────────────────────────────────────────────────────┤
│                    PostgreSQL 16 + Redis 7                        │
│  264 tables • FK constraints • Migrations                        │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 16
- Redis 7 (optional, falls back to in-memory)

### Development Setup

```bash
cd customer-portal-full

# Install dependencies
npm install

# Configure environment
cp .env.example .env   # if available, or set PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE

# Start the server (auto-runs migrations + seeds)
node server.cjs
```

The server starts at `http://localhost:5002`.

### Testing

```bash
cd customer-portal-full

# Smoke tests (22 checks)
bash smoke-test.sh

# Integration tests (42 checks)
node tests/integration.test.js
```

### Docker

```bash
cd customer-portal-full
docker compose -f docker-compose.production.yml up -d
```

## Project Structure

```
NGApp/
├── customer-portal-full/       # The entire application
│   ├── server.cjs              # Express + tRPC monolith (458 routes)
│   ├── email-templates.cjs     # HTML email templates
│   ├── migrate.cjs             # Database migration runner
│   ├── client/                 # React frontend (115 pages)
│   │   └── src/
│   │       ├── components/     # Shared UI components
│   │       └── pages/          # Page components by domain
│   ├── mobile/                 # React Native app (32 screens)
│   ├── services/               # Microservice stubs (auth, NAICOM, payments)
│   ├── tests/                  # Integration test suite
│   ├── migrations/             # SQL migrations
│   ├── infrastructure/         # Helm, monitoring configs
│   ├── smoke-test.sh           # Automated smoke tests
│   └── package.json
├── .github/workflows/          # CI/CD pipelines
├── .agents/                    # Devin skill files
└── README.md
```

## Key Features

| Domain | Features |
|--------|----------|
| **Policy Admin** | CRUD, lifecycle, renewal automation, product builder |
| **Claims** | Adjudication, fraud scoring, state machine, recovery |
| **NAICOM** | 12-item reporting schedule, bidirectional data exchange, XBRL |
| **IFRS 17** | PAA/GMM/VFA models, CSM rollforward, discount curves |
| **Reinsurance** | Treaty management, bordereaux, claims recovery |
| **Takaful** | Islamic insurance products, Sharia-compliant pools |
| **KYC/AML** | Multi-level verification, document upload, screening |
| **Agents** | Network management, commission tracking, mobile app |
| **USSD** | Multi-level menus, PIN verification, session management |
| **AI/ML** | Fraud detection, churn prediction, anomaly detection |
| **Payments** | Premium collection, payout processing, reconciliation |

## API

- **tRPC endpoints**: `POST /api/trpc/{router.procedure}`
- **Health**: `GET /health`, `GET /health/ready`
- **Metrics**: `GET /metrics`, `GET /metrics?format=prometheus`
- **OpenAPI docs**: `GET /api/docs/ui`
- **WebSocket**: `ws://localhost:5002/ws`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5002` | Server port |
| `PGHOST` | `localhost` | PostgreSQL host |
| `PGPORT` | `5432` | PostgreSQL port |
| `PGUSER` | `ngapp` | PostgreSQL user |
| `PGPASSWORD` | `ngapp` | PostgreSQL password |
| `PGDATABASE` | `ngapp` | PostgreSQL database |
| `JWT_SECRET` | (generated) | JWT signing secret |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `KAFKA_ENABLED` | `false` | Enable Kafka events |
| `TIGERBEETLE_ENABLED` | `false` | Enable TigerBeetle ledger |
| `OPENSEARCH_ENABLED` | `false` | Enable OpenSearch |
| `AUTH_STRICT` | `false` | Reject unauthenticated mutations |
