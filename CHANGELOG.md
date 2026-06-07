# InsurePortal Agency Banking Platform — Changelog

All notable changes to this project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Phase 161] — 2026-04-10 — Production Finalization

### Added

**Infrastructure**

- TigerBeetle 3-node cluster (`infra/tigerbeetle/docker-compose.cluster.yml`, `init-cluster.sh`) replacing single-node setup for fault tolerance
- Fluvio SmartModule Rust workspace with three production-ready modules: `transaction-filter`, `fraud-enricher`, `mdm-heartbeat-parser` (full source + unit tests)
- MinIO bucket lifecycle policies: screenshots (30-day expiry), firmware (365-day), lakehouse Bronze→Silver→Gold tiering
- APISix bootstrap script seeding all 20+ routes via Admin API with JWT auth plugin
- Comprehensive `.env.production` with all 60+ environment variables set to production-ready defaults (no CHANGE_ME placeholders)
- One-command bootstrap script `scripts/bootstrap-production.sh` orchestrating full cluster startup

**MDM & OTA**

- OTA service: replaced placeholder download URL with real S3/MinIO presigned URL generation (15-minute expiry, AWS SDK v2)
- Kotlin `MdmCommandExecutor` supporting 11 command types (LOCK_SCREEN, REBOOT, CLEAR_APP_DATA, SET_PASSCODE_POLICY, WIPE_DEVICE, ENABLE/DISABLE_WIFI, SCREENSHOT, OTA_UPDATE, SET_KIOSK_MODE, PING)
- Kotlin `DeviceTelemetryCollector` collecting battery, network, storage, RAM, and security telemetry
- Kotlin `MdmBootReceiver` auto-scheduling HeartbeatWorker after device reboot
- Go MDM compliance engine HTTP handler layer with full test suite (7 tests)

**CBN Compliance**

- APScheduler cron scheduler wired into CBN reporting engine (`scheduler.py`) with daily/weekly/monthly/quarterly jobs
- Python test suite for CBN compliance rules (16 tests, 2 skipped pending APScheduler install)

**Monitoring**

- Prometheus MDM alert rules (`monitoring/prometheus/alerts/mdm.rules.yml`): 8 alert rules covering heartbeat queue depth, device offline, compliance violations, OTA failures
- Prometheus CBN alert rules (`monitoring/prometheus/alerts/cbn.rules.yml`): 7 alert rules covering report submission, daily limit breaches, KYC compliance rate
- Grafana MDM Fleet dashboard JSON (`monitoring/grafana/dashboards/mdm-fleet.json`)
- Grafana CBN Compliance dashboard JSON (`monitoring/grafana/dashboards/cbn-compliance.json`)

**CI/CD**

- Playwright E2E tests split into 3 parallel shards (reduces wall-clock time from ~8 min to ~3 min)
- Playwright shard report merge job (`playwright-merge-reports`)
- Go microservice test job (`go-tests`) covering MDM compliance engine, geofence service, OTA service
- Python microservice test job (`python-tests`) covering CBN reporting engine, KYC service, fraud engine
- Playwright E2E specs 06 (MDM device management) and 07 (CBN compliance reporting)
- k6 OTA load test (`k6/mdm-ota-update.js`) simulating 200 devices polling for firmware updates

**Documentation**

- `RUNBOOK.md` fully updated to Phase 161 covering all 24 services, TigerBeetle cluster, MDM commands, CBN compliance tiers
- `PRODUCTION_READINESS_FINAL.md` comprehensive architecture reference, deployment checklist, CBN compliance matrix
- `CHANGELOG.md` (this file) documenting all phases

**Makefile**

- 15 new `Makefile.production` targets: `mdm-deploy`, `cbn-report-daily`, `cbn-report-monthly`, `ota-upload`, `fluvio-deploy`, `tigerbeetle-init`, `tigerbeetle-provision`, `minio-lifecycle`, `apisix-bootstrap`, `bootstrap`, `health-check-all`, `scale-up`, `scale-down`, `backup-all`, `rotate-secrets`

### Changed

- `server/_core/env.ts`: all localhost defaults replaced with Docker service hostnames
- `docker-compose.production.yml`: added `mdm-compliance-engine`, `mdm-geofence-service`, `fluvio`, `dapr`, `minio` services
- `monitoring/prometheus/prometheus.yml`: added MDM and CBN alert rule files and scrape targets

---

## [Phase 160] — 2026-03-30 — MDM & OTA Platform

### Added

- MDM server-side infrastructure: device enrollment, heartbeat processing, command queue
- OTA firmware update service (Go) with version management and staged rollout
- MDM geofence service with polygon-based location compliance
- Android MDM agent: `MdmHeartbeatWorker`, `MdmCommandReceiver`, `MdmOtaUpdateService`
- Kotlin `MdmDeviceAdminReceiver` for Device Admin privileges
- CBN reporting engine (Python) with FastAPI and S3 report storage
- Fluvio SmartModule directory structure and deploy script
- FreeRTOS STM32F4 BSP linker script and `memory.x` for Rust embedded
- Playwright E2E specs for MDM heartbeat and OTA flows
- k6 MDM heartbeat load test

---

## [Phase 136] — 2026-01-15 — ERP Integration & Lakehouse

### Added

- ERPNext integration with Frappe REST API (agent sync, transaction sync, float sync)
- ERP sync retry worker with exponential backoff
- Lakehouse service with Bronze/Silver/Gold Delta Lake tiers
- Parquet export pipeline for transaction analytics
- Temporal workflow for daily ERP sync orchestration
- `erp_sync_log` database table with retry tracking

---

## [Phase 120] — 2025-12-01 — Settlement & Reconciliation

### Added

- Daily settlement Temporal workflow with automatic cutover at 23:00 WAT
- Settlement service (Go) with bank transfer integration
- Reconciliation engine comparing TigerBeetle ledger vs PostgreSQL records
- Settlement history UI in Admin Panel
- Automated reconciliation alerts for discrepancies > ₦1,000

---

## [Phase 100] — 2025-10-15 — Fraud Detection & Risk Engine

### Added

- Fraud engine (Python) with ML-based transaction scoring
- Real-time fraud scoring via Kafka stream processing
- Fraud alert dashboard in Admin Panel
- Automatic transaction blocking for score > 90
- Fraud case management workflow
- Fluvio `fraud-enricher` SmartModule for real-time enrichment

---

## [Phase 85] — 2025-09-01 — KYC & Identity Verification

### Added

- KYC service (Python) with Smile Identity integration
- BVN verification workflow
- NIN verification workflow
- Liveness check integration
- KYC tier management (Basic/Standard/Premium)
- KYC compliance dashboard

---

## [Phase 70] — 2025-07-15 — SIM Orchestration & Connectivity

### Added

- SIM orchestrator (Rust) with MTN/Airtel/Glo failover
- RSSI-based automatic SIM switching
- Coverage map with signal quality heatmap
- SIM failover history and analytics
- WiFi-first policy with cellular fallback
- `pos-sim-orchestrator` with FreeRTOS HAL for embedded service nodes

---

## [Phase 50] — 2025-05-01 — Agent Banking Core

### Added

- Agent registration and onboarding workflow
- Float management with TigerBeetle double-entry ledger
- Cash-in/cash-out transaction processing
- P2P transfer with daily limits
- Bill payment integration
- Agent dashboard with real-time float balance
- Admin panel with agent management

---

## [Phase 30] — 2025-03-15 — Authentication & Authorization

### Added

- Keycloak OAuth2/OIDC integration
- FIDO2/WebAuthn passwordless authentication
- Permify RBAC with agent/admin/supervisor roles
- HashiCorp Vault for secret management
- JWT session management with refresh tokens
- Manus OAuth integration

---

## [Phase 10] — 2025-01-01 — Foundation

### Added

- Project scaffold: React 19 + TypeScript + Tailwind 4 + tRPC 11
- PostgreSQL database with Drizzle ORM
- Redis session store
- Kafka event streaming
- APISix API gateway
- Docker Compose production configuration
- GitHub Actions CI/CD pipeline
- Vitest unit test framework
- Playwright E2E test framework
