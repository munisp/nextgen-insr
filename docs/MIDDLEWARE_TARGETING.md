# Middleware Targeting Rationale

## Why Temporal/TigerBeetle/Mojaloop Are Not on All Services

These middleware systems are **domain-specific** — wiring them to all 69+ services would be architecturally incorrect. Here's the rationale:

### TigerBeetle (Double-Entry Ledger)
**Purpose:** Financial accounting with ACID guarantees at 1M+ TPS.
**Targeted services (7):**
- `tigerbeetle-implementation` — CDC sync bridge
- `premium-collection-service` — premium receipt posting
- `multi-currency-service` — FX settlement entries
- `reinsurance-management` — treaty accounting
- `agent-commission-management` — commission payables
- `instant-payout-service` — claims disbursement
- `mobile-money-service` — mobile wallet debits/credits

**Why not all?** Services like `document-management-system`, `gamification-service`, `notification-service` don't do financial transactions. Adding TigerBeetle would create unnecessary coupling and complexity.

### Temporal (Workflow Orchestration)
**Purpose:** Long-running, durable workflows with automatic retry and compensation.
**Targeted services (8):**
- `policy-lifecycle-service` — quote→bind→renew→lapse state machine
- `claims-adjudication-engine` — FNOL→investigation→settlement saga
- `reinsurance-service` — treaty placement→acceptance→bordereaux
- `policy-renewal-automation` — bulk renewal batch processing
- `instant-payout-service` — payout approval→disbursement→reconciliation
- `batch-processing-engine` — scheduled job orchestration
- `nigerian-bank-integrations` — NIP transfer saga (debit→credit→confirm)
- `reconciliation-engine` — end-of-day settlement matching

**Why not all?** Most services are request/response only. Temporal adds operational overhead (workers, task queues, history storage). Only services with multi-step, potentially-failing processes benefit.

### Mojaloop (Payment Switch / FSPIOP)
**Purpose:** Interbank payment interoperability per Level One Project spec.
**Targeted services (4):**
- `mojaloop-connector` — FSPIOP adapter (quotes, transfers, parties)
- `instant-payout-service` — claims payout via ILP
- `premium-collection-service` — premium debit via account lookup
- `mobile-money-service` — MoMo ↔ bank interop

**Why not all?** Mojaloop is a payment protocol. Only services that initiate or receive payment transfers need it. Adding it to `gamification-service` or `disaster-recovery-module` makes no sense.

## Universal Middleware (Applied to ALL services)
These middleware systems ARE on all 69+ services because every service needs them:
- **PostgreSQL** — data persistence (69/69)
- **Keycloak** — JWT authentication (69/69)
- **Redis** — caching + rate limiting (69/69)
- **Kafka** — event publishing (69/69)
- **OpenSearch** — structured logging (69/69)
- **APISIX** — API gateway routing (184 routes)
- **OpenAppSec** — WAF protection (all ingress)
- **Permify** — authorization checks (69/69)
- **Circuit Breaker** — fault tolerance (69/69)

## Dapr, Fluvio, Lakehouse
- **Dapr** — service invocation + pub/sub (config for all, runtime for 12 high-traffic services)
- **Fluvio** — real-time streaming (12 topic groups, 56 event types)
- **Lakehouse** — analytics ETL (dedicated integration service, not per-service)
