# InsureTech Platform Architecture

## Overview

InsureTech is a polyglot microservices platform for the Nigerian insurance industry. It comprises:

- **Frontend**: React + Vite PWA (533 pages, offline-capable)
- **API Layer**: tRPC server with 454 routers providing type-safe RPC
- **Backend**: 81 Go microservices, 2 Rust services, 2 Python ML services
- **Middleware**: 12 infrastructure components (Postgres, Redis, Kafka, Temporal, etc.)

## Design Principles

1. **Domain-Driven Design** — Each microservice owns a bounded context (claims, policies, agents, KYC)
2. **Event Sourcing** — Kafka for async communication between services
3. **CQRS** — Separate read/write paths for high-throughput domains
4. **Workflow Orchestration** — Temporal for long-running processes (claims, DR, onboarding)
5. **Zero Trust** — mTLS between services, Permify for authorization, Keycloak for identity
6. **Observability First** — OpenTelemetry traces, Prometheus metrics, structured logging

## Component Interactions

```
User → APISIX Gateway → tRPC Server → Go Microservices
                                    ↕
                              PostgreSQL (state)
                              Redis (cache/sessions)
                              Kafka (events)
                              Temporal (workflows)
                              OpenSearch (search/logs)
```

### Request Flow

1. User interacts with React PWA
2. tRPC client sends typed request to server
3. Server router validates input (Zod schema)
4. Router calls domain service (db.ts for queries, or HTTP to Go service)
5. Go service processes business logic
6. Events published to Kafka for downstream consumers
7. Response flows back through tRPC to client

### Event-Driven Flows

- **Claims Submission** → Kafka `claims.submitted` → Fraud Detection → Adjudication → Notification
- **Policy Issuance** → Kafka `policy.issued` → TigerBeetle (ledger) → Agent Commission → Notification
- **KYC Verification** → Temporal workflow → NIN/BVN check → Risk scoring → Approval/Rejection

## Service Communication Patterns

| Pattern | Usage | Example |
|---------|-------|---------|
| Synchronous (HTTP) | Real-time queries | Frontend → tRPC → DB |
| Async (Kafka) | Event propagation | Claims → Fraud → Notification |
| Workflow (Temporal) | Long-running processes | DR failover, onboarding |
| Pub/Sub (Dapr) | Service mesh messaging | Config changes, cache invalidation |
| Streaming (Fluvio) | Real-time ML features | Transaction velocity, fraud signals |

## Data Architecture

### Primary Store (PostgreSQL)
- 56 tables covering all insurance domains
- Drizzle ORM for type-safe queries
- Row-level security for multi-tenancy
- Connection pooling via PgBouncer in production

### Caching Layer (Redis)
- Session storage (Keycloak tokens)
- Rate limiting counters
- Real-time leaderboards (gamification)
- USSD session state
- Pub/sub for WebSocket updates

### Event Store (Kafka)
- Topics per domain (claims.*, policy.*, agent.*, kyc.*)
- Retention: 7 days (hot), 30 days (warm), S3 (cold)
- Consumer groups per service
- Dead letter queues for failed processing

### Search & Analytics (OpenSearch)
- Full-text search across policies, claims, agents
- Log aggregation and analysis
- SIEM event correlation (security-operations service)
- Dashboard data for executive command center

### Financial Ledger (TigerBeetle)
- Double-entry accounting for all financial transactions
- Premium payments, claims payouts, agent commissions
- Immutable audit trail
- High-throughput transaction processing

## Security Architecture

### Authentication (Keycloak)
- SSO with OIDC/OAuth2
- Multi-factor authentication
- Role-based access control (RBAC)
- Realm per tenant (multi-tenancy)

### Authorization (Permify)
- Attribute-based access control (ABAC)
- Fine-grained permissions per resource
- Policy as code
- Real-time permission checks

### Network Security
- Default-deny network policies
- mTLS between all services (zero-trust-network service)
- APISIX gateway with rate limiting and WAF
- OpenAppSec for application-layer protection

## Deployment Architecture

### Kubernetes (Production)
- Helm chart deploys all 81+ services
- HorizontalPodAutoscaler per service (CPU/memory targets)
- PodDisruptionBudgets (min 1 available)
- TopologySpreadConstraints (zone distribution)
- Network policies (service-to-service isolation)

### Monitoring Stack
- **Prometheus** — Metrics collection (30-day retention)
- **Grafana** — Dashboards (service health, business KPIs)
- **OpenTelemetry Collector** — Distributed tracing + log aggregation
- **Alertmanager** — Slack + PagerDuty alerting

### Disaster Recovery
- RPO: 1 hour (database point-in-time recovery)
- RTO: 15 minutes (automated failover via Temporal workflow)
- Multi-AZ deployment
- Automated health probes and failover triggers

## Scaling Strategy

| Component | Scaling Method | Trigger |
|-----------|---------------|---------|
| Frontend | HPA (CPU 70%) | 3-10 replicas |
| API Gateway | HPA (connections) | 2-8 replicas |
| Go services | HPA (CPU 75%) | 2-8 replicas |
| PostgreSQL | Read replicas + PgBouncer | Connection count |
| Redis | Cluster mode | Memory usage |
| Kafka | Partition increase | Consumer lag |

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Frontend framework | React + Vite | Developer ecosystem, PWA support |
| API protocol | tRPC | End-to-end type safety |
| Backend language | Go (primary) | Performance, concurrency, deployment simplicity |
| Security services | Rust | Memory safety for critical paths |
| ML services | Python | ML ecosystem (PyTorch, scikit-learn) |
| Database | PostgreSQL | ACID, JSON support, extensions |
| Message broker | Kafka | Durability, ordering, replay |
| Workflow engine | Temporal | Reliability, visibility, versioning |
| Identity | Keycloak | Standards-compliant, self-hosted |
| API Gateway | APISIX | High performance, plugin ecosystem |
