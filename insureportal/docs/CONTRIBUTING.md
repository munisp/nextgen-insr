# Contributing to InsureTech

## Development Workflow

1. Create a feature branch from `main`
2. Implement changes following the conventions below
3. Run tests (`npx vitest run`)
4. Ensure build passes (`npx vite build`)
5. Submit a pull request

## Code Conventions

### TypeScript (Frontend + tRPC Server)
- React functional components with hooks
- Zod schemas for all tRPC input validation
- Shadcn/ui component library (client/src/components/ui/)
- TailwindCSS for styling
- Drizzle ORM for database queries

### Go (Microservices)
- Standard library HTTP router (chi/v5)
- Structured JSON logging
- Health endpoint at `/health`
- Metrics endpoint at `/metrics` (Prometheus)
- Environment variables for all configuration
- Build: `go build ./...`

### Python (ML Services)
- FastAPI for HTTP endpoints
- Pydantic for data validation
- pytest for testing
- Type hints required

### Rust (Security Services)
- Tokio async runtime
- Axum web framework
- Structured logging with tracing

## Testing

```bash
# Frontend tests
npx vitest run

# Single test file
npx vitest run server/routers/claims.test.ts

# Go tests
cd <service-name> && go test ./...

# Python tests
cd <service-name> && pytest
```

## Adding a New Service

1. Create directory with `main.go` + `go.mod`
2. Add health check endpoint (`/health`)
3. Add metrics endpoint (`/metrics`)
4. Add Dockerfile
5. Add to Helm values (`helm/insuretech-platform/values.yaml`)
6. Add to CI matrix (`.github/workflows/platform-ci.yml`)

## Environment Variables

All new config must be environment-variable driven. Never hardcode:
- URLs (database, redis, kafka, etc.)
- Credentials
- Feature flags
- Service ports

Add new variables to `.env.example` with documentation comments.

## Commit Messages

Follow conventional commits:
- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation
- `refactor:` — Code refactoring
- `test:` — Adding/updating tests
- `ci:` — CI/CD changes
