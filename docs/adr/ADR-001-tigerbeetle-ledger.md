# ADR-001: TigerBeetle for Double-Entry Ledger

**Status:** Accepted  
**Date:** 2025-01-15  
**Deciders:** Platform Architecture Team

## Context

The InsurePortal billing engine requires a high-performance, ACID-compliant double-entry ledger capable of processing millions of financial transactions per day across multiple tenants. Traditional RDBMS solutions (PostgreSQL) struggle with the write throughput required for real-time settlement processing, while NoSQL databases lack the strict consistency guarantees needed for financial data.

Key requirements:

- Sub-millisecond transaction posting latency
- Strict double-entry accounting invariants (debits = credits)
- Multi-tenant isolation with per-tenant account namespaces
- Audit-grade immutability — no UPDATE or DELETE on posted entries
- Horizontal scalability to 10M+ transactions/day

## Decision

We adopt **TigerBeetle** as the dedicated financial ledger engine for all billing transactions. TigerBeetle is purpose-built for financial accounting with deterministic execution, built-in double-entry validation, and io_uring-based I/O for extreme throughput.

Integration approach:

- TigerBeetle handles all ledger postings (debits, credits, transfers)
- PostgreSQL stores billing metadata (invoices, configs, audit logs)
- A Rust `ledger-integrity-validator` service continuously reconciles TigerBeetle state against PostgreSQL
- Go `billing-aggregation-engine` aggregates ledger data for dashboards

## Consequences

**Positive:**

- 1M+ TPS on commodity hardware — far exceeds our throughput needs
- Built-in double-entry validation eliminates application-level balance checks
- Deterministic execution guarantees identical results on replay
- Immutable by design — satisfies audit and compliance requirements

**Negative:**

- Additional operational complexity (separate cluster to manage)
- Limited query flexibility — complex analytics must go through PostgreSQL
- Smaller ecosystem compared to PostgreSQL — fewer tools and community resources
- Team must learn TigerBeetle's unique data model (accounts, transfers, not SQL)
