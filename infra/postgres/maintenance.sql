-- ═══════════════════════════════════════════════════════════════════════════════
-- InsurePortal — PostgreSQL Maintenance & Monitoring Queries
-- Schedule via pg_cron or external cron job.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Materialized View Refresh (run every 15 min) ────────────────────────
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_agent_summary;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hourly_platform_kpis;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_agent_leaderboard;

-- ─── 2. Table Bloat Detection ───────────────────────────────────────────────
-- Shows tables with significant dead tuple ratio (candidates for VACUUM FULL)
SELECT
  schemaname || '.' || relname AS table_name,
  n_live_tup AS live_tuples,
  n_dead_tup AS dead_tuples,
  ROUND(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_pct,
  last_autovacuum,
  last_autoanalyze
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY dead_pct DESC
LIMIT 20;

-- ─── 3. Index Usage Statistics ──────────────────────────────────────────────
-- Identifies unused indexes (candidates for removal to save write overhead)
SELECT
  schemaname || '.' || relname AS table_name,
  indexrelname AS index_name,
  idx_scan AS times_used,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 30;

-- ─── 4. Slow Query Analysis (requires pg_stat_statements) ──────────────────
SELECT
  LEFT(query, 120) AS query_preview,
  calls,
  ROUND(total_exec_time::numeric, 2) AS total_ms,
  ROUND(mean_exec_time::numeric, 2) AS mean_ms,
  ROUND(max_exec_time::numeric, 2) AS max_ms,
  rows
FROM pg_stat_statements
WHERE userid = (SELECT usesysid FROM pg_user WHERE usename = 'insureportal')
ORDER BY mean_exec_time DESC
LIMIT 20;

-- ─── 5. Table Size Report ───────────────────────────────────────────────────
SELECT
  relname AS table_name,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  pg_size_pretty(pg_relation_size(relid)) AS data_size,
  pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS index_size,
  n_live_tup AS row_count
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 30;

-- ─── 6. Active Connections ──────────────────────────────────────────────────
SELECT
  datname AS database,
  usename AS user,
  state,
  COUNT(*) AS connections,
  MAX(EXTRACT(EPOCH FROM (NOW() - backend_start))) AS max_age_seconds
FROM pg_stat_activity
WHERE datname = 'insureportal'
GROUP BY datname, usename, state
ORDER BY connections DESC;

-- ─── 7. Lock Contention ────────────────────────────────────────────────────
SELECT
  blocked_locks.pid AS blocked_pid,
  blocked_activity.usename AS blocked_user,
  blocking_locks.pid AS blocking_pid,
  blocking_activity.usename AS blocking_user,
  blocked_activity.query AS blocked_query,
  blocking_activity.query AS blocking_query
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks
  ON blocking_locks.locktype = blocked_locks.locktype
  AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
  AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
  AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
  AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
  AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
  AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
  AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
  AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
  AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
  AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;

-- ─── 8. Cache Hit Ratio (should be > 99%) ──────────────────────────────────
SELECT
  'index' AS type,
  ROUND(100.0 * SUM(idx_blks_hit) / NULLIF(SUM(idx_blks_hit + idx_blks_read), 0), 2) AS hit_ratio
FROM pg_statio_user_indexes
UNION ALL
SELECT
  'table' AS type,
  ROUND(100.0 * SUM(heap_blks_hit) / NULLIF(SUM(heap_blks_hit + heap_blks_read), 0), 2) AS hit_ratio
FROM pg_statio_user_tables;

-- ─── 9. Replication Lag (for HA setups) ─────────────────────────────────────
SELECT
  client_addr,
  state,
  sent_lsn,
  write_lsn,
  flush_lsn,
  replay_lsn,
  pg_wal_lsn_diff(sent_lsn, replay_lsn) AS replay_lag_bytes,
  pg_size_pretty(pg_wal_lsn_diff(sent_lsn, replay_lsn)) AS replay_lag_pretty
FROM pg_stat_replication;

-- ─── 10. Partition Management (auto-create next month) ─────────────────────
-- Run monthly via pg_cron:
-- SELECT cron.schedule('create-tx-partition', '0 0 25 * *',
--   $$SELECT create_next_month_partition('transactions_partitioned')$$);
