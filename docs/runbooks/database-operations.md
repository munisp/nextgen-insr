# InsurePortal — Database Operations Runbook

## Backup & Restore

### Automated Backup (Daily)
```bash
# Full backup (compressed, with timestamp)
pg_dump -Fc -h $PGHOST -U insureportal -d insureportal \
  -f "/backups/insureportal-$(date +%Y%m%d-%H%M%S).dump"

# Verify backup integrity
pg_restore --list "/backups/insureportal-latest.dump" | head -20
```

### Point-in-Time Recovery
```bash
# Restore to specific timestamp
pg_restore -Fc -d insureportal_restore "/backups/insureportal-latest.dump"
psql -d insureportal_restore -c "SELECT pg_catalog.pg_xact_commit_timestamp(xmin) FROM pg_class LIMIT 1;"
```

### Emergency Restore
```bash
# Stop all services first
kubectl scale deployment --all --replicas=0 -n insureportal

# Drop and recreate database
psql -h $PGHOST -U postgres -c "DROP DATABASE insureportal;"
psql -h $PGHOST -U postgres -c "CREATE DATABASE insureportal OWNER insureportal;"

# Restore from latest backup
pg_restore -Fc -h $PGHOST -U insureportal -d insureportal "/backups/insureportal-latest.dump"

# Restart services
kubectl scale deployment --all --replicas=1 -n insureportal
```

## Schema Migration
```bash
# Run Drizzle migrations
npx drizzle-kit push:pg --config=drizzle.config.ts

# Verify migration status
npx drizzle-kit status --config=drizzle.config.ts
```

## Performance Monitoring
```bash
# Connection pool status
psql $DATABASE_URL -c "SELECT count(*), state FROM pg_stat_activity WHERE datname='insureportal' GROUP BY state;"

# Table sizes (top 20)
psql $DATABASE_URL -c "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 20;"

# Index usage
psql $DATABASE_URL -c "SELECT indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) FROM pg_stat_user_indexes WHERE idx_scan=0 AND schemaname='public' ORDER BY pg_relation_size(indexrelid) DESC LIMIT 20;"
```
