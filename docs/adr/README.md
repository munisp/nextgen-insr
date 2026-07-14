# Architecture Decision Records (ADRs)

This directory contains the Architecture Decision Records for the InsurePortal POS Shell platform.

## Index

<!-- prettier-ignore -->
| ADR | Title | Status | Date |
| --- | ----- | ------ | ---- |
| [ADR-001](ADR-001-tigerbeetle-ledger.md)         | TigerBeetle for Double-Entry Ledger             | Accepted | 2025-01-15 |
| [ADR-002](ADR-002-temporal-workflows.md)         | Temporal for Billing Workflows                  | Accepted | 2025-01-20 |
| [ADR-003](ADR-003-permify-rbac.md)               | Permify for Permission-Based Access Control     | Accepted | 2025-02-01 |
| [ADR-004](ADR-004-kafka-event-sourcing.md)       | Kafka for Event Sourcing and Audit Trail        | Accepted | 2025-02-10 |
| [ADR-005](ADR-005-multi-language-services.md)    | Polyglot Microservices (Go, Rust, Python)       | Accepted | 2025-02-15 |
| [ADR-006](ADR-006-stripe-billing-integration.md) | Stripe for Payment Processing                   | Accepted | 2025-03-01 |
| [ADR-007](ADR-007-dapr-service-mesh.md)          | Dapr as Service Mesh Sidecar                    | Accepted | 2025-03-10 |
| [ADR-008](ADR-008-fluvio-streaming.md)           | Fluvio for Real-Time Data Streaming             | Accepted | 2025-03-15 |
| [ADR-009](ADR-009-mojaloop-interop.md)           | Mojaloop for Interoperability Layer             | Accepted | 2025-04-01 |
| [ADR-010](ADR-010-offline-first-resilience.md)   | Offline-First Architecture for African Networks | Accepted | 2025-04-15 |

## Template

Each ADR follows the format:

1. **Title** — Short descriptive name
2. **Status** — Proposed / Accepted / Deprecated / Superseded
3. **Context** — What is the issue that we're seeing that is motivating this decision?
4. **Decision** — What is the change that we're proposing and/or doing?
5. **Consequences** — What becomes easier or more difficult to do because of this change?
