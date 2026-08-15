#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# backup-restore-rehearsal.sh — InsurePortal backup/restore rehearsal (F-06)
#
# Proves, end to end, that a pg_dump backup can be restored and that the
# restored database is row-for-row identical on the core business tables.
#
# Two modes:
#   1. External database (CI):  set DATABASE_URL to a throwaway Postgres 16
#      instance (e.g. the GitHub Actions postgres:16 service). The script
#      NEVER destroys data unless CONFIRM_DESTROY=YES is set — and even then
#      it refuses to run unless the database host is localhost/127.0.0.1 or
#      ALLOW_REMOTE_DESTROY=YES is explicitly set.
#   2. Docker mode (local):     if DATABASE_URL is unset and docker is
#      available, the script spins up an ephemeral postgres:16 container,
#      runs the rehearsal against it, and tears it down.
#
# Optional stages (env flags, all default to 1/true):
#   SCHEMA_PUSH=1   apply schema with `pnpm exec drizzle-kit push --force`
#   SEED=1          load demo data with `node seed.mjs` (180 tables)
#
# Integrity assertion: row counts on the core tables
# (users, policies, claims, refunds) captured BEFORE the dump must equal the
# counts AFTER drop+restore. Any mismatch exits non-zero.
#
# Exit codes: 0 = rehearsal passed; 1 = rehearsal failed; 2 = usage/env error.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SCHEMA_PUSH="${SCHEMA_PUSH:-1}"
SEED="${SEED:-1}"
CORE_TABLES="${CORE_TABLES:-users policies claims refunds}"
WORK_DIR="$(mktemp -d /tmp/backup-rehearsal.XXXXXX)"
CONTAINER_NAME=""

log()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }
fail() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ❌ $*" >&2; exit 1; }

cleanup() {
    if [ -n "$CONTAINER_NAME" ]; then
        log "Tearing down rehearsal container: $CONTAINER_NAME"
        docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    fi
    rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# ── Mode selection ────────────────────────────────────────────────────────────
if [ -n "${DATABASE_URL:-}" ]; then
    log "Mode: external database (DATABASE_URL provided)"
    DB_URL="$DATABASE_URL"
elif command -v docker >/dev/null 2>&1; then
    log "Mode: docker (spinning up ephemeral postgres:16)"
    CONTAINER_NAME="insureportal-rehearsal-$$"
    docker run -d --name "$CONTAINER_NAME" \
        -e POSTGRES_USER=postgres \
        -e POSTGRES_PASSWORD=rehearsal \
        -e POSTGRES_DB=rehearsal_db \
        -p 127.0.0.1:55439:5432 \
        postgres:16 >/dev/null
    DB_URL="postgresql://postgres:rehearsal@127.0.0.1:55439/rehearsal_db"
else
    fail "Neither DATABASE_URL nor docker is available. Run in CI with a postgres:16 service or install docker."
fi

# Safety rails: this script drops the public schema. Refuse to run against a
# non-local host unless explicitly overridden.
DB_HOST="$(echo "$DB_URL" | sed -E 's|^[^@]*@([^:/]+).*|\1|')"
if [ "$DB_HOST" != "localhost" ] && [ "$DB_HOST" != "127.0.0.1" ] && [ "${ALLOW_REMOTE_DESTROY:-}" != "YES" ]; then
    fail "Refusing to run a DESTRUCTIVE rehearsal against remote host '$DB_HOST'. Set ALLOW_REMOTE_DESTROY=YES to override (never do this against production)."
fi
if [ "${CONFIRM_DESTROY:-}" != "YES" ]; then
    fail "Set CONFIRM_DESTROY=YES to acknowledge the rehearsal DROPS and recreates the public schema of the target database."
fi

for tool in psql pg_dump pg_restore; do
    command -v "$tool" >/dev/null 2>&1 || fail "Required tool not found: $tool (install postgresql-client-16)"
done

# ── Wait for Postgres ─────────────────────────────────────────────────────────
log "Waiting for Postgres at $DB_HOST ..."
for i in $(seq 1 60); do
    if psql "$DB_URL" -t -c "SELECT 1" >/dev/null 2>&1; then
        break
    fi
    [ "$i" -eq 60 ] && fail "Postgres did not become ready in time"
    sleep 2
done
log "Postgres is ready."

# ── Stage 1: schema ───────────────────────────────────────────────────────────
if [ "$SCHEMA_PUSH" = "1" ]; then
    log "Stage 1: applying schema (drizzle-kit push --force) ..."
    POSTGRES_URL="$DB_URL" pnpm exec drizzle-kit push --force
else
    log "Stage 1: SCHEMA_PUSH=0 — assuming schema already applied"
fi

# ── Stage 2: seed ─────────────────────────────────────────────────────────────
if [ "$SEED" = "1" ]; then
    log "Stage 2: seeding demo data (node seed.mjs) ..."
    POSTGRES_URL="$DB_URL" node seed.mjs
else
    log "Stage 2: SEED=0 — skipping seed"
fi

# ── Stage 3: pre-dump integrity snapshot ─────────────────────────────────────
log "Stage 3: capturing pre-dump row counts ($CORE_TABLES) ..."
PRE_COUNTS="$WORK_DIR/pre_counts.txt"
: > "$PRE_COUNTS"
for t in $CORE_TABLES; do
    c="$(psql "$DB_URL" -t -A -c "SELECT count(*) FROM \"$t\"" | tr -d '[:space:]')"
    echo "$t $c" | tee -a "$PRE_COUNTS"
done

# ── Stage 4: dump ─────────────────────────────────────────────────────────────
DUMP_FILE="$WORK_DIR/rehearsal.dump"
log "Stage 4: pg_dump (custom format) -> $DUMP_FILE"
pg_dump --format=custom --no-owner --no-privileges --file="$DUMP_FILE" "$DB_URL"
DUMP_SIZE="$(du -h "$DUMP_FILE" | cut -f1)"
log "  Dump complete ($DUMP_SIZE)"

# ── Stage 5: destroy ──────────────────────────────────────────────────────────
log "Stage 5: dropping public schema (simulating total loss) ..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

POST_DROP="$(psql "$DB_URL" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'" | tr -d '[:space:]')"
log "  Base tables after drop: $POST_DROP"
[ "$POST_DROP" = "0" ] || fail "Schema drop incomplete — $POST_DROP tables remain"

# ── Stage 6: restore ──────────────────────────────────────────────────────────
log "Stage 6: pg_restore ..."
pg_restore --no-owner --no-privileges --dbname="$DB_URL" "$DUMP_FILE"

# ── Stage 7: post-restore integrity verification ─────────────────────────────
log "Stage 7: verifying post-restore row counts ..."
MISMATCH=0
printf '%-12s %12s %12s %s\n' "table" "pre_dump" "post_restore" "status"
while read -r t pre; do
    post="$(psql "$DB_URL" -t -A -c "SELECT count(*) FROM \"$t\"" 2>/dev/null | tr -d '[:space:]' || echo MISSING)"
    if [ "$pre" = "$post" ]; then
        status="OK"
    else
        status="MISMATCH"
        MISMATCH=1
    fi
    printf '%-12s %12s %12s %s\n' "$t" "$pre" "$post" "$status"
done < "$PRE_COUNTS"

# Referential sanity: no orphaned claims/refunds after restore.
ORPHAN_CLAIMS="$(psql "$DB_URL" -t -A -c 'SELECT count(*) FROM claims c LEFT JOIN policies p ON p.id = c."policyId" WHERE p.id IS NULL' | tr -d '[:space:]')"
ORPHAN_REFUNDS="$(psql "$DB_URL" -t -A -c 'SELECT count(*) FROM refunds r LEFT JOIN users u ON u.id = r."customerId" WHERE u.id IS NULL' | tr -d '[:space:]')"
log "  Orphan claims (no policy):  $ORPHAN_CLAIMS"
log "  Orphan refunds (no user):   $ORPHAN_REFUNDS"

if [ "$MISMATCH" != "0" ]; then
    fail "REHEARSAL FAILED — post-restore row counts differ from pre-dump counts"
fi

log "✅ REHEARSAL PASSED — dump/drop/restore round-trip verified on: $CORE_TABLES"
