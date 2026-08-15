# Backup & Restore Runbook — InsurePortal Platform

> **Status of RPO/RTO targets below: PROPOSED — pending owner sign-off.**
> The procedures and verification queries in this document are concrete and
> rehearsed in CI (see §6); the numeric targets are proposals that must be
> ratified by the platform owner before they are treated as commitments.

Remediates audit finding **F-06** (no backup/restore rehearsal evidence).
Related: `MIGRATION_ROLLBACK.md` (schema-change rollback), existing operational
scripts in `scripts/backup/`.

---

## 1. What exists today

| Asset | Path | Notes |
|---|---|---|
| Daily backup script | `scripts/backup/pg_backup.sh` | `pg_dump` → gzip, retention, optional S3 + GPG, Slack notify |
| Restore script | `scripts/backup/pg_restore.sh` | Restores a dump file into a target database |
| PITR setup | `scripts/backup/pg_pitr_setup.sh` | WAL archiving / point-in-time recovery bootstrap |
| **Nightly restore rehearsal (new)** | `scripts/backup-restore-rehearsal.sh` + `.github/workflows/backup-rehearsal.yml` | Full dump→drop→restore round-trip with row-count assertions |

The gap this document closes: backups existed, but **no documented restore
procedure, no rehearsal, and no RPO/RTO targets**. A backup that has never
been restored is a hypothesis, not a control.

## 2. Recovery objectives (PROPOSED — pending owner sign-off)

| Tier | Scope | RPO (max data loss) | RTO (max time to restore) |
|---|---|---|---|
| 1 | Core transactional DB (users, policies, claims, refunds) | **PROPOSED: 15 min** (WAL PITR) / 24 h (daily dump fallback) | **PROPOSED: 4 h** |
| 2 | Analytics / reporting replicas | PROPOSED: 24 h | PROPOSED: 24 h |
| 3 | Demo/seed data | N/A — reproducible from `seed.mjs` | N/A |

Owners must confirm or amend these numbers; until then they are **not SLAs**.

## 3. Backup procedure (exact commands)

Environment: `DATABASE_URL=postgresql://user:pass@host:5432/dbname`

```bash
# Full logical backup, custom format (compressed, restorable selectively):
pg_dump --format=custom --no-owner --no-privileges \
  --file="/var/backups/insureportal/insureportal_$(date +%Y%m%d_%H%M%S).dump" \
  "$DATABASE_URL"

# Verify the dump is a valid archive BEFORE relying on it:
pg_restore --list /var/backups/insureportal/insureportal_*.dump | head -20
```

Automated daily backups with retention/encryption/S3 are handled by
`scripts/backup/pg_backup.sh` (cron: `0 2 * * *`). WAL archiving for PITR is
bootstrapped by `scripts/backup/pg_pitr_setup.sh`.

## 4. Restore procedure (exact commands)

```bash
# 1. Provision an empty target database (or a PITR-recovered instance).
# 2. Terminate application connections:
psql "$DATABASE_URL" -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
   WHERE datname = current_database() AND pid <> pg_backend_pid();"

# 3. Drop the public schema (DESTRUCTIVE — confirm you are on the right host):
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# 4. Restore:
pg_restore --no-owner --no-privileges \
  --dbname="$DATABASE_URL" \
  /var/backups/insureportal/<dump-file>.dump

# 5. Restart application services and verify (§5).
```

For convenience, `scripts/backup/pg_restore.sh` wraps steps 1–4.

## 5. Post-restore verification queries

Run these after every restore; compare against the pre-dump snapshot recorded
by the rehearsal script or the pre-incident monitoring counts:

```sql
-- Core table row counts (compare against pre-incident snapshot):
SELECT 'users'    AS table_name, count(*) FROM users
UNION ALL SELECT 'policies', count(*) FROM policies
UNION ALL SELECT 'claims',    count(*) FROM claims
UNION ALL SELECT 'refunds',   count(*) FROM refunds;

-- Referential sanity — must both return 0:
SELECT count(*) FROM claims c
  LEFT JOIN policies p ON p.id = c."policyId" WHERE p.id IS NULL;
SELECT count(*) FROM refunds r
  LEFT JOIN users u ON u.id = r."customerId" WHERE u.id IS NULL;

-- Schema completeness (assert against your baseline):
SELECT count(*) FROM information_schema.tables
 WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
```

## 6. Rehearsal (the control that was missing)

**CI (authoritative, nightly):** `.github/workflows/backup-rehearsal.yml` runs
every night at 02:00 UTC against an ephemeral `postgres:16` service. It:

1. Applies the schema exactly as production does (`drizzle-kit push --force`).
2. Seeds the full 180-table demo dataset (`node seed.mjs`).
3. Snapshots row counts on the core tables (`users`, `policies`, `claims`, `refunds`).
4. `pg_dump` (custom format) → `DROP SCHEMA public CASCADE` → `pg_restore`.
5. **Fails the job if any post-restore row count differs from pre-dump**, and
   checks for orphaned claims/refunds.

**Local execution (requires docker):**

```bash
# Ephemeral postgres:16 container is created and torn down automatically:
CONFIRM_DESTROY=YES ./scripts/backup-restore-rehearsal.sh

# Or against an existing throwaway database:
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/scratch \
CONFIRM_DESTROY=YES ./scripts/backup-restore-rehearsal.sh
```

Safety rails: the script refuses to run without `CONFIRM_DESTROY=YES`, and
refuses to run against non-localhost hosts unless `ALLOW_REMOTE_DESTROY=YES`
is set. **Never** point it at production.

### Execution evidence — honest labeling

- The rehearsal script was **statically verified** in the authoring sandbox
  (`bash -n` clean). Docker was **not available** in that sandbox, so the
  first *executed* evidence will be the output of the nightly CI job above.
  Until that job has run green, restore capability should be treated as
  **CI-verified pending first green run**, not battle-tested.

## 7. Cadence and ownership

| Control | Cadence | Owner |
|---|---|---|
| Daily backup (`pg_backup.sh`) | Daily 02:00 | Platform ops |
| Restore rehearsal (CI) | Nightly 02:00 UTC | Platform ops (this repo) |
| Full DR game-day (restore to isolated env + app smoke test) | PROPOSED: quarterly | Platform owner — **not yet scheduled, needs owner sign-off** |
| RPO/RTO ratification | Once | Platform owner — **pending** |
