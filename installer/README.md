# InsurePortal POS — Service Installer

A single self-contained Go binary that installs and manages the three InsurePortal POS microservices on any Linux POS terminal. No Go, Rust, or Python runtime is required on the target machine — all service binaries are embedded inside the installer.

## Services Installed

| Service                   | Port | Language             | Purpose                                           |
| ------------------------- | ---- | -------------------- | ------------------------------------------------- |
| `insureportal-resilience-agent` | 8031 | Go                   | Connection probe, carrier detection, retry engine |
| `insureportal-offline-queue`    | 8032 | Rust                 | Durable SQLite WAL queue, USSD encoder            |
| `insureportal-analytics`        | 8033 | Python (PyInstaller) | 7-day success rate analytics                      |

## Download

The pre-built installer binary is available at:

```
https://d2xsxph8kpxj0f.cloudfront.net/310519663412555753/8HPhiZd2Eco6WRGckejsZr/insureportal-installer_3661caad
```

Or build from source (requires Go 1.22+):

```bash
cd installer
go build -o bin/insureportal-installer ./cmd/installer/
```

## Usage

```bash
# Install all services (requires root)
sudo ./insureportal-installer

# Check running status
./insureportal-installer --status

# Remove all services (preserves data in /opt/insureportal/data)
sudo ./insureportal-installer --uninstall
```

## What the Installer Does

1. Creates `/opt/insureportal/bin/` and `/opt/insureportal/data/` directories
2. Creates a `insureportal` system user (no login shell)
3. Extracts the three service binaries from the embedded payload
4. Writes three systemd unit files to `/etc/systemd/system/`
5. Runs `systemctl daemon-reload && systemctl enable --now` for each service
6. Waits 3 seconds, then runs HTTP health checks on all three services
7. Prints a pass/fail summary — exits non-zero if any service fails

## Environment Variables

Set these before running the installer, or add them to the systemd unit `Environment=` lines after installation:

| Variable         | Service          | Description                  |
| ---------------- | ---------------- | ---------------------------- |
| `DATABASE_URL`   | analytics        | PostgreSQL connection string |
| `TERMII_API_KEY` | (Node.js app)    | Live SMS delivery key        |
| `ANALYTICS_PORT` | analytics        | Override default port 8033   |
| `PROBE_PORT`     | resilience-agent | Override default port 8031   |
| `QUEUE_PORT`     | offline-queue    | Override default port 8032   |

## Uninstall

```bash
sudo ./insureportal-installer --uninstall
```

This stops and disables all three systemd services, removes the unit files, and removes the binaries from `/opt/insureportal/bin/`. Data in `/opt/insureportal/data/` is preserved — remove manually if needed.
