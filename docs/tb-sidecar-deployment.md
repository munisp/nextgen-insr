# TigerBeetle Sidecar — Deployment & Offline-Sync Verification Guide

## Overview

The **InsurePortal TB Sidecar** is a Go process that runs on every POS terminal alongside the Node.js server. It provides:

| Capability                            | Detail                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| **Offline-first double-entry ledger** | Commits transfers to a local SQLite WAL instantly, even without internet                |
| **Automatic upstream sync**           | Pushes committed transfers to the TigerBeetle Zig cluster when connectivity is restored |
| **PostgreSQL metadata mirror**        | Writes transfer metadata to the central PG database for reporting                       |
| **Agent float balance**               | Serves `/agent/{code}/balance` for real-time float queries from the Node.js server      |

---

## Prerequisites

| Requirement               | Version                                |
| ------------------------- | -------------------------------------- |
| Linux (x86_64 or aarch64) | Ubuntu 20.04+ / Debian 11+             |
| Go                        | 1.22+ (for building from source)       |
| systemd                   | For service management                 |
| TigerBeetle binary        | 0.16.78 (auto-downloaded by installer) |

---

## One-Command Installation

Run as root on the POS terminal after building the sidecar binary:

```bash
# Step 1: Build the Go binary (on the terminal or a build machine)
cd tb-sidecar
go build -o tb-sidecar ./cmd/sidecar
cd ..

# Step 2: Run the installer
sudo bash tb-sidecar/scripts/install-sidecar.sh
```

The installer performs these steps automatically:

1. Creates the `insureportal` system user and `/var/lib/insureportal/tb-data`, `/var/log/insureportal`, `/etc/insureportal` directories
2. Downloads and installs TigerBeetle v0.16.78 to `/usr/local/bin/tigerbeetle`
3. Installs the sidecar binary to `/usr/local/bin/insureportal-tb-sidecar`
4. Creates the environment file at `/etc/insureportal/sidecar.env`
5. Registers and starts the `insureportal-tb-sidecar` systemd service

---

## Configuration

Edit `/etc/insureportal/sidecar.env` after installation:

```bash
# PostgreSQL connection string for metadata sync
POSTGRES_URL=postgresql://posadmin:posinsureportal2026@db.insureportal.internal:5432/posinsureportal

# TigerBeetle cluster replica address (if running on a separate host)
# TB_REPLICA_ADDR=3000

# Sidecar HTTP port (must match TB_SIDECAR_URL in the Node.js server)
# Default: 7070
SIDECAR_PORT=7070
```

The Node.js server reads `TB_SIDECAR_URL` (default: `http://localhost:7070`). Set this in the POS terminal's `.env` or system environment if the sidecar runs on a different port.

---

## Service Management

```bash
# Check service status
systemctl status insureportal-tb-sidecar

# View live logs
journalctl -u insureportal-tb-sidecar -f

# Restart after config change
sudo systemctl restart insureportal-tb-sidecar

# Stop the service
sudo systemctl stop insureportal-tb-sidecar
```

---

## Health Check Verification

### 1. Sidecar HTTP health endpoint

```bash
curl http://localhost:7070/health
# Expected: {"status":"ok","service":"tb-sidecar","time":"2026-03-30T..."}
```

### 2. Node.js server health (includes sidecar status)

```bash
curl http://localhost:3000/api/health
# Expected: {"status":"ok","db":"connected","tbSidecar":"running",...}
```

The `tbSidecar` field reports one of:

- `"running"` — sidecar is reachable and healthy
- `"offline"` — sidecar is not responding (Node.js falls back to direct PG writes)
- `"not configured"` — `TB_SIDECAR_URL` is not set

### 3. Sync status

```bash
curl http://localhost:7070/sync/status
# Expected: {"pending":0,"synced":142,"failed":0,"postgres":"connected"}
```

---

## Offline-Sync Verification Steps

Use this procedure to verify that the sidecar correctly buffers transfers during a network outage and syncs them when connectivity is restored.

### Step 1: Confirm baseline health

```bash
curl http://localhost:7070/health        # status: ok
curl http://localhost:7070/sync/status   # pending: 0, postgres: connected
```

### Step 2: Simulate network outage

```bash
# Block outbound PostgreSQL traffic (port 5432)
sudo iptables -A OUTPUT -p tcp --dport 5432 -j DROP
```

### Step 3: Submit test transfers

Process 3–5 transactions through the POS terminal. Each transaction calls `tbCreateTransfer()` in the Node.js server, which POSTs to `http://localhost:7070/transfers`. The sidecar commits them to SQLite immediately.

```bash
# Verify transfers are queued locally
curl http://localhost:7070/sync/status
# Expected: {"pending":3,"synced":0,"failed":0,"postgres":"disconnected"}
```

### Step 4: Restore connectivity

```bash
sudo iptables -D OUTPUT -p tcp --dport 5432 -j DROP
```

### Step 5: Verify automatic sync

Wait up to 30 seconds (the default sync interval), then check:

```bash
curl http://localhost:7070/sync/status
# Expected: {"pending":0,"synced":3,"failed":0,"postgres":"connected"}
```

Verify the transfers appear in PostgreSQL:

```sql
SELECT id, ref, tx_type, amount_kobo, sync_status, synced_at
FROM tb_transfers
ORDER BY created_at DESC
LIMIT 5;
```

### Step 6: Verify agent balance

```bash
curl http://localhost:7070/agent/AGT001/balance
# Expected: {"agentCode":"AGT001","balanceKobo":1500000,"balanceNGN":15000.0}
```

---

## Startup Sequence

The correct startup order for a POS terminal is:

```
1. PostgreSQL (or confirm remote DB is reachable)
2. insureportal-tb-sidecar  (systemd: After=network.target)
3. insureportal-agent-dashboard   (Node.js server, reads TB_SIDECAR_URL)
```

The Node.js server starts successfully even if the sidecar is offline — all `tbClient.*` calls return `null` and the server falls back to direct PostgreSQL writes. The sidecar is an enhancement, not a hard dependency.

---

## Troubleshooting

| Symptom                                        | Cause                                    | Fix                                                                                    |
| ---------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `tbSidecar: "offline"` in `/api/health`        | Sidecar not running or wrong port        | `systemctl status insureportal-tb-sidecar`; check `SIDECAR_PORT`                             |
| `sync/status` shows `postgres: "disconnected"` | PG unreachable from terminal             | Check `POSTGRES_URL` in `/etc/insureportal/sidecar.env`                                      |
| `sync/status` shows `failed > 0`               | Transfers failed to sync after 3 retries | `journalctl -u insureportal-tb-sidecar -n 100` for error details                             |
| TigerBeetle binary not found                   | Installer skipped step 2                 | `sudo bash tb-sidecar/scripts/install-sidecar.sh` again                                |
| Port 7070 already in use                       | Another process on the port              | Change `SIDECAR_PORT` in `/etc/insureportal/sidecar.env` and `TB_SIDECAR_URL` in Node.js env |

---

## Architecture Diagram

```
POS Terminal
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  ┌─────────────────┐      HTTP :7070      ┌──────────┐  │
│  │  Node.js Server │ ──── tbCreateTransfer ──► TB     │  │
│  │  (agent-dashboard)    │ ◄─── tbGetBalance ────── Sidecar │  │
│  │                 │ ◄─── tbIsHealthy ────────(Go)    │  │
│  └────────┬────────┘                      └────┬─────┘  │
│           │ Direct PG (fallback)               │ Sync    │
│           ▼                                    ▼         │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              SQLite WAL (local ledger)              │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
└─────────────────────────┬───────────────────────────────┘
                          │ When online
                          ▼
              ┌───────────────────────┐
              │  TigerBeetle Cluster  │
              │  (Zig, port 3000)     │
              └───────────┬───────────┘
                          │
              ┌───────────▼───────────┐
              │  PostgreSQL (central) │
              │  tb_transfers table   │
              └───────────────────────┘
```
