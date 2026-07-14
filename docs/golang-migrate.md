# golang-migrate Integration for Platform Go Microservices

## Overview

The InsurePortal platform includes three Go microservices — **Fraud Service**, **Float Service**, and **Geofencing Service** — each with their own PostgreSQL schemas. This document describes how to integrate [golang-migrate](https://github.com/golang-migrate/migrate) for schema versioning and safe zero-downtime migrations.

---

## Installation

```bash
# Install the CLI
go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest

# Add as a Go module dependency
go get github.com/golang-migrate/migrate/v4
go get github.com/golang-migrate/migrate/v4/database/postgres
go get github.com/golang-migrate/migrate/v4/source/file
```

---

## Directory Structure

Each Go microservice follows the same convention:

```
services/
├── fraud-service/
│   ├── migrations/
│   │   ├── 000001_create_fraud_events.up.sql
│   │   ├── 000001_create_fraud_events.down.sql
│   │   ├── 000002_add_risk_score_index.up.sql
│   │   └── 000002_add_risk_score_index.down.sql
│   └── main.go
├── float-service/
│   ├── migrations/
│   │   ├── 000001_create_float_accounts.up.sql
│   │   └── 000001_create_float_accounts.down.sql
│   └── main.go
└── geofencing-service/
    ├── migrations/
    │   ├── 000001_create_zones.up.sql
    │   └── 000001_create_zones.down.sql
    └── main.go
```

---

## Migration File Naming

Files must follow the pattern: `{version}_{description}.{direction}.sql`

- `version`: Zero-padded 6-digit integer (e.g., `000001`)
- `description`: Snake-case description (e.g., `create_fraud_events`)
- `direction`: `up` (apply) or `down` (rollback)

---

## Programmatic Migration (Recommended)

Run migrations at service startup before accepting traffic:

```go
// internal/db/migrate.go
package db

import (
    "fmt"
    "log"

    "github.com/golang-migrate/migrate/v4"
    _ "github.com/golang-migrate/migrate/v4/database/postgres"
    _ "github.com/golang-migrate/migrate/v4/source/file"
)

// RunMigrations applies all pending up migrations.
// It is safe to call on every startup — already-applied migrations are skipped.
func RunMigrations(databaseURL string, migrationsPath string) error {
    m, err := migrate.New(
        fmt.Sprintf("file://%s", migrationsPath),
        databaseURL,
    )
    if err != nil {
        return fmt.Errorf("migrate.New: %w", err)
    }
    defer m.Close()

    if err := m.Up(); err != nil && err != migrate.ErrNoChange {
        return fmt.Errorf("migrate.Up: %w", err)
    }

    version, dirty, err := m.Version()
    if err != nil && err != migrate.ErrNilVersion {
        return fmt.Errorf("migrate.Version: %w", err)
    }
    log.Printf("[migrate] schema version=%d dirty=%v", version, dirty)
    return nil
}
```

```go
// main.go (startup sequence)
func main() {
    dbURL := os.Getenv("DATABASE_URL")
    if err := db.RunMigrations(dbURL, "./migrations"); err != nil {
        log.Fatalf("[startup] Migration failed: %v", err)
    }
    // ... start HTTP server
}
```

---

## Sample Migration Files

### Fraud Service — `000001_create_fraud_events.up.sql`

```sql
CREATE TABLE IF NOT EXISTS fraud_events (
    id          BIGSERIAL PRIMARY KEY,
    agent_id    INTEGER NOT NULL,
    tx_ref      VARCHAR(64) NOT NULL,
    risk_score  NUMERIC(5,2) NOT NULL DEFAULT 0,
    rule_id     VARCHAR(64),
    action      VARCHAR(32) NOT NULL DEFAULT 'flag',
    reviewed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fraud_events_agent_id  ON fraud_events(agent_id);
CREATE INDEX idx_fraud_events_tx_ref    ON fraud_events(tx_ref);
CREATE INDEX idx_fraud_events_created_at ON fraud_events(created_at DESC);
```

### Fraud Service — `000001_create_fraud_events.down.sql`

```sql
DROP TABLE IF EXISTS fraud_events;
```

### Float Service — `000001_create_float_accounts.up.sql`

```sql
CREATE TABLE IF NOT EXISTS float_accounts (
    id          BIGSERIAL PRIMARY KEY,
    agent_id    INTEGER NOT NULL UNIQUE,
    balance     NUMERIC(18,2) NOT NULL DEFAULT 0,
    currency    CHAR(3) NOT NULL DEFAULT 'NGN',
    locked      BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_float_accounts_agent_id ON float_accounts(agent_id);
```

### Geofencing Service — `000001_create_zones.up.sql`

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS geo_zones (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(128) NOT NULL,
    zone_type   VARCHAR(32) NOT NULL,
    polygon     GEOMETRY(POLYGON, 4326) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_geo_zones_polygon ON geo_zones USING GIST(polygon);
```

---

## CI/CD Integration

Add a migration step to the GitHub Actions workflow before deploying each Go service:

```yaml
# .github/workflows/deploy.yml (excerpt)
- name: Run fraud-service migrations
  env:
    DATABASE_URL: ${{ secrets.FRAUD_SERVICE_DATABASE_URL }}
  run: |
    migrate \
      -path services/fraud-service/migrations \
      -database "$DATABASE_URL" \
      up
```

### Rollback on Failure

```yaml
- name: Rollback fraud-service migrations on failure
  if: failure()
  env:
    DATABASE_URL: ${{ secrets.FRAUD_SERVICE_DATABASE_URL }}
  run: |
    migrate \
      -path services/fraud-service/migrations \
      -database "$DATABASE_URL" \
      down 1
```

---

## Dirty State Recovery

If a migration fails mid-execution, the schema version is marked `dirty`. Recover with:

```bash
# 1. Manually fix the partially applied migration
psql "$DATABASE_URL" -c "-- fix partial state here"

# 2. Force the version to the last clean state
migrate -path ./migrations -database "$DATABASE_URL" force <version>

# 3. Re-apply
migrate -path ./migrations -database "$DATABASE_URL" up
```

---

## Locking Strategy

golang-migrate uses an advisory lock (`pg_try_advisory_lock`) to prevent concurrent migrations. In a multi-replica deployment, only one pod will apply migrations; the others will wait and then detect `ErrNoChange`.

---

## Environment Variables

| Variable               | Description                                    |
| ---------------------- | ---------------------------------------------- |
| `DATABASE_URL`         | PostgreSQL connection string (per service)     |
| `MIGRATIONS_PATH`      | Override default `./migrations` directory      |
| `MIGRATE_LOCK_TIMEOUT` | Advisory lock timeout in seconds (default: 15) |

---

_Last updated: 2026-03-31 — Production Readiness Sprint Phase 95_
