# InsurePortal InsurePortal Platform — Production Deployment Guide

**Version:** Phase 136  
**Target:** Ubuntu 22.04 LTS, Docker 24+, 8 vCPU / 32 GB RAM minimum

---

## Architecture Overview

```
Internet
    │
    ▼
nginx (443/80) ─── TLS 1.3, HSTS, CSP
    │
    ├── /                → InsurePortal Platform (Node.js 22, port 3000)
    ├── /api/trpc/*      → APISix Gateway (rate limit, JWT auth)
    ├── /auth/*          → Keycloak OIDC (port 8080)
    ├── /grafana         → Grafana (port 3001)
    ├── /temporal-ui     → Temporal Web UI (port 8088)
    └── /vault           → HashiCorp Vault (port 8200)

InsurePortal Platform
    ├── PostgreSQL (port 5432)     — primary data store
    ├── Redis (port 6379)          — session + float + probe cache
    ├── Kafka (port 9092)          — event bus (tx.created, fraud.alert, sim.failover)
    ├── Fluvio (port 9003)         — real-time fraud stream processing
    ├── Temporal (port 7233)       — settlement workflow orchestration
    ├── TigerBeetle sidecar        — offline double-entry ledger
    └── MinIO (port 9000)          — Lakehouse object store

Observability
    ├── Prometheus (port 9090)     — metrics scraping
    ├── Grafana (port 3001)        — dashboards + alerts
    ├── Loki (port 3100)           — log aggregation
    └── Promtail                   — Docker log shipping → Loki
```

---

## Prerequisites

```bash
# Docker 24+ and Docker Compose v2
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Make
sudo apt-get install -y make

# Certbot (for Let's Encrypt)
sudo apt-get install -y certbot
```

---

## Step 1: Clone and Configure

```bash
git clone https://github.com/insureportal/platform-shell-demo.git
cd platform-shell-demo

# Copy environment template
cp .env.production.example .env.production

# Edit with your values
nano .env.production
```

**Required variables to set:**

| Variable                  | Description                                  |
| ------------------------- | -------------------------------------------- |
| `POSTGRES_PASSWORD`       | Strong random password for PostgreSQL        |
| `JWT_SECRET`              | 64-character random string for JWT signing   |
| `VAPID_PUBLIC_KEY`        | Web Push VAPID public key                    |
| `VAPID_PRIVATE_KEY`       | Web Push VAPID private key                   |
| `TERMII_API_KEY`          | Termii SMS API key (from termii.com)         |
| `KEYCLOAK_ADMIN_PASSWORD` | Keycloak admin console password              |
| `VAULT_ROOT_TOKEN`        | Initial Vault root token (change after init) |
| `MINIO_ROOT_PASSWORD`     | MinIO admin password                         |
| `DOMAIN`                  | Your production domain (e.g., pos.insureportal.io) |

---

## Step 2: TLS Certificates

```bash
make -f Makefile.production cert-init DOMAIN=pos.insureportal.io
```

This runs certbot in standalone mode. Ensure port 80 is open and DNS is pointed to your server.

For development/staging, use self-signed certificates:

```bash
mkdir -p infra/nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout infra/nginx/ssl/privkey.pem \
  -out infra/nginx/ssl/fullchain.pem \
  -subj "/CN=localhost"
```

---

## Step 3: Start Infrastructure Services

```bash
# Start core infrastructure (DB, Redis, Kafka, Vault)
make -f Makefile.production deploy-infra

# Wait for services to be healthy
make -f Makefile.production health
```

---

## Step 4: Initialise Vault

```bash
make -f Makefile.production vault-init
```

This runs `infra/vault/init-vault.sh` which:

1. Initialises Vault (generates unseal keys + root token)
2. Unseals Vault with 3 of 5 keys
3. Enables AppRole auth method
4. Creates `platform-shell-demo` policy
5. Seeds secrets: DB password, JWT secret, VAPID keys, Termii key

**Save the unseal keys and root token securely — they cannot be recovered.**

---

## Step 5: Create Kafka Topics

```bash
make -f Makefile.production kafka-topics
```

Creates:

- `tx.created` (3 partitions, replication factor 1)
- `tx.settled` (3 partitions)
- `fraud.alert` (3 partitions)
- `sim.failover` (1 partition)
- `workflow.events` (3 partitions)

---

## Step 6: Deploy Application

```bash
make -f Makefile.production deploy
```

This starts all services in the correct dependency order:

1. PostgreSQL → Redis → Kafka
2. Temporal → Fluvio → Keycloak → Permify
3. InsurePortal Platform (runs `pnpm db:push` on startup)
4. APISix → nginx
5. Prometheus → Loki → Promtail → Grafana

---

## Step 7: Seed Initial Data

```bash
# Create admin agent (AGT001 / PIN: 1234)
docker compose -f docker-compose.production.yml exec platform-shell pnpm seed

# Or run against local DB
pnpm seed
```

---

## Step 8: Verify Deployment

```bash
make -f Makefile.production health
```

Expected output:

```
✅ platform-shell      healthy (3000)
✅ postgres       healthy (5432)
✅ redis          healthy (6379)
✅ kafka          healthy (9092)
✅ temporal       healthy (7233)
✅ keycloak       healthy (8080)
✅ vault          healthy (8200)
✅ grafana        healthy (3001)
✅ prometheus     healthy (9090)
✅ loki           healthy (3100)
✅ minio          healthy (9000)
✅ nginx          healthy (443)
```

---

## Step 9: Configure Keycloak

1. Navigate to `https://your-domain/auth/admin`
2. Login with `admin` / `$KEYCLOAK_ADMIN_PASSWORD`
3. The `insureportal` realm is pre-imported from `infra/keycloak/realm-insureportal.json`
4. Configure SMTP: Realm Settings → Email
5. Create supervisor users and assign the `supervisor` role

---

## Step 10: Configure Grafana

1. Navigate to `https://your-domain/grafana`
2. Login with `admin` / `admin` (change immediately)
3. Datasources are pre-provisioned (Prometheus + Loki)
4. Dashboards are pre-provisioned (4 dashboards)
5. Configure alert webhooks: Alerting → Contact Points

---

## Updating

```bash
git pull origin main
make -f Makefile.production deploy
```

The `deploy` target runs `docker compose pull` then `docker compose up -d --build`.

---

## Rollback

```bash
# Rollback to previous image tag
docker compose -f docker-compose.production.yml up -d --no-deps platform-shell \
  --image ghcr.io/insureportal/platform-shell:previous-tag
```

---

## Scaling

```bash
# Scale InsurePortal Platform horizontally (requires Redis session sharing — already implemented)
docker compose -f docker-compose.production.yml up -d --scale platform-shell=3
```

Note: Socket.IO requires sticky sessions at the nginx level. The provided nginx config includes `ip_hash` for this purpose.

---

## Backup

```bash
# PostgreSQL backup
docker compose -f docker-compose.production.yml exec postgres \
  pg_dump -U postgres pos_shell > backup-$(date +%Y%m%d).sql

# MinIO backup (sync to S3)
mc mirror minio/insureportal-transactions s3/insureportal-backup/transactions/

# Redis backup (RDB snapshot)
docker compose -f docker-compose.production.yml exec redis \
  redis-cli BGSAVE
```

---

## TigerBeetle Sidecar (PAX A920)

The TB sidecar runs as a systemd service on the PAX terminal:

```bash
# On the PAX A920 terminal
scp tb-sidecar/tb-sidecar root@pax-terminal:/usr/local/bin/
scp tb-sidecar/insureportal-tb-sidecar.service root@pax-terminal:/etc/systemd/system/
ssh root@pax-terminal "systemctl enable --now insureportal-tb-sidecar"
```

---

## Rust SIM Daemon (PAX A920)

```bash
# Cross-compile for Android (aarch64)
cd pos-sim-orchestrator
make build-android

# Deploy to PAX terminal
adb push orchestrator/target/aarch64-linux-android/release/orchestrator /data/local/tmp/
adb shell chmod +x /data/local/tmp/orchestrator
adb shell /data/local/tmp/orchestrator
```
