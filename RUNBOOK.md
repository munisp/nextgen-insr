# InsurePortal Insurance Platform — Production Runbook

**Version:** Phase 161 | **Last Updated:** April 2026 | **Owner:** InsurePortal SRE Team

---

## Table of Contents

1. [Service Inventory](#1-service-inventory)
2. [Bootstrap & First-Time Setup](#2-bootstrap--first-time-setup)
3. [Daily Operations](#3-daily-operations)
4. [Incident Response Playbooks](#4-incident-response-playbooks)
5. [Scaling Procedures](#5-scaling-procedures)
6. [Backup & Recovery](#6-backup--recovery)
7. [Certificate & Secret Rotation](#7-certificate--secret-rotation)
8. [CBN Compliance Operations](#8-cbn-compliance-operations)
9. [MDM Fleet Operations](#9-mdm-fleet-operations)
10. [Monitoring & Alerting Reference](#10-monitoring--alerting-reference)

---

## 1. Service Inventory

| Service               | Technology           | Port      | Health Endpoint          | Critical |
| --------------------- | -------------------- | --------- | ------------------------ | -------- |
| InsurePortal Platform (main app)  | Node.js + React      | 3000      | `/api/health`            | Yes      |
| OTA Service           | Go                   | 8081      | `/health`                | Yes      |
| MDM Compliance Engine | Go                   | 8091      | `/health`                | Yes      |
| MDM Geofence Service  | Go                   | 8092      | `/health`                | Yes      |
| CBN Reporting Engine  | Python               | 8095      | `/health`                | Yes      |
| KYC Service           | Python               | 8070      | `/health`                | Yes      |
| Settlement Service    | Go                   | 8073      | `/health`                | Yes      |
| Fraud Engine          | Python               | 8085      | `/health`                | Yes      |
| SIM Orchestrator      | Go                   | 8090      | `/health`                | Yes      |
| FIDO2 Service         | Go                   | 8083      | `/health`                | Yes      |
| Workflow Orchestrator | Go                   | 8075      | `/health`                | Yes      |
| Lakehouse Service     | Go                   | 8096      | `/health`                | No       |
| PostgreSQL            | Postgres 16          | 5432      | `pg_isready`             | Yes      |
| Redis                 | Redis 7              | 6379      | `PING`                   | Yes      |
| Kafka                 | Kafka 3.7            | 9092      | `kafka-topics.sh --list` | Yes      |
| TigerBeetle (3-node)  | TigerBeetle 0.15.3   | 3000-3002 | TCP connect              | Yes      |
| Keycloak              | Keycloak 24          | 8080      | `/health/ready`          | Yes      |
| Vault                 | HashiCorp Vault 1.17 | 8200      | `/v1/sys/health`         | Yes      |
| APISix                | APISix 3.9           | 9080/9180 | `/apisix/admin/routes`   | Yes      |
| MinIO                 | MinIO                | 9000      | `/minio/health/live`     | Yes      |
| Fluvio                | Fluvio 0.11          | 9003      | `fluvio cluster status`  | No       |
| Temporal              | Temporal 1.24        | 7233      | gRPC health              | No       |
| Prometheus            | Prometheus 2.51      | 9090      | `/-/healthy`             | No       |
| Grafana               | Grafana 10           | 3001      | `/api/health`            | No       |

---

## 2. Bootstrap & First-Time Setup

### 2.1 One-Command Bootstrap

```bash
# Clone the repository
git clone https://github.com/insureportal/insurance-portal-demo.git
cd insurance-portal-demo

# Run the full bootstrap (creates network, volumes, starts all services)
bash scripts/bootstrap-production.sh
```

The bootstrap script performs the following steps in order:

1. Creates the `insureportal-net` Docker network
2. Initialises TigerBeetle 3-node cluster data files
3. Starts infrastructure services (Postgres, Redis, Kafka, MinIO, Vault, Keycloak)
4. Waits for all health checks to pass
5. Runs database migrations (`pnpm db:push`)
6. Bootstraps APISix routes via Admin API
7. Applies MinIO bucket lifecycle policies
8. Deploys Fluvio SmartModules
9. Provisions TigerBeetle accounts
10. Starts all application services

### 2.2 Manual Step-by-Step

```bash
# 1. Create Docker network
docker network create insureportal-net

# 2. Initialise TigerBeetle cluster
bash infra/tigerbeetle/init-cluster.sh

# 3. Start infrastructure
docker compose -f docker-compose.production.yml up -d \
  postgres redis kafka minio vault keycloak

# 4. Wait for Postgres
until docker exec pos-postgres pg_isready -U insureportal; do sleep 2; done

# 5. Run migrations
pnpm db:push

# 6. Bootstrap APISix
bash infra/apisix/bootstrap.sh

# 7. Apply MinIO lifecycle policies
bash infra/minio/init-minio.sh

# 8. Deploy Fluvio SmartModules
bash infra/fluvio/deploy-smartmodule.sh

# 9. Provision TigerBeetle accounts
bash infra/tigerbeetle/provision.sh

# 10. Start all services
docker compose -f docker-compose.production.yml up -d
```

---

## 3. Daily Operations

### 3.1 Health Check All Services

```bash
make -f Makefile.production health-check
```

### 3.2 View Logs

```bash
# All services (last 100 lines each)
docker compose -f docker-compose.production.yml logs --tail=100

# Specific service
docker compose -f docker-compose.production.yml logs -f insurance-portal

# Error logs only
docker compose -f docker-compose.production.yml logs --tail=200 | grep -i "error\|fatal\|panic"
```

### 3.3 Restart a Service

```bash
# Graceful restart
docker compose -f docker-compose.production.yml restart <service-name>

# Force recreate (use when config changes)
docker compose -f docker-compose.production.yml up -d --force-recreate <service-name>
```

### 3.4 Deploy a New Version

```bash
# Pull latest images
docker compose -f docker-compose.production.yml pull

# Rolling restart (zero downtime for stateless services)
docker compose -f docker-compose.production.yml up -d --no-deps --build insurance-portal

# Run migrations if schema changed
pnpm db:push
```

---

## 4. Incident Response Playbooks

### P0: Transaction Processing Down

**Symptoms:** Agents cannot process transactions; service node shows "Service Unavailable"

```bash
# 1. Check InsurePortal Platform health
curl -sf http://localhost:3000/api/health | jq .

# 2. Check database connectivity
docker exec pos-postgres pg_isready -U insureportal

# 3. Check TigerBeetle cluster
for i in 0 1 2; do
  echo "tigerbeetle-$i:"
  docker exec tigerbeetle-$i sh -c "echo ping | nc -q1 localhost $((3000+i))" 2>&1 || echo "  UNREACHABLE"
done

# 4. Check Kafka consumer lag
docker exec pos-kafka kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe --group insurance-portal-consumers

# 5. Check recent error logs
docker compose -f docker-compose.production.yml logs --tail=50 insurance-portal | grep -i error
```

**Resolution:**

- If Postgres is down: `docker compose -f docker-compose.production.yml restart postgres`
- If TigerBeetle node is down: `docker compose -f docker-compose.production.yml restart tigerbeetle-0`
- If Kafka lag is high: restart the affected consumer service

### P1: Vault Sealed

**Symptoms:** Services returning 500 errors; Vault UI shows "Vault is sealed"

```bash
# Check Vault status
docker exec pos-vault vault status

# Unseal Vault (requires 3 of 5 unseal keys)
docker exec pos-vault vault operator unseal <unseal-key-1>
docker exec pos-vault vault operator unseal <unseal-key-2>
docker exec pos-vault vault operator unseal <unseal-key-3>

# Verify unsealed
docker exec pos-vault vault status | grep "Sealed.*false"
```

### P1: MDM Heartbeat Flood

**Symptoms:** `mdm_heartbeat_queue_depth` > 10,000; MDM service CPU > 80%

```bash
# Check Fluvio topic depth
fluvio topic describe mdm-heartbeats

# Scale up MDM compliance engine replicas
docker compose -f docker-compose.production.yml up -d --scale mdm-compliance-engine=3
```

### P1: CBN Report Submission Failure

**Symptoms:** `cbn_report_submission_failed` alert firing

```bash
# Check CBN reporting engine logs
docker compose -f docker-compose.production.yml logs --tail=100 cbn-reporting-engine

# Trigger manual report generation
curl -X POST http://localhost:8095/api/v1/reports/generate \
  -H "Content-Type: application/json" \
  -d '{"reportType": "monthly_activity", "month": "2026-03"}'

# Verify report was created
mc ls myminio/insureportal-reports/54LINK001/monthly_activity/2026/03/
```

### P1: Temporal Worker Down

**Symptoms:** Daily settlement not running, Temporal UI shows workflow failures

```bash
# Check Temporal
docker compose logs temporal | tail -50

# Restart Temporal
docker compose -f docker-compose.production.yml restart temporal temporal-ui

# Manually trigger settlement
# Admin Panel → Overview → "Run Settlement Now"
```

### P2: High Fraud Score Alert

**Symptoms:** `fraud_high_score_rate` > 5%; multiple transactions blocked

```bash
# Check fraud engine
curl -sf http://localhost:8085/health | jq .

# Review blocked transactions
docker compose -f docker-compose.production.yml logs --tail=100 fraud-engine | grep "BLOCKED\|HIGH_RISK"
```

### P2: SIM Failover Rate High

**Symptoms:** Frequent SIM failovers, agents reporting slow transactions

```bash
# Check Failover History in Admin Panel → SIM Orchestrator → Failover History
# Identify affected terminal IDs and check Coverage Map for signal quality
# Contact carrier support if RSSI < -90 dBm consistently
```

---

## 5. Scaling Procedures

### 5.1 Horizontal Scaling (Stateless Services)

```bash
# Scale POS Shell to 3 replicas
docker compose -f docker-compose.production.yml up -d --scale insurance-portal=3

# Scale MDM compliance engine
docker compose -f docker-compose.production.yml up -d --scale mdm-compliance-engine=3

# Scale CBN reporting engine
docker compose -f docker-compose.production.yml up -d --scale cbn-reporting-engine=2
```

### 5.2 Kafka Partition Scaling

```bash
# Increase partitions for high-throughput topics
docker exec pos-kafka kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --alter --topic pos-transactions \
  --partitions 12
```

---

## 6. Backup & Recovery

### 6.1 PostgreSQL Backup

```bash
# Daily backup
docker exec pos-postgres pg_dump -U insureportal insureportal | \
  gzip > /backups/postgres/insureportal_$(date +%Y%m%d_%H%M%S).sql.gz

# Upload to MinIO
mc cp /backups/postgres/*.sql.gz myminio/insureportal-lakehouse/backups/postgres/

# Restore from backup
gunzip -c /backups/postgres/insureportal_20260401_000000.sql.gz | \
  docker exec -i pos-postgres psql -U insureportal insureportal
```

### 6.2 TigerBeetle Backup

```bash
# Stop TigerBeetle nodes before backup
docker compose -f docker-compose.production.yml stop tigerbeetle-0 tigerbeetle-1 tigerbeetle-2

# Copy data files
cp -r /var/lib/tigerbeetle/ /backups/tigerbeetle/$(date +%Y%m%d)/

# Restart cluster
docker compose -f docker-compose.production.yml start tigerbeetle-0 tigerbeetle-1 tigerbeetle-2
```

### 6.3 Full Service Restore from Checkpoint

1. Open Management UI → Version History
2. Select the last known-good checkpoint
3. Click "Rollback"
4. Redeploy: `make -f Makefile.production deploy`

---

## 7. Certificate & Secret Rotation

### 7.1 JWT Secret Rotation

```bash
# 1. Generate new secret
NEW_SECRET=$(openssl rand -base64 64)

# 2. Update in Vault
docker exec pos-vault vault kv put secret/insureportal/jwt JWT_SECRET="$NEW_SECRET"

# 3. Update .env.production
sed -i "s/JWT_SECRET=.*/JWT_SECRET=$NEW_SECRET/" .env.production

# 4. Rolling restart (existing sessions will be invalidated)
docker compose -f docker-compose.production.yml up -d --force-recreate insurance-portal
echo "JWT secret rotated. All active sessions have been invalidated."
```

### 7.2 Database Password Rotation

```bash
# 1. Generate new password
NEW_PASS=$(openssl rand -base64 32)

# 2. Update in PostgreSQL
docker exec pos-postgres psql -U postgres -c \
  "ALTER USER insureportal PASSWORD '$NEW_PASS';"

# 3. Update .env.production and restart services
sed -i "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$NEW_PASS/" .env.production
docker compose -f docker-compose.production.yml up -d --force-recreate insurance-portal
```

---

## 8. CBN Compliance Operations

### 8.1 Manual Report Generation

```bash
# Daily activity report
curl -X POST http://localhost:8095/api/v1/reports/generate \
  -H "Content-Type: application/json" \
  -d '{"reportType": "daily_activity", "date": "2026-04-10"}'

# Monthly CBN report
curl -X POST http://localhost:8095/api/v1/reports/generate \
  -H "Content-Type: application/json" \
  -d '{"reportType": "monthly_activity", "month": "2026-03"}'

# Weekly reconciliation
curl -X POST http://localhost:8095/api/v1/reports/generate \
  -H "Content-Type: application/json" \
  -d '{"reportType": "weekly_reconciliation", "week": "2026-W14"}'
```

### 8.2 CBN Compliance Tiers

| Tier     | KYC Level | Daily Limit | Single Transaction |
| -------- | --------- | ----------- | ------------------ |
| Basic    | Level 1   | ₦300,000    | ₦50,000            |
| Standard | Level 2   | ₦1,000,000  | ₦200,000           |
| Premium  | Level 3   | ₦5,000,000  | ₦1,000,000         |

### 8.3 Report Submission Deadlines

| Report                | Frequency | Deadline                        |
| --------------------- | --------- | ------------------------------- |
| Daily Activity        | Daily     | Next business day by 09:00 WAT  |
| Weekly Reconciliation | Weekly    | Monday by 12:00 WAT             |
| Monthly Activity      | Monthly   | 5th of following month          |
| Quarterly Summary     | Quarterly | 15th of month after quarter end |

---

## 9. MDM Fleet Operations

### 9.1 Device Enrollment

```bash
# Generate enrollment QR code for a new device
curl -X POST http://localhost:3000/api/trpc/mdm.generateEnrollmentCode \
  -H "Content-Type: application/json" \
  -d '{"agentId": "AGT001", "deviceModel": "Sunmi V2 Pro"}'
```

### 9.2 Push MDM Command

```bash
# Lock device screen
curl -X POST http://localhost:3000/api/trpc/mdm.pushCommand \
  -H "Content-Type: application/json" \
  -d '{"deviceId": "device-001", "commandType": "LOCK_SCREEN"}'

# Trigger OTA update
curl -X POST http://localhost:3000/api/trpc/mdm.pushCommand \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "device-001",
    "commandType": "OTA_UPDATE",
    "params": {"firmwareVersion": "2.1.0"}
  }'
```

### 9.3 Supported MDM Commands

| Command                        | Description                    | Requires Device Admin |
| ------------------------------ | ------------------------------ | --------------------- |
| `LOCK_SCREEN`                  | Lock device screen immediately | Yes                   |
| `REBOOT`                       | Reboot device                  | Yes (Android 7+)      |
| `CLEAR_APP_DATA`               | Clear app data for package     | Yes (Android 9+)      |
| `SET_PASSCODE_POLICY`          | Enforce passcode complexity    | Yes                   |
| `WIPE_DEVICE`                  | Factory reset (irreversible)   | Yes                   |
| `ENABLE_WIFI` / `DISABLE_WIFI` | Toggle WiFi                    | No                    |
| `SCREENSHOT`                   | Capture screen                 | No                    |
| `OTA_UPDATE`                   | Trigger firmware update        | No                    |
| `SET_KIOSK_MODE`               | Enable/disable kiosk mode      | Yes (Android 6+)      |
| `PING`                         | Check device responsiveness    | No                    |

---

## 10. Monitoring & Alerting Reference

### 10.1 Key Dashboards

| Dashboard      | URL                                     | Purpose                                  |
| -------------- | --------------------------------------- | ---------------------------------------- |
| Main Overview  | http://localhost:3001/d/insureportal-overview | Transaction volume, error rates, latency |
| MDM Fleet      | http://localhost:3001/d/mdm-fleet       | Device health, compliance, heartbeats    |
| CBN Compliance | http://localhost:3001/d/cbn-compliance  | Daily limits, KYC rates, report status   |
| Infrastructure | http://localhost:3001/d/insureportal-infra    | CPU, memory, disk, network               |
| Kafka          | http://localhost:3001/d/kafka           | Consumer lag, throughput, partitions     |

### 10.2 Critical Alert Thresholds

| Alert                        | Threshold     | Severity | Action            |
| ---------------------------- | ------------- | -------- | ----------------- |
| Transaction error rate       | > 5% for 5min | Critical | Page on-call      |
| Transaction p99 latency      | > 3s for 5min | Warning  | Investigate       |
| MDM heartbeat queue depth    | > 10,000      | Warning  | Scale MDM engine  |
| CBN report submission failed | Any           | Critical | Manual submission |
| TigerBeetle node down        | Any           | Critical | Page on-call      |
| Vault sealed                 | Any           | Critical | Page on-call      |
| Fraud high score rate        | > 5%          | Warning  | Review thresholds |
| Agent daily limit breach     | Any           | Critical | Block transaction |
| OTA download failure rate    | > 10%         | Warning  | Check MinIO       |
| MDM device offline > 30min   | Any           | Warning  | Check device      |

### 10.3 Useful Prometheus Queries

```promql
# Transaction success rate (last 5 min)
rate(pos_transactions_total{status="success"}[5m]) /
rate(pos_transactions_total[5m])

# MDM devices offline for > 30 min
count(time() - mdm_device_last_seen_seconds > 1800)

# CBN daily limit utilisation by agent tier
pos_agent_daily_volume_naira / pos_agent_daily_limit_naira

# Kafka consumer lag
kafka_consumer_group_lag{group="insurance-portal-consumers"}

# OTA download success rate
rate(ota_download_total{status="success"}[5m]) /
rate(ota_download_total[5m])
```

---

## Contact

| Role                 | Contact              |
| -------------------- | -------------------- |
| Platform Engineering | platform@insureportal.ng   |
| Database             | dba@insureportal.ng        |
| Security             | security@insureportal.ng   |
| CBN Compliance       | compliance@insureportal.ng |
| On-Call              | +234-800-54LINK      |
