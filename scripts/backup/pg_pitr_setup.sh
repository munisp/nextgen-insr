#!/usr/bin/env bash
# ─── InsurePortal Point-in-Time Recovery (PITR) Setup ─────────────────────────
# Configures continuous WAL archiving for point-in-time recovery.
# This script sets up WAL archiving to S3 for disaster recovery.
#
# Prerequisites:
#   - PostgreSQL 14+ with superuser access
#   - AWS CLI configured with S3 write access
#   - pgBackRest or WAL-G installed
#
# For managed PostgreSQL (AWS RDS, GCP Cloud SQL, Azure):
#   - PITR is built-in — enable via console/terraform
#   - RDS: Enable automated backups, set retention to 35 days
#   - Cloud SQL: Enable point-in-time recovery in instance settings
#   - Azure: Enabled by default with 7-day retention

set -euo pipefail

echo "════════════════════════════════════════════════════"
echo "  InsurePortal PITR Setup"
echo "════════════════════════════════════════════════════"

# Check if using managed PostgreSQL
if [ -n "${RDS_INSTANCE_ID:-}" ]; then
    echo "Detected AWS RDS instance: ${RDS_INSTANCE_ID}"
    echo "Enabling automated backups with 35-day retention..."
    aws rds modify-db-instance \
        --db-instance-identifier "${RDS_INSTANCE_ID}" \
        --backup-retention-period 35 \
        --preferred-backup-window "02:00-03:00" \
        --apply-immediately
    echo "RDS PITR configured. Recovery via:"
    echo "  aws rds restore-db-instance-to-point-in-time \\"
    echo "    --source-db-instance-identifier ${RDS_INSTANCE_ID} \\"
    echo "    --target-db-instance-identifier insureportal-recovery \\"
    echo "    --restore-time 2026-06-08T00:00:00Z"
    exit 0
fi

# Self-hosted PostgreSQL with WAL-G
if command -v wal-g &>/dev/null; then
    echo "WAL-G detected. Configuring continuous archiving..."

    # Set WAL-G environment
    export WALG_S3_PREFIX="${BACKUP_S3_BUCKET:?Set BACKUP_S3_BUCKET}/wal-archive"
    export PGDATA="${PGDATA:-/var/lib/postgresql/data}"

    # Configure postgresql.conf for WAL archiving
    cat >> "${PGDATA}/conf.d/pitr.conf" <<EOF
# InsurePortal PITR Configuration
wal_level = replica
archive_mode = on
archive_command = 'wal-g wal-push %p'
archive_timeout = 60
max_wal_senders = 3
wal_keep_size = '1GB'
EOF

    echo "WAL archiving configured. Restart PostgreSQL to apply."
    echo ""
    echo "To perform PITR recovery:"
    echo "  1. wal-g backup-fetch LATEST"
    echo "  2. Create recovery.signal in PGDATA"
    echo "  3. Set restore_command = 'wal-g wal-fetch %f %p'"
    echo "  4. Set recovery_target_time = '2026-06-08 00:00:00'"
    echo "  5. Start PostgreSQL"
else
    echo "WAL-G not found. Install with:"
    echo "  curl -L https://github.com/wal-g/wal-g/releases/latest/download/wal-g-pg-ubuntu-20.04-amd64.tar.gz | tar xz -C /usr/local/bin/"
    echo ""
    echo "Alternatively, use pgBackRest:"
    echo "  apt-get install pgbackrest"
fi
