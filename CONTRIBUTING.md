# Contributing to InsurePortal Agency Banking Platform

## Development Setup

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Run linting
pnpm lint

# Run type checking
pnpm typecheck

# Run tests
pnpm test
```

## Architecture

- **`server/`** — tRPC routers (TypeScript)
- **`client/`** — React frontend (TypeScript, Vite)
- **`services/go/`** — Go microservices (auth, circuit breaker, backup)
- **`services/rust/`** — Rust microservices (sanctions ETL)
- **`services/python/`** — Python microservices (analytics, ML, webhooks, archival)
- **`infra/`** — Infrastructure configs (APISIX, Redis, Helm, Terraform)
- **`drizzle/`** — Database schema and migrations

## Coding Standards

### TypeScript

- No `@ts-nocheck` or `as any` — fix the types properly
- Use Drizzle ORM for all database queries (no raw SQL, no in-memory arrays)
- Use `crypto.randomUUID()` for ID generation (never `Date.now()` or `Math.random()`)
- Import the structured logger from `server/_core/logger.ts`
- Use `auditLog()` for all mutation procedures

### Go / Rust / Python

- Follow idiomatic conventions for each language
- All services must expose a `/health` endpoint
- Externalize state to Redis (no in-memory maps for production state)
- Use structured JSON logging

### Git Workflow

1. Create a feature branch from `main`
2. Make focused, minimal changes
3. Run `pnpm lint && pnpm typecheck` before committing
4. Open a PR with a descriptive title
5. Wait for CI to pass

## Adding a New Router

```bash
# 1. Create the router file
touch server/routers/myFeature.ts

# 2. Register in server/routers/index.ts (appRouter)

# 3. Use protectedProcedure or adminProcedure from server/_core/trpc.ts

# 4. Use Drizzle ORM for database access:
#    import { db } from "../db";
#    import { myTable } from "@shared/schema";
```

## Adding a New Microservice

### Go

```bash
mkdir -p services/go/my-service
# Create main.go, go.mod, Dockerfile
# Register in infra/apisix/ for routing
# Add health check to platformHealth.ts service registry
```

### Python

```bash
mkdir -p services/python/my-service
# Create main.py, requirements.txt, Dockerfile
# Use FastAPI with /health endpoint
```

### Rust

```bash
mkdir -p services/rust/my-service
# Create src/main.rs, Cargo.toml, Dockerfile
# Use actix-web with /health endpoint
```
