#!/bin/bash
# Database backup script for InsurePortal
# Usage: bash scripts/backup.sh
# Cron: 0 2 * * * cd /app && bash scripts/backup.sh >> /var/log/backup.log 2>&1

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups/insureportal}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/ngapp_${TIMESTAMP}.sql.gz"

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-ngapp}"
PGUSER="${PGUSER:-ngapp}"

mkdir -p "${BACKUP_DIR}"

echo "[$(date)] Starting backup of ${PGDATABASE}@${PGHOST}:${PGPORT}"

pg_dump \
  --host="${PGHOST}" \
  --port="${PGPORT}" \
  --username="${PGUSER}" \
  --dbname="${PGDATABASE}" \
  --format=custom \
  --compress=9 \
  --verbose \
  --no-owner \
  --no-acl \
  --file="${BACKUP_FILE%.gz}" \
  2>&1

# Compress the backup
gzip "${BACKUP_FILE%.gz}" 2>/dev/null || mv "${BACKUP_FILE%.gz}" "${BACKUP_FILE}"

# Verify backup file exists and has content
if [ ! -s "${BACKUP_FILE}" ] && [ ! -s "${BACKUP_FILE%.gz}" ]; then
  echo "[$(date)] ERROR: Backup file is empty or missing"
  exit 1
fi

BACKUP_SIZE=$(du -sh "${BACKUP_FILE}" 2>/dev/null || du -sh "${BACKUP_FILE%.gz}" 2>/dev/null | cut -f1)
echo "[$(date)] Backup complete: ${BACKUP_FILE} (${BACKUP_SIZE})"

# Rotate old backups
echo "[$(date)] Removing backups older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -name "ngapp_*.sql*" -mtime +${RETENTION_DAYS} -delete -print
REMAINING=$(ls -1 "${BACKUP_DIR}"/ngapp_*.sql* 2>/dev/null | wc -l)
echo "[$(date)] ${REMAINING} backup(s) remaining after rotation"

# WAL archiving hint
if [ "${ENABLE_WAL_ARCHIVING:-false}" = "true" ]; then
  echo "[$(date)] WAL archiving enabled — ensure postgresql.conf has:"
  echo "  archive_mode = on"
  echo "  archive_command = 'cp %p ${BACKUP_DIR}/wal/%f'"
  echo "  wal_level = replica"
fi

echo "[$(date)] Backup process complete"
