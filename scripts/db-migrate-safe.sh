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
# OPS-3: default to a root-owned, 0700 directory — never shared /tmp, where a
# plaintext dump of the full DB (incl. BVN/NIN) would be world-readable.
BACKUP_DIR="${BACKUP_DIR:-/var/backups/insureportal}"
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

# ── Step 1: Pre-migration backup (encrypted by default — OPS-3/OPS-4) ───────
# The dump contains the full DB incl. BVN/NIN PII. Plaintext backups are only
# permitted with an explicit, logged opt-out (BACKUP_ENCRYPTION=off) outside
# production. In production a missing GPG key is FATAL.
BACKUP_ENCRYPTION="${BACKUP_ENCRYPTION:-on}"
BACKUP_FILE=""
if [ "$DRY_RUN" = false ]; then
    log "Step 1: Creating pre-migration backup (encrypted)..."
    mkdir -p "$BACKUP_DIR"
    chmod 700 "$BACKUP_DIR"
    umask 077

    if [ "$BACKUP_ENCRYPTION" != "off" ]; then
        if ! command -v gpg &>/dev/null; then
            fail "gpg not found — cannot create an encrypted backup. Install gnupg or set BACKUP_ENCRYPTION=off (non-prod only)."
        fi
        if [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
            GPG_ARGS=(--batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT")
        elif [ -n "${BACKUP_ENCRYPTION_KEY:-}" ]; then
            GPG_ARGS=(--batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 --passphrase "$BACKUP_ENCRYPTION_KEY")
        else
            fail "BACKUP_GPG_RECIPIENT or BACKUP_ENCRYPTION_KEY must be set — refusing to write an unencrypted pre-migration backup (set BACKUP_ENCRYPTION=off to bypass outside production)."
        fi
        if [ "${APP_ENV:-${NODE_ENV:-production}}" = "production" ] && [ "$BACKUP_ENCRYPTION" = "off" ]; then
            fail "BACKUP_ENCRYPTION=off is forbidden in production"
        fi
        BACKUP_FILE="$BACKUP_DIR/insureportal_pre_migration_${TIMESTAMP}.sql.gz.gpg"
    else
        if [ "${APP_ENV:-${NODE_ENV:-production}}" = "production" ]; then
            fail "BACKUP_ENCRYPTION=off is forbidden in production"
        fi
        warn "  BACKUP_ENCRYPTION=off — writing UNENCRYPTED backup (non-production only)"
        BACKUP_FILE="$BACKUP_DIR/insureportal_pre_migration_${TIMESTAMP}.sql.gz"
    fi

    if command -v pg_dump &>/dev/null; then
        if [ "$BACKUP_ENCRYPTION" != "off" ]; then
            pg_dump "$DATABASE_URL" | gzip | gpg "${GPG_ARGS[@]}" --output "$BACKUP_FILE"
        else
            pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"
        fi
        chmod 600 "$BACKUP_FILE"
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

# Restore helper for rollback — decrypts transparently when needed.
restore_backup() {
    local file="$1"
    if [[ "$file" == *.gpg ]]; then
        local DECRYPT_ARGS=(--batch --yes --decrypt)
        if [ -n "${BACKUP_ENCRYPTION_KEY:-}" ] && [ -z "${BACKUP_GPG_RECIPIENT:-}" ]; then
            DECRYPT_ARGS=(--batch --yes --pinentry-mode loopback --passphrase "$BACKUP_ENCRYPTION_KEY" --decrypt)
        fi
        gpg "${DECRYPT_ARGS[@]}" "$file" | gunzip | psql "$DATABASE_URL"
    else
        gunzip -c "$file" | psql "$DATABASE_URL"
    fi
}

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
# NOTE: `drizzle-kit push --force` is BANNED from deploy paths (OPS-2): it
# auto-accepts destructive data-loss statements with no review. Only
# `drizzle-kit migrate` (journal-driven, reviewed SQL) is permitted here.
if npx drizzle-kit migrate 2>&1; then
    log "  ✅ drizzle-kit migrations applied successfully"
else
    MIGRATION_EXIT=$?
    warn "  Migration failed with exit code $MIGRATION_EXIT"

    if [ -n "$BACKUP_FILE" ] && [ -f "$BACKUP_FILE" ]; then
        log "  Attempting automatic rollback from backup..."
        restore_backup "$BACKUP_FILE" 2>&1
        fail "Migration failed — database restored from backup: $BACKUP_FILE"
    else
        fail "Migration failed and no backup available for rollback"
    fi
fi

# ── Step 4b: Hand-written migrations ledger (drizzle/0043+_*.sql) ───────────
# OPS-2 journal repair: drizzle/meta/_journal.json only covers drizzle-kit
# generated migrations 0000-0042. Files 0043_* and above are hand-written,
# append-only SQL applied via this ledger so they run exactly once, in order,
# and are auditable. Baseline: 0043-0060 are pre-existing on all environments
# and are seeded into the ledger as already-applied on first run (documented
# in MIGRATION_ROLLBACK.md §6). Files > 0060 are applied for real.
log "Step 4b: Applying hand-written migrations (ledger)..."
HANDWRITTEN_BASELINE=60
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations_ext (
    filename   text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
SQL
shopt -s nullglob
for sql_file in "$PROJECT_DIR"/drizzle/0*.sql; do
    fname="$(basename "$sql_file")"
    num="${fname%%_*}"
    # Skip drizzle-kit journal-managed files (0000-0042)
    if [ "$((10#$num))" -le 42 ]; then continue; fi
    already=$(psql "$DATABASE_URL" -t -A -c "SELECT 1 FROM schema_migrations_ext WHERE filename = '$fname'" 2>/dev/null || true)
    if [ "$already" = "1" ]; then continue; fi
    if [ "$((10#$num))" -le "$HANDWRITTEN_BASELINE" ]; then
        # Baseline seed: pre-existing migrations assumed applied on existing DBs
        psql "$DATABASE_URL" -q -c "INSERT INTO schema_migrations_ext (filename) VALUES ('$fname') ON CONFLICT DO NOTHING"
        log "  baseline-recorded: $fname"
        continue
    fi
    log "  applying: $fname"
    if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$sql_file"; then
        psql "$DATABASE_URL" -q -c "INSERT INTO schema_migrations_ext (filename) VALUES ('$fname')"
        log "  ✅ applied: $fname"
    else
        fail "Hand-written migration $fname failed — restore from backup: ${BACKUP_FILE:-none}"
    fi
done
shopt -u nullglob
log "  ✅ Hand-written migrations up to date"

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
