#!/usr/bin/env bash
# ─── InsurePortal Database Backup Script ──────────────────────────────────────
# Automated daily backup with retention policy and verification.
# Schedule: cron — 0 2 * * * /opt/insureportal/scripts/backup/pg_backup.sh
#
# Required env vars:
#   DATABASE_URL        — PostgreSQL connection string
#   BACKUP_S3_BUCKET    — S3 bucket for backup storage (optional, stores locally if unset)
#   BACKUP_RETENTION_DAYS — Days to retain backups (default: 30)
#   BACKUP_ENCRYPTION_KEY — GPG key ID for encryption (optional)
#   SLACK_WEBHOOK_URL   — Slack webhook for notifications (optional)

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────

BACKUP_DIR="${BACKUP_DIR:-/var/backups/insureportal}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="insureportal_${TIMESTAMP}"
LOG_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.log"

mkdir -p "${BACKUP_DIR}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOG_FILE}"
}

notify() {
    local message="$1"
    local color="${2:-good}"
    if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
        curl -s -X POST "${SLACK_WEBHOOK_URL}" \
            -H 'Content-Type: application/json' \
            -d "{\"attachments\":[{\"color\":\"${color}\",\"text\":\"${message}\"}]}" || true
    fi
}

# ─── Pre-flight Checks ───────────────────────────────────────────────────────

if [ -z "${DATABASE_URL:-}" ]; then
    log "FATAL: DATABASE_URL is required"
    notify "🔴 Backup FAILED: DATABASE_URL not configured" "danger"
    exit 1
fi

if ! command -v pg_dump &>/dev/null; then
    log "FATAL: pg_dump not found"
    notify "🔴 Backup FAILED: pg_dump not installed" "danger"
    exit 1
fi

# Check disk space (require at least 10GB free)
AVAIL_KB=$(df "${BACKUP_DIR}" | tail -1 | awk '{print $4}')
if [ "${AVAIL_KB}" -lt 10485760 ]; then
    log "WARNING: Less than 10GB free disk space"
    notify "⚠️ Backup WARNING: Low disk space (${AVAIL_KB}KB available)" "warning"
fi

log "Starting backup: ${BACKUP_NAME}"

# ─── Full Database Dump ───────────────────────────────────────────────────────

log "Step 1/5: Running pg_dump (custom format, compressed)..."
pg_dump "${DATABASE_URL}" \
    --format=custom \
    --compress=9 \
    --verbose \
    --file="${BACKUP_DIR}/${BACKUP_NAME}.dump" \
    2>>"${LOG_FILE}"

DUMP_SIZE=$(du -sh "${BACKUP_DIR}/${BACKUP_NAME}.dump" | cut -f1)
log "Dump complete: ${DUMP_SIZE}"

# ─── Schema-Only Backup ──────────────────────────────────────────────────────

log "Step 2/5: Schema-only backup..."
pg_dump "${DATABASE_URL}" \
    --schema-only \
    --file="${BACKUP_DIR}/${BACKUP_NAME}_schema.sql" \
    2>>"${LOG_FILE}"

# ─── Verify Backup Integrity ─────────────────────────────────────────────────

log "Step 3/5: Verifying backup integrity..."
pg_restore --list "${BACKUP_DIR}/${BACKUP_NAME}.dump" > "${BACKUP_DIR}/${BACKUP_NAME}_toc.txt" 2>>"${LOG_FILE}"
TABLE_COUNT=$(grep -c "TABLE" "${BACKUP_DIR}/${BACKUP_NAME}_toc.txt" || echo "0")
log "Backup contains ${TABLE_COUNT} table definitions"

if [ "${TABLE_COUNT}" -lt 10 ]; then
    log "WARNING: Fewer than 10 tables in backup — may be incomplete"
    notify "⚠️ Backup WARNING: Only ${TABLE_COUNT} tables found" "warning"
fi

# Generate SHA256 checksum
sha256sum "${BACKUP_DIR}/${BACKUP_NAME}.dump" > "${BACKUP_DIR}/${BACKUP_NAME}.sha256"
log "Checksum: $(cat "${BACKUP_DIR}/${BACKUP_NAME}.sha256")"

# ─── Encrypt (if key provided) ───────────────────────────────────────────────

if [ -n "${BACKUP_ENCRYPTION_KEY:-}" ]; then
    log "Step 3b: Encrypting backup..."
    gpg --batch --yes --recipient "${BACKUP_ENCRYPTION_KEY}" \
        --output "${BACKUP_DIR}/${BACKUP_NAME}.dump.gpg" \
        --encrypt "${BACKUP_DIR}/${BACKUP_NAME}.dump"
    rm "${BACKUP_DIR}/${BACKUP_NAME}.dump"
    log "Encrypted backup created"
fi

# ─── Upload to S3 (if configured) ────────────────────────────────────────────

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
    log "Step 4/5: Uploading to S3..."
    UPLOAD_FILE="${BACKUP_DIR}/${BACKUP_NAME}.dump"
    [ -f "${BACKUP_DIR}/${BACKUP_NAME}.dump.gpg" ] && UPLOAD_FILE="${BACKUP_DIR}/${BACKUP_NAME}.dump.gpg"

    aws s3 cp "${UPLOAD_FILE}" "s3://${BACKUP_S3_BUCKET}/backups/${BACKUP_NAME}/" \
        --storage-class STANDARD_IA 2>>"${LOG_FILE}"
    aws s3 cp "${BACKUP_DIR}/${BACKUP_NAME}_schema.sql" "s3://${BACKUP_S3_BUCKET}/backups/${BACKUP_NAME}/" 2>>"${LOG_FILE}"
    aws s3 cp "${BACKUP_DIR}/${BACKUP_NAME}.sha256" "s3://${BACKUP_S3_BUCKET}/backups/${BACKUP_NAME}/" 2>>"${LOG_FILE}"
    log "Upload complete"
else
    log "Step 4/5: Skipped (BACKUP_S3_BUCKET not set — local only)"
fi

# ─── Retention Cleanup ────────────────────────────────────────────────────────

log "Step 5/5: Cleaning backups older than ${RETENTION_DAYS} days..."
DELETED=$(find "${BACKUP_DIR}" -name "insureportal_*.dump*" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
find "${BACKUP_DIR}" -name "insureportal_*_schema.sql" -mtime +${RETENTION_DAYS} -delete
find "${BACKUP_DIR}" -name "insureportal_*.sha256" -mtime +${RETENTION_DAYS} -delete
find "${BACKUP_DIR}" -name "insureportal_*_toc.txt" -mtime +${RETENTION_DAYS} -delete
find "${BACKUP_DIR}" -name "backup_*.log" -mtime +${RETENTION_DAYS} -delete
log "Deleted ${DELETED} old backup files"

# ─── Summary ─────────────────────────────────────────────────────────────────

log "Backup complete: ${BACKUP_NAME}"
log "  Size: ${DUMP_SIZE}"
log "  Tables: ${TABLE_COUNT}"
log "  Retention: ${RETENTION_DAYS} days"

notify "✅ InsurePortal backup successful: ${BACKUP_NAME} (${DUMP_SIZE}, ${TABLE_COUNT} tables)" "good"
