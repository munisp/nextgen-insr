# ADR-005: Polyglot Microservices (Go, Rust, Python)

**Status:** Accepted  
**Date:** 2025-02-15  
**Deciders:** Engineering Leadership

## Context

The InsurePortal platform spans 370+ microservices with diverse performance, safety, and development velocity requirements. A single-language approach forces compromises: Go excels at concurrent network services but lacks Rust's memory safety guarantees for financial processing; Python's ML ecosystem is unmatched but its runtime performance is insufficient for hot-path transaction processing.

## Decision

We adopt a **polyglot microservice architecture** with language selection based on service characteristics. Go is used for API gateways, aggregation engines, and high-concurrency network services (45 services). Rust is used for financial processing, stream processing, and security-critical paths where memory safety and zero-cost abstractions are essential (25 services). Python is used for analytics pipelines, ML scoring, webhook dispatchers, and SLA monitors where development velocity and library ecosystem matter most (676 services). TypeScript serves as the frontend and tRPC backend language.

## Consequences

**Positive:** Each service uses the optimal language for its requirements. Rust's ownership model prevents entire classes of bugs in financial processing. Go's goroutines simplify concurrent API gateway logic. Python's ecosystem accelerates analytics and ML development.

**Negative:** Higher hiring bar — team must be proficient in 4 languages. Cross-language debugging is more complex. Shared libraries must be maintained in multiple languages or accessed via gRPC/HTTP. Build and CI pipeline complexity increases with each language.
