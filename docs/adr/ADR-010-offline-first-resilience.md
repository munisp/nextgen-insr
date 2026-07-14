# ADR-010: Offline-First Architecture for African Networks

**Status:** Accepted  
**Date:** 2025-04-15  
**Deciders:** Product and Engineering Teams

## Context

InsurePortal agents operate in areas with unreliable network connectivity — 2G/3G networks, frequent outages, and high latency. A traditional online-only architecture would result in failed transactions, lost revenue, and poor agent experience. The platform must function reliably even when connectivity is intermittent or completely unavailable.

## Decision

We implement an **offline-first architecture** with progressive enhancement based on network quality. The approach includes Service Worker-based caching for the web application, an offline transaction queue that syncs when connectivity returns, USSD fallback for feature phone agents, carrier-aware network switching, and SMS-based transaction confirmations as a last resort.

Key components: Service Worker with offline caching strategy, IndexedDB-based offline transaction queue, USSD integration via Africa's Talking API, network quality telemetry collection, and automatic carrier switching based on signal strength.

## Consequences

**Positive:** Agents can continue processing transactions during network outages. USSD fallback enables feature phone users to access core functionality. Automatic carrier switching optimizes connectivity. Offline queue ensures no transactions are lost.

**Negative:** Conflict resolution for offline transactions adds complexity. USSD interface is limited in functionality compared to web UI. Offline queue size must be bounded to prevent memory issues. Testing offline scenarios requires specialized tooling and network simulation.
