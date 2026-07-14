# InsurePortal

Pan-African insurance platform — policy management, claims adjudication, regulatory reporting (NAICOM/IFRS 17), reinsurance, KYC, and more.

## Architecture

```
customer-portal-full/
├── server.cjs          # Express + tRPC handler (421 routes, PostgreSQL)
├── client/src/         # React + TypeScript frontend (115 pages)
├── mobile/             # React Native app (32 screens)
├── tests/              # Integration tests (58 assertions)
├── email-templates.cjs # Branded HTML email templates
├── Dockerfile          # Multi-stage production image
└── docker-compose.production.yml
```

**Stack:** Node.js 22, Express, PostgreSQL, Redis, React, TypeScript, Tailwind CSS, Radix UI, tRPC (custom handler), JWT (HS256), bcrypt, Helmet.

**Optional integrations:** Kafka (event streaming), TigerBeetle (double-entry ledger), OpenSearch (full-text search), ML inference (PyTorch models via FastAPI).

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum set PGPASSWORD and JWT_SECRET

# 3. Start PostgreSQL + Redis (via Docker or local)
docker-compose -f docker-compose.production.yml up -d postgres redis

# 4. Run the server
node server.cjs
# → http://localhost:5002
```

**Demo credentials:** `demo@insureportal.ng` / `demo123`

## API

All routes are served via `/api/trpc/{route.name}` (GET for queries, POST for mutations).

- **Swagger UI:** http://localhost:5002/api/docs/ui
- **OpenAPI JSON:** http://localhost:5002/api/docs
- **Route catalog:** http://localhost:5002/api/routes
- **Health:** http://localhost:5002/health
- **Metrics:** http://localhost:5002/metrics (`?format=prometheus` for Prometheus text)

### Authentication

POST mutations require a JWT Bearer token (except public routes like `auth.login`, `auth.signup`, `products.list`). Set `AUTH_STRICT=true` to also require auth on GET routes.

```bash
# Login
curl -X POST http://localhost:5002/api/trpc/auth.login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@insureportal.ng","password":"demo123"}'

# Use the returned token
curl http://localhost:5002/api/trpc/dashboard.stats \
  -H 'Authorization: Bearer <token>'
```

## Testing

```bash
# Integration tests (requires running server)
node tests/integration.test.js

# Smoke test (22 assertions across all domains)
node tests/smoke.test.js
```

## Docker

```bash
# Build
docker build -t insureportal .

# Run
docker run -p 5002:5002 \
  -e PGHOST=host.docker.internal \
  -e JWT_SECRET=$(openssl rand -hex 64) \
  insureportal
```

## Environment Variables

See [`.env.example`](.env.example) for the full list of 49 configurable variables covering PostgreSQL, Redis, JWT, SMTP, S3, Kafka, TigerBeetle, OpenSearch, and more.

## Key Domains

| Domain | Routes | Description |
|--------|--------|-------------|
| NAICOM | 20 | Nigerian insurance regulatory reporting + data exchange |
| Reinsurance | 15 | Treaty management, cession calculations, bordereaux |
| Claims | 12 | Submission, adjudication (fraud scoring + ML), state machine |
| Payments | 12 | Gateway integration (Paystack/Flutterwave), settlements |
| Financial | 10 | Trial balance, general ledger, reconciliation |
| IFRS 17 | 8 | CSM rollforward, loss component, discount curves |
| KYC | 7 | BVN/NIN/phone verification, document upload |
| Auth | 7 | JWT login/signup, 2FA, password reset |

## License

Proprietary — InsurePortal. All rights reserved.
