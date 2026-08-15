# Migration Rollback Plan — InsurePortal Platform

Remediates audit finding **F-06** (no migration rollback plan).
Companion documents: `BACKUP_RESTORE.md` (data-level recovery),
`scripts/db-migrate-safe.sh` (pre-migration backup wrapper).

---

## 1. How schema changes are actually applied today (verified against the repo)

| Fact | Evidence |
|---|---|
| Schema of record is `drizzle/schema.ts` + `drizzle/schema.additions.ts` (186 pgTables) | `drizzle.config.ts` |
| **Production deploys apply schema with `drizzle-kit push`** (`pnpm db:push`) | `Makefile.production:133`, `package.json` script `db:push` |
| CI integration pipeline applies schema with `drizzle-kit push --force` | `.github/workflows/integration.yml` |
| A legacy SQL migration set exists under `drizzle/` (48 `.sql` files, journal up to `0042`) | `drizzle/meta/_journal.json` |
| `scripts/db-migrate-safe.sh` calls `drizzle-kit migrate` | but this is **not** wired into any deploy workflow |

### The honest headline

**`drizzle-kit push` is forward-only. There is no down-migration system in
this repository.** `push` computes the diff between the schema files and the
live database and applies it; it cannot reverse a change. `--force` (used in
CI) additionally auto-accepts statements drizzle-kit flags as data-loss risks
— it removes the human checkpoint, it does not add safety.

The legacy `drizzle/*.sql` migration set is **not a reliable rollback path
either**, and should currently be treated as historical artifacts:

- The journal skips numbers (`0005`, `0013` are absent) and there are **two**
  `0000_*.sql` files; `0000_conscious_guardian.sql` is orphaned — it is not
  referenced in `drizzle/meta/_journal.json`.
- `drizzle-kit migrate` is only referenced by `scripts/db-migrate-safe.sh`,
  which no workflow invokes; the migration path is therefore **unrehearsed**.
- Even a healthy drizzle migration set has no generated `down` SQL — drizzle
  does not produce down-migrations at all.

## 2. Rollback strategy by change class

Because there is no down-migration mechanism, rollback strategy depends on
the *class* of the schema change. Classify every change before deploying it.

### Class A — Additive (safe, default)

New table, new nullable column, new index, new enum value at
the end, new FK on a new column.

- **Rollback:** none required. Old code keeps working against the new schema.
- **Policy:** always deploy additive changes *before* the code that needs them
  (schema-first ordering). This is the only class that may ship without a
  reviewed rollback note.

### Class B — Destructive / contract-breaking (requires a plan)

Dropping or renaming a column/table, narrowing a type, adding `NOT NULL` to
an existing populated column, removing an enum value, changing a PK.

- **Rollback:** *restore from backup* (see `BACKUP_RESTORE.md` §4) or a
  hand-written reverse SQL script reviewed in the PR.
- **Policy:** destructive changes are deployed as a **two-release expand/contract**:
  1. Release N — expand: add the new structure alongside the old one; code
     dual-writes or reads new-with-fallback.
  2. Release N+1 (after stability window, PROPOSED: ≥ 7 days) — contract:
     drop the old structure.
  Between the two releases, rollback is always safe because both shapes exist.
- A single-release destructive `push --force` to production is **prohibited**
  without a pre-approved rollback note and a same-day backup validated by
  `pg_restore --list`.

### Class C — Data migration (backfill / rewrite)

- **Rollback:** keep the pre-migration values (shadow column or backup table
  `*_pre_<change>`) until the change is proven; rollback = swap back, not
  restore-from-backup.
- **Policy:** backfills must be idempotent, chunked, and resumable; never run
  inside the same deploy transaction as the schema change.

## 3. Roll-forward policy

When a deploy goes wrong, **prefer rolling forward**: revert the code, keep
the schema, and ship a corrective additive change. Restoring a database from
backup after a destructive schema change means losing all writes since the
backup (RPO exposure — see BACKUP_RESTORE.md §2), so point-in-time restore is
the *last resort*, reserved for data corruption that roll-forward cannot fix.

Decision order when a migration causes an incident:

1. Can the app be fixed/reverted while keeping the new schema? → **roll forward**.
2. Was the change expand-phase of an expand/contract? → **roll back code only**;
   the old shape still exists.
3. Destructive change already applied and data lost/corrupt? → **PITR restore**
   to just before the change (`scripts/backup/pg_pitr_setup.sh`), then replay
   the corrective plan. Accept the RPO loss and page the owner.

## 4. Pre-deploy checklist (schema changes)

- [ ] Change classified (A additive / B destructive / C data migration).
- [ ] `drizzle-kit push` diff reviewed locally against a production-shaped
      database (never read the diff for the first time in the deploy log).
- [ ] If Class B: expand/contract split planned across two releases, OR an
      explicit owner-approved exception with reverse SQL attached to the PR.
- [ ] Fresh backup taken **and** validated with `pg_restore --list`
      (`scripts/db-migrate-safe.sh` step 1 automates the backup; record the
      dump file location in the deploy notes).
- [ ] Post-deploy verification queries ready (row counts on affected tables —
      pattern in `scripts/backup-restore-rehearsal.sh` stage 7).
- [ ] Rollback owner named for the deploy window (who decides, who executes).

## 5. Recommendations (NOT implemented — require owner decision)

These would improve the posture but are **recommendations only**; nothing in
this section exists in the codebase today:

1. **Move production off `drizzle-kit push` onto reviewed SQL migrations**
   (`drizzle-kit generate` + `drizzle-kit migrate` in the deploy workflow).
   This gives an auditable, ordered history. It does **not** give
   down-migrations — drizzle never generates those — so item 2 still applies.
   The existing `drizzle/` journal must first be reconciled (orphan
   `0000_conscious_guardian.sql`, numbering gaps) or regenerated from scratch.
2. **Adopt a per-change "reverse.sql" convention**: every destructive
   migration PR must include a hand-written reverse script reviewed alongside
   it. This is process, not tooling.
3. **Gate deploys on the nightly backup-restore rehearsal being green**
   (`.github/workflows/backup-rehearsal.yml`), since backup restore is the
   only real rollback for destructive changes.
