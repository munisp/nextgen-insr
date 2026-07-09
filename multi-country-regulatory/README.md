# Multi Country Regulatory

Multi-country regulatory compliance tracker

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/requirements` | List all (paginated) |
| GET | `/api/v1/requirement?id=N` | Get by ID |
| POST | `/api/v1/requirements/create` | Create new |
| DELETE | `/api/v1/requirements/delete?id=N` | Delete by ID |

### Health & Operations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (DB connectivity) |
| GET | `/ready` | Readiness probe |
| GET | `/live` | Liveness probe |
| GET | `/stats` | Service statistics |
| GET | `/metrics` | Prometheus metrics |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `PORT` | No | HTTP port (default: 8080) |
| `ALLOWED_ORIGIN` | No | CORS allowed origin |
| `JWT_SECRET` | Yes (for auth) | JWT signing secret |

## Database

Table: `regulatory_requirements`

## Production Features

- CORS with configurable origin
- Rate limiting (100 req/min per IP)
- Security headers (HSTS, CSP, X-Frame-Options)
- Graceful shutdown (SIGTERM/SIGINT)
- Connection pooling (25 max, 5 idle, 5min lifetime)
- Prometheus metrics endpoint
- Structured logging
- Input validation
- Paginated list API
