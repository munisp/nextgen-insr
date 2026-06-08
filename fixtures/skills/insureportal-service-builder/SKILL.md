---
name: insureportal-pos-builder
description: Build and maintain the InsurePortal POS platform — Agent Authentication, POS Terminal, Float Management, Transaction Processing, Fraud Detection, KYC Verification, Settlement, Stripe integration, and compliance features.
---

# InsurePortal POS Builder Skill

## Core Modules

- **Agent Authentication** — JWT-based login/register with Keycloak SSO
- **POS Terminal** — Multi-channel point-of-sale for agents
- **Float Management** — Agent float balance tracking and transfers
- **Transaction Processing** — Real-time transaction pipeline with TigerBeetle ledger
- **Fraud Detection** — ML-powered fraud scoring and AML screening
- **KYC Verification** — Multi-tier KYC with biometric authentication
- **Settlement** — Automated settlement cycles with reconciliation
- **Stripe** — Payment gateway integration for billing and payouts

## Stack

- TypeScript, tRPC, Express, React, Vite
- Drizzle ORM + PostgreSQL
- Redis for distributed state
- OpenTelemetry + Prometheus for observability
