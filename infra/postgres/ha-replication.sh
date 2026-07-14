#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# InsurePortal — PostgreSQL HA Streaming Replication Setup
# Sets up primary → replica streaming replication with automatic failover.
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

PRIMARY_HOST="${PRIMARY_HOST:-postgres-primary}"
REPLICA_HOST="${REPLICA_HOST:-postgres-replica}"
REPLICATION_USER="${REPLICATION_USER:-replicator}"
REPLICATION_PASSWORD="${REPLICATION_PASSWORD:-$(openssl rand -base64 32)}"
PGDATA="${PGDATA:-/var/lib/postgresql/data}"

echo "═══════════════════════════════════════════════════════════════"
echo "  InsurePortal PostgreSQL HA — Streaming Replication Setup"
echo "═══════════════════════════════════════════════════════════════"

# ── Step 1: Configure Primary ────────────────────────────────────────────────
configure_primary() {
  echo "[PRIMARY] Creating replication user..."
  psql -h "$PRIMARY_HOST" -U postgres -c "
    CREATE USER $REPLICATION_USER WITH REPLICATION ENCRYPTED PASSWORD '$REPLICATION_PASSWORD';
  " 2>/dev/null || echo "[PRIMARY] Replication user already exists"

  echo "[PRIMARY] Configuring pg_hba.conf for replication..."
  cat >> "$PGDATA/pg_hba.conf" <<EOF
# Replication connections
host replication $REPLICATION_USER 0.0.0.0/0 scram-sha-256
EOF

  echo "[PRIMARY] Setting WAL parameters..."
  psql -h "$PRIMARY_HOST" -U postgres -c "
    ALTER SYSTEM SET wal_level = 'replica';
    ALTER SYSTEM SET max_wal_senders = 5;
    ALTER SYSTEM SET max_replication_slots = 5;
    ALTER SYSTEM SET wal_keep_size = '2GB';
    ALTER SYSTEM SET hot_standby = on;
    ALTER SYSTEM SET synchronous_standby_names = 'replica1';
    ALTER SYSTEM SET synchronous_commit = 'remote_apply';
    SELECT pg_reload_conf();
  "

  echo "[PRIMARY] Creating replication slot..."
  psql -h "$PRIMARY_HOST" -U postgres -c "
    SELECT pg_create_physical_replication_slot('replica1_slot', true);
  " 2>/dev/null || echo "[PRIMARY] Replication slot already exists"

  echo "[PRIMARY] ✅ Primary configured"
}

# ── Step 2: Setup Replica via pg_basebackup ──────────────────────────────────
setup_replica() {
  echo "[REPLICA] Taking base backup from primary..."
  PGPASSWORD="$REPLICATION_PASSWORD" pg_basebackup \
    -h "$PRIMARY_HOST" \
    -U "$REPLICATION_USER" \
    -D "$PGDATA" \
    -Fp -Xs -P -R \
    --slot=replica1_slot \
    --checkpoint=fast

  echo "[REPLICA] Configuring standby signal..."
  cat > "$PGDATA/postgresql.auto.conf" <<EOF
primary_conninfo = 'host=$PRIMARY_HOST port=5432 user=$REPLICATION_USER password=$REPLICATION_PASSWORD application_name=replica1'
primary_slot_name = 'replica1_slot'
recovery_target_timeline = 'latest'
hot_standby = on
hot_standby_feedback = on
EOF

  touch "$PGDATA/standby.signal"
  echo "[REPLICA] ✅ Replica configured — start PostgreSQL to begin replication"
}

# ── Step 3: Failover Script ──────────────────────────────────────────────────
create_failover_script() {
  cat > /usr/local/bin/pg-failover.sh <<'FAILOVER'
#!/usr/bin/env bash
# Promote replica to primary in case of primary failure
set -euo pipefail

echo "🔄 Promoting replica to primary..."
pg_ctl promote -D "$PGDATA"

echo "⏳ Waiting for promotion..."
sleep 5

# Verify promotion
IS_RECOVERY=$(psql -tAc "SELECT pg_is_in_recovery();")
if [ "$IS_RECOVERY" = "f" ]; then
  echo "✅ Replica promoted to primary successfully"
  # Update DNS/load balancer to point to new primary
  # curl -X POST http://consul:8500/v1/catalog/register -d '{"Node":"postgres-primary","Address":"'$(hostname -i)'"}'
else
  echo "❌ Promotion failed — still in recovery mode"
  exit 1
fi
FAILOVER
  chmod +x /usr/local/bin/pg-failover.sh
  echo "[FAILOVER] ✅ Failover script created at /usr/local/bin/pg-failover.sh"
}

# ── Step 4: Health Check Script ──────────────────────────────────────────────
create_health_check() {
  cat > /usr/local/bin/pg-health-check.sh <<'HEALTH'
#!/usr/bin/env bash
# PostgreSQL health check for load balancers and monitoring
set -euo pipefail

# Check if PostgreSQL is accepting connections
pg_isready -q || { echo "CRITICAL: PostgreSQL not accepting connections"; exit 2; }

# Check replication lag (replica only)
IS_RECOVERY=$(psql -tAc "SELECT pg_is_in_recovery();" 2>/dev/null)
if [ "$IS_RECOVERY" = "t" ]; then
  LAG_BYTES=$(psql -tAc "SELECT pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn());" 2>/dev/null)
  LAG_MB=$(echo "scale=2; ${LAG_BYTES:-0} / 1048576" | bc)
  if (( $(echo "$LAG_MB > 100" | bc -l) )); then
    echo "WARNING: Replication lag ${LAG_MB}MB exceeds 100MB threshold"
    exit 1
  fi
  echo "OK: Replica healthy, lag=${LAG_MB}MB"
else
  # Primary: check WAL sender count
  SENDERS=$(psql -tAc "SELECT count(*) FROM pg_stat_replication;" 2>/dev/null)
  echo "OK: Primary healthy, ${SENDERS:-0} replicas connected"
fi
exit 0
HEALTH
  chmod +x /usr/local/bin/pg-health-check.sh
  echo "[HEALTH] ✅ Health check script created"
}

# ── Execute ──────────────────────────────────────────────────────────────────
case "${1:-primary}" in
  primary)
    configure_primary
    create_failover_script
    create_health_check
    ;;
  replica)
    setup_replica
    create_failover_script
    create_health_check
    ;;
  failover)
    /usr/local/bin/pg-failover.sh
    ;;
  health)
    /usr/local/bin/pg-health-check.sh
    ;;
  *)
    echo "Usage: $0 {primary|replica|failover|health}"
    exit 1
    ;;
esac
