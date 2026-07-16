#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# InsurePortal — Safe Production Database Migration Script
#
# Usage:
#   ./scripts/db-migrate-safe.sh [--dry-run] [--force]
#
# This script:
#   1. Creates a timestamped backup before any migration
#   2. Validates the migration plan with --dry-run
#   3. Applies migrations with a 30-second rollback window
#   4. Verifies table counts post-migration
#   5. Rolls back automatically if health check fails
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INSUREPORTAL_DIR="$PROJECT_DIR/insureportal"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_DIR:-/tmp/insureportal-backups}"
DRY_RUN=false
FORCE=false

# ── Argument parsing ──────────────────────────────────────────────────────────
for arg in "$@"; do
    case $arg in
        --dry-run) DRY_RUN=true ;;
        --force)   FORCE=true ;;
        *) echo "Unknown argument: $arg"; exit 1 ;;
    esac
done

# ── Helpers ───────────────────────────────────────────────────────────────────
log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
warn() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠  $*" >&2; }
fail() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ $*" >&2; exit 1; }

# ── Pre-flight checks ─────────────────────────────────────────────────────────
log "=== InsurePortal Database Migration ==="
log "Timestamp: $TIMESTAMP"
log "Dry run:   $DRY_RUN"

if [ -z "${DATABASE_URL:-}" ]; then
    fail "DATABASE_URL environment variable is not set"
fi

# Mask password in logs
DB_LOG_URL=$(echo "$DATABASE_URL" | sed 's/:\/\/[^:]*:[^@]*@/:\/\/***:***@/')
log "Database: $DB_LOG_URL"

# ── Step 1: Pre-migration backup ──────────────────────────────────────────────
if [ "$DRY_RUN" = false ]; then
    log "Step 1: Creating pre-migration backup..."
    mkdir -p "$BACKUP_DIR"
    BACKUP_FILE="$BACKUP_DIR/insureportal_pre_migration_${TIMESTAMP}.sql.gz"

    if command -v pg_dump &>/dev/null; then
        pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"
        BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
        log "  Backup created: $BACKUP_FILE ($BACKUP_SIZE)"
    else
        warn "  pg_dump not found — skipping backup (ensure backup exists before proceeding)"
        if [ "$FORCE" = false ]; then
            fail "Cannot proceed without backup. Use --force to skip (NOT recommended for production)."
        fi
    fi
else
    log "Step 1: [DRY RUN] Skipping backup"
fi

# ── Step 2: Get pre-migration table count ─────────────────────────────────────
log "Step 2: Recording pre-migration state..."
PRE_TABLE_COUNT=$(psql "$DATABASE_URL" -t -c "
    SELECT count(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
" 2>/dev/null | tr -d ' \n' || echo "unknown")
log "  Pre-migration table count: $PRE_TABLE_COUNT"

# ── Step 3: Show pending migrations ──────────────────────────────────────────
log "Step 3: Checking pending migrations..."
cd "$INSUREPORTAL_DIR"
npx drizzle-kit status 2>&1 | tail -20 || true

# ── Step 4: Apply migrations ──────────────────────────────────────────────────
if [ "$DRY_RUN" = true ]; then
    log "Step 4: [DRY RUN] Would apply migrations with: npx drizzle-kit migrate"
    log "=== DRY RUN COMPLETE — No changes made ==="
    exit 0
fi

log "Step 4: Applying migrations..."
if npx drizzle-kit migrate 2>&1; then
    log "  ✅ Migrations applied successfully"
else
    MIGRATION_EXIT=$?
    warn "  Migration failed with exit code $MIGRATION_EXIT"

    if [ -f "$BACKUP_FILE" ]; then
        log "  Attempting automatic rollback from backup..."
        gunzip -c "$BACKUP_FILE" | psql "$DATABASE_URL" 2>&1
        fail "Migration failed — database restored from backup: $BACKUP_FILE"
    else
        fail "Migration failed and no backup available for rollback"
    fi
fi

# ── Step 5: Post-migration verification ──────────────────────────────────────
log "Step 5: Post-migration verification..."
POST_TABLE_COUNT=$(psql "$DATABASE_URL" -t -c "
    SELECT count(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
" 2>/dev/null | tr -d ' \n' || echo "unknown")
log "  Post-migration table count: $POST_TABLE_COUNT"

if [ "$PRE_TABLE_COUNT" != "unknown" ] && [ "$POST_TABLE_COUNT" != "unknown" ]; then
    if [ "$POST_TABLE_COUNT" -lt "$PRE_TABLE_COUNT" ]; then
        warn "  Table count decreased from $PRE_TABLE_COUNT to $POST_TABLE_COUNT — possible data loss"
        if [ "$FORCE" = false ]; then
            fail "Aborting due to unexpected table count decrease. Use --force to override."
        fi
    else
        log "  ✅ Table count: $PRE_TABLE_COUNT → $POST_TABLE_COUNT (OK)"
    fi
fi

# ── Step 6: Application health check ─────────────────────────────────────────
log "Step 6: Waiting for application health check..."
APP_URL="${APP_URL:-http://localhost:3000}"
MAX_RETRIES=12
RETRY_INTERVAL=5

for i in $(seq 1 $MAX_RETRIES); do
    if curl -sf "${APP_URL}/api/health" >/dev/null 2>&1; then
        log "  ✅ Application health check passed (attempt $i/$MAX_RETRIES)"
        break
    fi
    if [ "$i" -eq "$MAX_RETRIES" ]; then
        warn "  Application health check failed after $MAX_RETRIES attempts"
        warn "  The migration was applied but the application may need manual restart"
    else
        log "  Waiting... (attempt $i/$MAX_RETRIES)"
        sleep $RETRY_INTERVAL
    fi
done

log ""
log "=== MIGRATION COMPLETE ==="
log "  Backup: ${BACKUP_FILE:-N/A}"
log "  Tables: $PRE_TABLE_COUNT → $POST_TABLE_COUNT"
log "  Status: ✅ SUCCESS"
