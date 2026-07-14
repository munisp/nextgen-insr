# InsurePortal Workspace Redundancy Audit

**Date:** 30 March 2026  
**Scope:** `/home/ubuntu/` workspace — all directories  
**Purpose:** Map duplicate implementations, identify canonical sources, and prescribe consolidation actions

---

## 1. Workspace Directory Inventory

| Directory                            | Size    | Purpose                                           | Status                           |
| ------------------------------------ | ------- | ------------------------------------------------- | -------------------------------- |
| `/home/ubuntu/insureportal-demo/`       | ~45 MB  | **Canonical InsurePortal** — React/Node.js/tRPC app  | **Active — primary deliverable** |
| `/home/ubuntu/platform/`             | 403 MB  | Platform monorepo — all backend microservices     | **Active — platform reference**  |
| `/home/ubuntu/archives/`             | ~120 MB | ZIP archives of previous phases                   | Archival — safe to keep          |
| `/home/ubuntu/.archived-stale/`      | ~80 MB  | Stale phase archives (65–70, production-overhaul) | **Stale — can be deleted**       |
| `/home/ubuntu/tb-data/`              | ~2 MB   | TigerBeetle sidecar data files                    | Active — used by sidecar         |
| `/home/ubuntu/webdev-static-assets/` | ~5 MB   | CDN-uploaded static assets                        | Active — referenced by InsurePortal |
| `/home/ubuntu/skills/`               | <1 MB   | Manus skill definitions                           | System — do not touch            |

---

## 2. Platform Service vs InsurePortal Router Overlap

The following table maps each InsurePortal internal router to its canonical platform service equivalent. Where a platform service exists, the InsurePortal router should become a thin proxy (calling `platformClient.ts`) rather than owning the business logic.

| InsurePortal Router     | Internal Logic              | Platform Service                                   | Platform Path                                                                                        | Integration Status                                                                         |
| -------------------- | --------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `kyc.ts`             | KYC sessions, liveness, OCR | `kyc-enhanced` + `compliance-kyc`                  | `platform/services/kyc-enhanced/`, `platform/services/compliance-kyc/`                               | **Wired** — `kycClient.ts` proxies to `:5001/:5002/:5003`                                  |
| `fraud.ts`           | Fraud reports, ML scoring   | `fraud-detection`                                  | `platform/services/fraud-detection/`                                                                 | **Wired** — `fraudPlatform` client, local DB fallback                                      |
| `settlement.ts`      | Settlement runs, history    | `float-settlement-engine`                          | `platform/services/float-settlement-engine/`                                                         | **Wired** — `settlementPlatform` client, local cron fallback                               |
| `geofencing.ts`      | Zone CRUD, location check   | `pos-geofencing`                                   | `platform/backend/python-services/pos-geofencing/`                                                   | **Partial** — `geofencingPlatform` client exists; polygon zones not yet proxied            |
| `disputes.ts`        | Dispute CRUD, messages      | `dispute-service`                                  | `platform/core-services/dispute-service/`                                                            | **Partial** — `disputePlatform` client exists; chargeback/provisional credit not yet in UI |
| `loyalty.ts`         | Points, rewards, redemption | `loyalty-service`                                  | `platform/backend/python-services/loyalty-service/`                                                  | **Wired** — `loyaltyPlatform` client, local DB fallback                                    |
| `premiumTopUp.ts`      | Float top-up requests       | `float-service` (Python) + `float-management` (Go) | `platform/backend/python-services/float-service/`, `platform/services/go-services/float-management/` | **Partial** — `floatPlatform.utilize/settle` not yet called in `transactions.create`       |
| `agentManagement.ts` | Agent CRUD, KYB             | `agent-service`                                    | `platform/backend/python-services/agent-service/`                                                    | **Not wired** — fully internal                                                             |
| `transactions.ts`    | Transaction create, stats   | `transaction-service`, `analytics-service`         | `platform/core-services/transaction-service/`, `platform/core-services/analytics-service/`           | **Partial** — analytics platform client exists but not called                              |
| `auditLog.ts`        | Audit log writes/reads      | `audit-service` (Go)                               | `platform/services/go-services/audit-service/`                                                       | **Not wired** — fully internal (Fluvio dual-write pending)                                 |
| `chat.ts`            | Agent-supervisor chat       | No platform equivalent                             | —                                                                                                    | **Internal only** — correct                                                                |
| `supervisor.ts`      | Supervisor actions          | No platform equivalent                             | —                                                                                                    | **Internal only** — correct                                                                |
| `pinReset.ts`        | PIN reset flow              | No platform equivalent                             | —                                                                                                    | **Internal only** — correct                                                                |
| `mdm.ts`             | Device management           | No platform equivalent                             | —                                                                                                    | **Internal only** — correct                                                                |
| `smsReceipt.ts`      | SMS receipts                | `notification-service` (Go)                        | `platform/services/go-services/notification-service/`                                                | **Partial** — uses Termii directly; could proxy to platform notification                   |
| `resilience.ts`      | Offline queue, sync         | No platform equivalent                             | —                                                                                                    | **Internal only** — correct                                                                |
| `export.ts`          | CSV/PDF export              | No platform equivalent                             | —                                                                                                    | **Internal only** — correct                                                                |

---

## 3. Duplicate Service Implementations

The platform monorepo contains multiple implementations of the same service in different languages/frameworks. This is intentional (polyglot architecture) but creates confusion about which is canonical.

### 3.1 Float Management

| Implementation              | Path                                              | Language       | Port     | Notes                        |
| --------------------------- | ------------------------------------------------- | -------------- | -------- | ---------------------------- |
| Python float-service        | `platform/backend/python-services/float-service/` | Python/FastAPI | 8107     | REST API, PostgreSQL         |
| Go float-management         | `platform/services/go-services/float-management/` | Go             | 8107     | Higher performance, same API |
| InsurePortal premiumTopUp router | `server/routers/premiumTopUp.ts`                    | TypeScript     | internal | Local DB only                |

**Canonical:** Go float-management (`:8107`) — the `floatPlatform` client in `platformClient.ts` already points to it.

### 3.2 Notification Service

| Implementation          | Path                                                     | Language       | Port | Notes                                 |
| ----------------------- | -------------------------------------------------------- | -------------- | ---- | ------------------------------------- |
| Go notification         | `platform/services/go-services/notification-service/`    | Go             | 8110 | Multi-channel (SMS/email/push/in-app) |
| Python notification     | `platform/backend/python-services/notification-service/` | Python/FastAPI | 8110 | Same API                              |
| InsurePortal Termii direct | `server/routers/smsReceipt.ts`                           | TypeScript     | —    | Direct Termii API call                |
| Manus notifyOwner       | `server/_core/notification.ts`                           | TypeScript     | —    | Owner-only, Manus built-in            |

**Canonical:** Go notification service (`:8110`) for agent/customer notifications. Manus notifyOwner for owner alerts. Termii direct for SMS receipts (acceptable — low complexity).

### 3.3 Analytics Service

| Implementation        | Path                                               | Language       | Port     | Notes                 |
| --------------------- | -------------------------------------------------- | -------------- | -------- | --------------------- |
| Go analytics          | `platform/services/go-services/analytics-service/` | Go             | 8109     | Real-time metrics     |
| Python analytics      | `platform/core-services/analytics-service/`        | Python/FastAPI | 8109     | Lakehouse-backed      |
| InsurePortal hourlyStats | `server/routers/transactions.ts`                   | TypeScript     | internal | PostgreSQL aggregates |

**Canonical:** Python analytics service (`:8109`) for historical/lakehouse analytics. InsurePortal PostgreSQL aggregates for real-time dashboard (acceptable — low latency).

### 3.4 Audit Service

| Implementation            | Path                                              | Language   | Port     | Notes                |
| ------------------------- | ------------------------------------------------- | ---------- | -------- | -------------------- |
| Go audit-service          | `platform/services/go-services/audit-service/`    | Go         | —        | Writes to Fluvio     |
| Go audit-compliance       | `platform/services/go-services/audit-compliance/` | Go         | —        | Compliance reporting |
| InsurePortal auditLog router | `server/routers/auditLog.ts`                      | TypeScript | internal | PostgreSQL only      |

**Canonical:** Go audit-service for platform-wide audit trail. InsurePortal PostgreSQL for local queries (dual-write pattern recommended — see middleware audit doc).

---

## 4. Stale Archives — Deletion Candidates

The following directories/files are stale and can be safely deleted to reclaim ~80 MB:

| Path                                                          | Size   | Reason for Deletion                  |
| ------------------------------------------------------------- | ------ | ------------------------------------ |
| `/home/ubuntu/.archived-stale/insureportal-phases-65-70/`           | ~30 MB | Superseded by current implementation |
| `/home/ubuntu/.archived-stale/insureportal-phases-65-70.zip`        | ~15 MB | Same content as directory            |
| `/home/ubuntu/.archived-stale/insureportal-production-overhaul/`    | ~20 MB | Superseded by insureportal-demo         |
| `/home/ubuntu/.archived-stale/insureportal-production-overhaul.zip` | ~10 MB | Same content as directory            |
| `/home/ubuntu/.archived-stale/pos-demo/`                      | ~5 MB  | Early prototype, superseded          |

**Retained:** `/home/ubuntu/.archived-stale/insureportal-insureportal-complete.zip` and `/home/ubuntu/.archived-stale/insureportal-pos-source.zip` — these are the most recent pre-overhaul snapshots and should be kept as rollback references.

---

## 5. Consolidation Actions (Prioritised)

| Priority | Action                                                                             | Impact                                     |
| -------- | ---------------------------------------------------------------------------------- | ------------------------------------------ |
| **P1**   | Wire `floatPlatform.utilize()` + `floatPlatform.settle()` in `transactions.create` | Eliminates duplicate float logic           |
| **P1**   | Wire `analyticsPlatform.transactionSummary()` in Admin Panel analytics             | Eliminates duplicate analytics aggregation |
| **P2**   | Add polygon zone support to geofencing proxy                                       | Eliminates zone type limitation            |
| **P2**   | Add chargeback/provisional credit UI to Admin Panel disputes                       | Completes dispute platform proxy           |
| **P3**   | Dual-write audit log to Fluvio `audit-logs` topic                                  | Aligns with platform audit trail           |
| **P3**   | Wire `notificationPlatform.send()` for agent/customer notifications                | Eliminates Termii direct calls             |
| **P4**   | Wire `agentManagement.ts` to `agent-service` platform API                          | Eliminates duplicate agent CRUD            |
| **P5**   | Delete stale archives in `.archived-stale/`                                        | Reclaims ~80 MB disk space                 |

---

## 6. Files Safe to Delete Now

The following files in the InsurePortal project are dead code or superseded:

| File            | Reason                                          |
| --------------- | ----------------------------------------------- |
| None identified | All server files are actively imported and used |

The InsurePortal codebase is clean — no dead code identified. The redundancy is entirely at the workspace level (platform monorepo vs InsurePortal internal implementations), not within the InsurePortal itself.

---

_Audit generated from live codebase inspection. All sizes are approximate._
