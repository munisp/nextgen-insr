# ADR-009: Mojaloop for Interoperability Layer

**Status:** Accepted  
**Date:** 2025-04-01  
**Deciders:** Product and Compliance Teams

## Context

The InsurePortal platform operates across multiple African markets where interoperability between mobile money providers, banks, and agent networks is critical. Each market has different payment rails, regulatory requirements, and settlement mechanisms. Building point-to-point integrations with each provider is unsustainable.

## Decision

We integrate **Mojaloop** as the interoperability layer for cross-network settlement and payment routing. Mojaloop implements the Level One Project's Interoperability API specification, providing standardized interfaces for participant discovery, quoting, transfers, and settlement across heterogeneous payment systems.

The settlement-gateway (Go) service acts as the bridge between our billing engine and Mojaloop's transfer API, handling currency conversion, fee calculation, and settlement finality confirmation.

## Consequences

**Positive:** Standardized API reduces per-provider integration effort. Built-in settlement and clearing mechanisms. Regulatory compliance with Level One Project specifications. Supports both real-time and batch settlement modes.

**Negative:** Mojaloop's architecture is complex with many moving parts (Central Ledger, Central Settlement, Account Lookup Service). Limited commercial support options. Performance tuning requires deep understanding of the platform. Not all African payment providers support Mojaloop natively.
