# InsurePortal TigerBeetle Sidecar

The TB sidecar is a Go 1.22 HTTP microservice that provides an **offline-first double-entry ledger** for the InsurePortal POS terminal. It persists transactions to a local SQLite database immediately (even without internet), then syncs to the TigerBeetle Zig cluster and PostgreSQL when connectivity is restored.

---

## Architecture

```
POS Terminal
├── Node.js server (port 3000)   ← main app
│   └── tbClient.ts              ← 200ms timeout, falls back to PG-only
└── TB Sidecar (port 8030)       ← this service
    ├── SQLite (WAL mode)        ← offline ledger (immediate writes)
    ├── Sync engine              ← syncs to TigerBeetle Zig + PostgreSQL
    └── HTTP API                 ← POST /transfer, GET /health, GET /balance/:id
```

When the sidecar is unreachable, the Node.js server logs:

```
[TB] Sidecar unavailable — transaction <ref> persisted to PostgreSQL only
```

and sets `tb_synced = false` on the transaction row. Sync occurs automatically when the sidecar comes back online.

---

## Building the Binary

```bash
cd tb-sidecar
go build -o bin/tb-sidecar ./cmd/sidecar
```

Requires Go 1.22+. The compiled binary is approximately 18 MB.

---

## One-Command Deployment (POS Terminal Hardware)

Run as root on the target Linux terminal:

```bash
sudo bash scripts/install-sidecar.sh
```

This script will:

1. Create a `insureportal` system user (no login shell)
2. Install the TigerBeetle v0.16.78 Zig binary to `/usr/local/bin/tigerbeetle`
3. Install the sidecar binary to `/usr/local/bin/insureportal-tb-sidecar`
4. Install the start script to `/usr/local/bin/insureportal-start-sidecar.sh`
5. Create `/etc/insureportal/sidecar.env` (configuration file)
6. Register and enable `insureportal-tb-sidecar.service` (systemd)
7. Start the service immediately

After installation:

```bash
# Check health
curl http://localhost:8030/health

# View live logs
journalctl -u insureportal-tb-sidecar -f

# Restart
systemctl restart insureportal-tb-sidecar
```

---

## Configuration (`/etc/insureportal/sidecar.env`)

| Variable          | Default                   | Description                                    |
| ----------------- | ------------------------- | ---------------------------------------------- |
| `POSTGRES_URL`    | _(required for sync)_     | PostgreSQL connection string for metadata sync |
| `TB_REPLICA_ADDR` | `3000`                    | TigerBeetle Zig cluster replica address        |
| `SIDECAR_PORT`    | `8030`                    | HTTP port the sidecar listens on               |
| `DATA_DIR`        | `/var/lib/insureportal/tb-data` | Directory for SQLite + TigerBeetle data files  |

---

## HTTP API

| Method | Path           | Description                                                     |
| ------ | -------------- | --------------------------------------------------------------- |
| `POST` | `/transfer`    | Create a double-entry transfer (persists to SQLite immediately) |
| `GET`  | `/health`      | Returns `{"status":"ok","synced":N,"pending":N}`                |
| `GET`  | `/balance/:id` | Returns current balance for account ID                          |

### POST /transfer — Request Body

```json
{
  "debitAccountId": "1001",
  "creditAccountId": "2001",
  "amount": 500000,
  "currency": "NGN",
  "ref": "TXN20260330ABC123",
  "type": "cash_in"
}
```

---

## SMS Integration (Termii)

The main Node.js server uses Termii for SMS delivery (OTP codes, transaction receipts, daily settlement summaries). To activate live SMS:

1. Sign up at [https://termii.com](https://termii.com)
2. Navigate to **Settings → API Keys** and copy your key
3. In the Manus project, open **Settings → Secrets** and add:
   - `TERMII_API_KEY` — your Termii API key
4. Restart the server

When `TERMII_API_KEY` is not set, all SMS messages are logged to the server console instead of being sent — the platform continues to work normally.

---

## Systemd Unit (`scripts/insureportal-tb-sidecar.service`)

Key settings:

- `Restart=always` — auto-restarts on crash
- `RestartSec=5s` — 5-second delay between restarts
- `StartLimitBurst=5` — max 5 restarts in 60 seconds before giving up
- `MemoryMax=256M` — memory cap for POS terminal hardware
- `CPUQuota=25%` — CPU cap to leave headroom for the main app
- `NoNewPrivileges=true` / `PrivateTmp=true` — security hardening

---

## Offline-First Guarantee

The sidecar writes to SQLite **synchronously** before returning HTTP 200. Even if the TigerBeetle Zig cluster and PostgreSQL are both unreachable, every transaction is durably persisted locally. The sync engine retries in the background with exponential backoff.

| Scenario                    | Behaviour                                        |
| --------------------------- | ------------------------------------------------ |
| Sidecar running, PG online  | Writes to SQLite + syncs to PG immediately       |
| Sidecar running, PG offline | Writes to SQLite; syncs when PG comes back       |
| Sidecar unreachable         | Node.js falls back to PG-only; `tb_synced=false` |
| Both offline                | Node.js queues to IndexedDB; syncs when online   |
