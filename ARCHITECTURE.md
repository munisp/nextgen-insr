# InsurePortal Insurance Platform — System Architecture

> Version: Phase 163 | Last updated: April 2026

---

## Overview

InsurePortal is a full-stack insurance platform built for Nigerian financial institutions. It provides a Point-of-Sale (POS) shell, multi-portal admin system, mobile apps (Flutter + React Native), and a microservices backend. The platform is CBN-compliant and supports premium collection/claim payout, airtime, bill payments, FX transfers, KYC, fraud detection, and USSD.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  POSShell    │  │ AdminPanel   │  │ Flutter App  │  │  RN App      │    │
│  │  (React PWA) │  │ (React SPA)  │  │ (iOS/Android)│  │ (iOS/Android)│    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
└─────────┼─────────────────┼─────────────────┼─────────────────┼────────────┘
          │                 │                 │                 │
          └─────────────────┴────────┬────────┴─────────────────┘
                                     │ HTTPS / tRPC / REST
┌────────────────────────────────────▼────────────────────────────────────────┐
│                          API GATEWAY (APISix)                                │
│  Rate limiting · JWT validation · mTLS · Request routing · Analytics        │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────────┐
│                          CORE BACKEND (Node.js + tRPC)                       │
│                                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Auth Router  │  │ Transaction  │  │  Float Mgmt  │  │  MDM Router  │    │
│  │ (Manus OAuth)│  │   Router     │  │   Router     │  │  (OTA/Geo)   │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Customer     │  │ Developer    │  │  Management  │  │  Resilience  │    │
│  │   Router     │  │   Portal     │  │   Router     │  │   Router     │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ GDPR Router  │  │  Platform    │  │  Analytics   │  │  Chat Router │    │
│  │  (DPO/DSAR)  │  │  Proxy       │  │   Router     │  │  (Support)   │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
          │                 │                 │                 │
┌─────────▼─────┐  ┌────────▼──────┐  ┌──────▼───────┐  ┌────▼──────────────┐
│  PostgreSQL   │  │  TigerBeetle  │  │    Redis     │  │  Kafka / Fluvio   │
│  (Primary DB) │  │  (Ledger)     │  │  (Cache/Pub) │  │  (Event Streaming)│
└───────────────┘  └───────────────┘  └──────────────┘  └───────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                       MICROSERVICES LAYER                                    │
│                                                                               │
│  Python Services:          Go Services:           Rust Services:             │
│  · payment-gateway         · hierarchy-engine     · pos-sim-orchestrator     │
│  · cbn-reporting           · auth-service         · tigerbeetle-sidecar      │
│  · fraud-detection         · rbac-service                                    │
│                                                                               │
│  Node.js Workers:                                                             │
│  · erpRetryWorker          · settlementWorker     · pushNotificationWorker   │
│  · temporalWorker          · kafkaConsumer        · offlineQueueWorker       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Layer          | Technology                   | Purpose                                     |
| -------------- | ---------------------------- | ------------------------------------------- |
| Frontend       | React 19 + Vite + Tailwind 4 | Web PWA (POSShell, AdminPanel, all portals) |
| API            | tRPC 11 + Express 4          | Type-safe RPC with superjson                |
| Auth           | Manus OAuth + JWT + FIDO2    | Session management + biometric              |
| Database       | PostgreSQL + Drizzle ORM     | Primary relational store                    |
| Ledger         | TigerBeetle                  | Double-entry financial ledger               |
| Cache          | Redis                        | Session cache, pub/sub, rate limiting       |
| Streaming      | Kafka + Fluvio               | Event streaming, real-time updates          |
| Mobile (1)     | Flutter + Dart               | iOS/Android consumer app                    |
| Mobile (2)     | React Native                 | iOS/Android agent app                       |
| Auth Gateway   | Keycloak                     | Enterprise SSO                              |
| Secrets        | HashiCorp Vault              | Secret management                           |
| API Gateway    | APISix                       | Rate limiting, routing, mTLS                |
| Storage        | MinIO / S3                   | File storage (KYC docs, firmware)           |
| Workflow       | Temporal                     | Long-running workflows                      |
| Permissions    | Permify                      | Fine-grained RBAC                           |
| Observability  | OpenTelemetry + Grafana      | Traces, metrics, logs                       |
| Error Tracking | Sentry                       | Frontend/backend error monitoring           |
| SMS            | Termii                       | OTP delivery, transaction alerts            |
| Push           | Web Push (VAPID)             | Browser push notifications                  |
| IoT            | MQTT                         | POS terminal messaging                      |

---

## Database Schema (65 Tables)

The schema is defined in `drizzle/schema.ts` and covers:

**Core Financial:** `transactions`, `floatRequests`, `floatApprovals`, `settlements`, `settlementLines`, `ledgerEntries`, `recurringPayments`, `rateLocks`

**Agent Management:** `agents`, `agentHierarchy`, `agentPerformance`, `agentSessions`, `agentDevices`, `agentCommissions`, `agentFloatLimits`

**Customer:** `customers`, `customerKYC`, `creditScoreHistory`, `creditApplications`, `beneficiaries`, `virtualCards`, `savingsGoals`

**Security:** `fido2Credentials`, `fido2Challenges`, `apiKeys`, `apiKeyUsage`, `webhookSecrets`, `auditLogs`

**MDM / Device:** `devices`, `deviceGroups`, `deviceCommands`, `geofenceZones`, `geofenceViolations`, `otaReleases`, `otaUpdateLog`

**Communication:** `chatSessions`, `chatMessages`, `pushSubscriptions`, `emailQueue`, `notificationLogs`

**Compliance:** `dataRightsRequests`, `consentRecords`, `cbnReports`, `fraudAlerts`, `amlWatchlist`

**Platform:** `merchants`, `merchantCategories`, `loyaltyPoints`, `loyaltyTiers`, `referrals`, `dlqMessages`, `erpSyncLog`, `systemSettings`

---

## Key Data Flows

### Cash-In Transaction

```
Agent → POSShell → tRPC transactions.premiumCollection
  → Validate premium reserve (Redis cache)
  → Insert transaction (PostgreSQL)
  → Post to TigerBeetle ledger
  → Publish to Kafka topic "transactions"
  → Send SMS receipt via Termii
  → Update agent premium reserve
  → Return success with reference
```

### OTP Authentication

```
Agent → Login form → tRPC auth.requestOTP
  → Generate 6-digit OTP (crypto.randomInt)
  → Store in Redis with 5-min TTL
  → Send via Termii SMS API
  → Agent enters OTP → tRPC auth.verifyOTP
  → Validate against Redis
  → Issue JWT session cookie
```

### Fraud Detection

```
Transaction → Kafka "transactions" topic
  → Fraud Detection Worker (Python)
  → Score transaction (ML model)
  → If score > FRAUD_SCORE_THRESHOLD:
    → Insert fraudAlert (PostgreSQL)
    → Publish to Kafka "fraud-alerts"
    → Send push notification to admin
    → If score > FRAUD_AUTO_BLOCK_THRESHOLD:
      → Block agent account
      → Notify compliance team
```

---

## Security Architecture

The platform implements defence-in-depth with multiple security layers. At the network layer, APISix enforces rate limiting (100 req/min default, 10 req/min for auth endpoints), mTLS for service-to-service communication, and JWT validation on all protected routes. Secrets are stored in HashiCorp Vault and injected at runtime — never hardcoded. FIDO2/WebAuthn provides passwordless biometric authentication for agents. All financial transactions are double-entry in TigerBeetle, making unauthorized balance manipulation mathematically impossible. The GDPR router provides full DSAR (Data Subject Access Request) handling with automated data export and deletion workflows.

---

## Deployment Topology

The platform is designed for Docker Compose (single-server) or Kubernetes (multi-node) deployment. The `docker-compose.yml` defines all 30+ services with health checks, restart policies, and resource limits. For production, a minimum of 3 nodes is recommended: one for the core backend + PostgreSQL primary, one for Kafka + TigerBeetle, and one for Redis + MinIO + monitoring.

---

## Mobile Apps

**Flutter App** (`mobile-flutter/`) — Consumer-facing app with 37 screens covering authentication, transfers, bill payments, savings, virtual cards, FX rates, KYC, and notifications. Uses Riverpod for state management, GoRouter for navigation, and the `ApiService` class for all backend communication.

**React Native App** (`mobile-rn/`) — Agent-facing app with 40+ screens organized into journeys (auth, transactions, float, bills, beneficiaries, settings). Uses React Navigation for routing, AsyncStorage for persistence, and the `POSInsurePortalAPIClient` for all API calls.

---

## CBN Compliance

The platform is designed to meet CBN (Central Bank of Nigeria) requirements for insurance:

- Transaction limits enforced per KYC tier (Basic: ₦300k/day, Standard: ₦1M/day, Premium: ₦5M/day)
- Daily reconciliation reports generated at 23:00 WAT
- AML watchlist screening on all transactions above ₦50,000
- NFIU (Nigerian Financial Intelligence Unit) reporting for suspicious transactions
- Audit trail for all financial operations with tamper-evident logging
- Data residency: all data stored in Nigeria-region infrastructure
