#!/usr/bin/env bash
# ─── InsurePortal Database Restore Script ─────────────────────────────────────
# Restore from a pg_dump backup file.
#
# Usage:
#   ./pg_restore.sh <backup_file> [--target-db <DATABASE_URL>] [--dry-run]
#
# Required env vars:
#   DATABASE_URL — PostgreSQL connection string (or use --target-db)

set -euo pipefail

BACKUP_FILE=""
TARGET_DB="${DATABASE_URL:-}"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target-db) TARGET_DB="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        *) BACKUP_FILE="$1"; shift ;;
    esac
done

if [ -z "${BACKUP_FILE}" ]; then
    echo "Usage: $0 <backup_file> [--target-db <URL>] [--dry-run]"
    exit 1
fi

if [ -z "${TARGET_DB}" ]; then
    echo "FATAL: Set DATABASE_URL or use --target-db"
    exit 1
fi

if [ ! -f "${BACKUP_FILE}" ]; then
    echo "FATAL: Backup file not found: ${BACKUP_FILE}"
    exit 1
fi

echo "════════════════════════════════════════════════════"
echo "  InsurePortal Database Restore"
echo "════════════════════════════════════════════════════"
echo "  Backup: ${BACKUP_FILE}"
echo "  Target: ${TARGET_DB%%@*}@****"
echo "  Dry Run: ${DRY_RUN}"
echo "════════════════════════════════════════════════════"

# Decrypt if needed
RESTORE_FILE="${BACKUP_FILE}"
if [[ "${BACKUP_FILE}" == *.gpg ]]; then
    echo "Decrypting backup..."
    RESTORE_FILE="${BACKUP_FILE%.gpg}"
    gpg --batch --yes --output "${RESTORE_FILE}" --decrypt "${BACKUP_FILE}"
fi

# Verify checksum if available
CHECKSUM_FILE="${RESTORE_FILE%.dump}.sha256"
if [ -f "${CHECKSUM_FILE}" ]; then
    echo "Verifying checksum..."
    sha256sum -c "${CHECKSUM_FILE}"
fi

# List contents
echo ""
echo "Backup contents:"
pg_restore --list "${RESTORE_FILE}" | head -20
echo "..."
TABLE_COUNT=$(pg_restore --list "${RESTORE_FILE}" | grep -c "TABLE" || echo "0")
echo "Total tables: ${TABLE_COUNT}"

if [ "${DRY_RUN}" = true ]; then
    echo ""
    echo "DRY RUN — no changes made. Remove --dry-run to execute."
    exit 0
fi

echo ""
echo "WARNING: This will overwrite the target database."
echo "Press Ctrl+C within 10 seconds to abort..."
sleep 10

echo "Restoring..."
pg_restore \
    --dbname="${TARGET_DB}" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --verbose \
    "${RESTORE_FILE}" 2>&1 | tail -20

echo ""
echo "Restore complete. Verifying..."

# Verify table count in restored DB
RESTORED_TABLES=$(psql "${TARGET_DB}" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'" 2>/dev/null | tr -d ' ')
echo "Tables in restored database: ${RESTORED_TABLES}"

echo "Done."
