#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# MinIO Lakehouse Initialisation Script — InsurePortal Agency Banking Platform
#
# Creates all required buckets and sets lifecycle policies.
# Run once after MinIO starts: ./infra/minio/init-minio.sh
#
# Prerequisites:
#   - mc (MinIO Client) installed: https://min.io/docs/minio/linux/reference/minio-mc.html
#   - MinIO running at MINIO_ENDPOINT (default: http://localhost:9000)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin}"
ALIAS="insureportal"

# ── OPS-12: Fail-loud on default root credentials in production ──────────────
# minioadmin/minioadmin is the publicly-known MinIO default. Running this
# bootstrap against a default-cred server in production would leave the whole
# lakehouse (incl. the WORM audit bucket) owned by a guessable login.
APP_ENV="${APP_ENV:-${NODE_ENV:-development}}"
if [[ "${APP_ENV}" == "production" ]]; then
  if [[ "${MINIO_ACCESS_KEY}" == "minioadmin" || "${MINIO_SECRET_KEY}" == "minioadmin" ]]; then
    echo "[MinIO] ❌ FATAL: default MinIO credentials (minioadmin) detected in production." >&2
    echo "         Set MINIO_ACCESS_KEY / MINIO_SECRET_KEY to rotated, non-default values." >&2
    exit 1
  fi
  if [[ -z "${MINIO_ACCESS_KEY}" || -z "${MINIO_SECRET_KEY}" ]]; then
    echo "[MinIO] ❌ FATAL: MINIO_ACCESS_KEY / MINIO_SECRET_KEY must be explicitly set in production." >&2
    exit 1
  fi
fi

# ── OPS-1: WORM (object lock + retention) configuration for the audit bucket ─
# Object lock can only be enabled AT BUCKET CREATION TIME (mc mb --with-lock).
# AUDIT_RETENTION_MODE: governance (default; admins with special perms may
#   shorten) or compliance (absolute — not even root can delete before expiry).
# AUDIT_RETENTION_DAYS: NAICOM/CBN 7-year retention = 2555 days (default).
AUDIT_BUCKET="insureportal-audit-logs"
AUDIT_RETENTION_MODE="${AUDIT_RETENTION_MODE:-governance}"
AUDIT_RETENTION_DAYS="${AUDIT_RETENTION_DAYS:-2555}"
case "${AUDIT_RETENTION_MODE}" in
  governance|compliance) ;;
  *) echo "[MinIO] ❌ FATAL: AUDIT_RETENTION_MODE must be 'governance' or 'compliance' (got '${AUDIT_RETENTION_MODE}')" >&2; exit 1 ;;
esac

echo "[MinIO] Configuring mc alias → ${MINIO_ENDPOINT}"
mc alias set "${ALIAS}" "${MINIO_ENDPOINT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" --api S3v4

# ── Create buckets ────────────────────────────────────────────────────────────
BUCKETS=(
  "insureportal-transactions"      # Raw transaction records (Parquet)
  "insureportal-settlements"       # Daily settlement reports (CSV + Parquet)
  "insureportal-fraud-events"      # Fraud detection events (JSON)
  "insureportal-kyc-documents"     # KYC/KYB document uploads (encrypted)
  "insureportal-receipts"          # Generated PDF receipts
  "insureportal-audit-logs"        # Immutable audit trail (WORM)
  "insureportal-analytics"         # Aggregated analytics datasets
  "insureportal-backups"           # Database and config backups
  "insureportal-ota-packages"      # OTA firmware update packages
  "insureportal-agent-media"       # Agent profile photos and documents
)

for BUCKET in "${BUCKETS[@]}"; do
  if mc ls "${ALIAS}/${BUCKET}" &>/dev/null; then
    echo "[MinIO] Bucket already exists: ${BUCKET}"
  else
    if [[ "${BUCKET}" == "${AUDIT_BUCKET}" ]]; then
      # OPS-1: object lock MUST be enabled at creation time — this is what
      # makes the audit bucket actually WORM. A plain `mc mb` bucket can
      # never have retention enforced afterwards.
      mc mb --with-lock "${ALIAS}/${BUCKET}"
      echo "[MinIO] Created bucket WITH OBJECT LOCK (WORM): ${BUCKET}"
    else
      mc mb "${ALIAS}/${BUCKET}"
      echo "[MinIO] Created bucket: ${BUCKET}"
    fi
  fi
done

# ── Set versioning on critical buckets ────────────────────────────────────────
VERSIONED_BUCKETS=(
  "insureportal-transactions"
  "insureportal-settlements"
  "insureportal-audit-logs"
  "insureportal-kyc-documents"
)

for BUCKET in "${VERSIONED_BUCKETS[@]}"; do
  mc version enable "${ALIAS}/${BUCKET}"
  echo "[MinIO] Versioning enabled: ${BUCKET}"
done

# ── OPS-1: Enforce retention (WORM) on the audit bucket ─────────────────────
# `mc retention set` FAILS LOUDLY if the bucket was created without object
# lock — that is the desired behaviour: a non-WORM audit bucket is a
# deployment error, not a warning.
if mc retention set --default "${AUDIT_RETENTION_MODE}" "${AUDIT_RETENTION_DAYS}d" "${ALIAS}/${AUDIT_BUCKET}"; then
  echo "[MinIO] ✅ WORM retention set: ${AUDIT_BUCKET} (${AUDIT_RETENTION_MODE}, ${AUDIT_RETENTION_DAYS}d)"
else
  echo "[MinIO] ❌ FATAL: could not set retention on ${AUDIT_BUCKET}." >&2
  echo "         The bucket exists but was created WITHOUT object lock." >&2
  echo "         Repair (one-time, migrates existing objects):" >&2
  echo "           1. mc mirror ${ALIAS}/${AUDIT_BUCKET} /tmp/audit-migration" >&2
  echo "           2. mc rb --force ${ALIAS}/${AUDIT_BUCKET}" >&2
  echo "           3. mc mb --with-lock ${ALIAS}/${AUDIT_BUCKET}" >&2
  echo "           4. mc mirror /tmp/audit-migration ${ALIAS}/${AUDIT_BUCKET}" >&2
  echo "           5. re-run this script" >&2
  exit 1
fi
mc retention info "${ALIAS}/${AUDIT_BUCKET}" || true

# ── Set lifecycle policies ────────────────────────────────────────────────────
# Transactions: archive after 90 days, delete after 7 years (CBN compliance)
cat > /tmp/transactions-lifecycle.json << 'EOF'
{
  "Rules": [
    {
      "ID": "archive-old-transactions",
      "Status": "Enabled",
      "Filter": {"Prefix": ""},
      "Transition": {
        "Days": 90,
        "StorageClass": "GLACIER"
      },
      "Expiration": {
        "Days": 2555
      }
    }
  ]
}
EOF
mc ilm import "${ALIAS}/insureportal-transactions" < /tmp/transactions-lifecycle.json
echo "[MinIO] Lifecycle policy set: insureportal-transactions"

# Receipts: delete after 2 years
cat > /tmp/receipts-lifecycle.json << 'EOF'
{
  "Rules": [
    {
      "ID": "expire-old-receipts",
      "Status": "Enabled",
      "Filter": {"Prefix": ""},
      "Expiration": {
        "Days": 730
      }
    }
  ]
}
EOF
mc ilm import "${ALIAS}/insureportal-receipts" < /tmp/receipts-lifecycle.json
echo "[MinIO] Lifecycle policy set: insureportal-receipts"

# Backups: delete after 90 days
cat > /tmp/backups-lifecycle.json << 'EOF'
{
  "Rules": [
    {
      "ID": "expire-old-backups",
      "Status": "Enabled",
      "Filter": {"Prefix": ""},
      "Expiration": {
        "Days": 90
      }
    }
  ]
}
EOF
mc ilm import "${ALIAS}/insureportal-backups" < /tmp/backups-lifecycle.json
echo "[MinIO] Lifecycle policy set: insureportal-backups"

# ── Set bucket policies ───────────────────────────────────────────────────────
# KYC documents: private (no public access)
mc anonymous set none "${ALIAS}/insureportal-kyc-documents"
mc anonymous set none "${ALIAS}/insureportal-audit-logs"
mc anonymous set none "${ALIAS}/insureportal-backups"
echo "[MinIO] Private access enforced on sensitive buckets"

# ── Create service account for application ────────────────────────────────────
mc admin user add "${ALIAS}" "insureportal-app" "insureportal-app-secret-change-in-prod"
mc admin policy attach "${ALIAS}" readwrite --user "insureportal-app"
echo "[MinIO] Service account created: insureportal-app"

echo ""
echo "[MinIO] ✅ Lakehouse initialisation complete"
echo "  Buckets: ${#BUCKETS[@]} created"
echo "  Versioning: ${#VERSIONED_BUCKETS[@]} buckets"
echo "  Lifecycle policies: transactions (7yr), receipts (2yr), backups (90d)"

# ── Apply lifecycle policies from JSON files ──────────────────────────────────
# Screenshots: expire after 90 days, transition to GLACIER after 30 days
if [[ -f "/init/lifecycle/insureportal-screenshots-lifecycle.json" ]]; then
  mc mb "${ALIAS}/insureportal-screenshots" 2>/dev/null || true
  mc ilm import "${ALIAS}/insureportal-screenshots" < /init/lifecycle/insureportal-screenshots-lifecycle.json
  echo "[MinIO] Lifecycle policy set: insureportal-screenshots"
fi

# Firmware: expire old non-current versions after 1 year
if [[ -f "/init/lifecycle/insureportal-firmware-lifecycle.json" ]]; then
  mc mb "${ALIAS}/insureportal-firmware" 2>/dev/null || true
  mc ilm import "${ALIAS}/insureportal-firmware" < /init/lifecycle/insureportal-firmware-lifecycle.json
  echo "[MinIO] Lifecycle policy set: insureportal-firmware"
fi

# Lakehouse: tiered storage (hot→warm→cold→delete)
if [[ -f "/init/lifecycle/insureportal-lakehouse-lifecycle.json" ]]; then
  mc mb "${ALIAS}/insureportal-lakehouse" 2>/dev/null || true
  mc ilm import "${ALIAS}/insureportal-lakehouse" < /init/lifecycle/insureportal-lakehouse-lifecycle.json
  echo "[MinIO] Lifecycle policy set: insureportal-lakehouse"
fi

echo "[MinIO] ✅ All lifecycle policies applied"
