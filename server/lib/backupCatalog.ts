/**
 * backupCatalog.ts — B5: backup job catalog recorder (REAL writes only).
 *
 * Recorders for the `backup_jobs` table (drizzle/schema.additions.ts,
 * migration drizzle/0054_weekly_reports_backup_jobs.sql). Callers:
 *   - scripts/backup/pg_backup.sh records its own runs directly via psql
 *     against DATABASE_URL (documented in the script header);
 *   - server-side tooling (rehearsal drivers, schedulers) uses the functions
 *     below.
 *
 * Fail-loud grammar: nothing here fabricates. sizeBytes stays NULL when the
 * producing tool did not measure it; status/verificationStatus are the real
 * reported outcomes.
 */
import { desc, eq, sql } from "drizzle-orm";

import { backupJobs, type BackupJob } from "../../drizzle/schema.additions";
import type { getDb } from "../db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type BackupJobStatus = "running" | "success" | "failed";
export type BackupVerificationStatus = "verified" | "unverified" | "failed";

export interface StartBackupJobInput {
  startedAt: Date;
  triggeredBy: string;
  location?: string;
}

/** Open a catalog row for a backup run that has just started. */
export async function recordBackupJobStart(
  db: Db,
  input: StartBackupJobInput
): Promise<BackupJob> {
  const [row] = await db
    .insert(backupJobs)
    .values({
      startedAt: input.startedAt,
      status: "running",
      triggeredBy: input.triggeredBy,
      location: input.location ?? null,
    })
    .returning();
  return row;
}

export interface FinishBackupJobInput {
  finishedAt: Date;
  status: Exclude<BackupJobStatus, "running">;
  sizeBytes?: number;
  location?: string;
  verificationStatus?: BackupVerificationStatus;
}

/** Close a catalog row with the real outcome of the run. */
export async function recordBackupJobFinish(
  db: Db,
  jobId: number,
  input: FinishBackupJobInput
): Promise<BackupJob> {
  const [row] = await db
    .update(backupJobs)
    .set({
      finishedAt: input.finishedAt,
      status: input.status,
      sizeBytes: input.sizeBytes ?? null,
      location: input.location ?? null,
      verificationStatus: input.verificationStatus ?? null,
    })
    .where(eq(backupJobs.id, jobId))
    .returning();
  if (!row) {
    throw new Error(`recordBackupJobFinish: no backup_jobs row with id ${jobId}`);
  }
  return row;
}

/**
 * One-shot recorder for completed runs (used by rehearsal drivers that only
 * learn the outcome after the fact, e.g. CI backup-restore rehearsals).
 */
export async function recordCompletedBackupJob(
  db: Db,
  input: StartBackupJobInput & FinishBackupJobInput
): Promise<BackupJob> {
  const [row] = await db
    .insert(backupJobs)
    .values({
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      status: input.status,
      sizeBytes: input.sizeBytes ?? null,
      location: input.location ?? null,
      triggeredBy: input.triggeredBy,
      verificationStatus: input.verificationStatus ?? null,
    })
    .returning();
  return row;
}

/** Latest catalog row, or undefined when the catalog is empty. */
export async function getLatestBackupJob(db: Db): Promise<BackupJob | undefined> {
  const [row] = await db
    .select()
    .from(backupJobs)
    .orderBy(desc(backupJobs.startedAt), desc(backupJobs.id))
    .limit(1);
  return row;
}

/** Paginated catalog listing, most recent first. */
export async function listBackupJobsPage(
  db: Db,
  limit: number,
  offset: number
): Promise<{ data: BackupJob[]; total: number }> {
  const data = await db
    .select()
    .from(backupJobs)
    .orderBy(desc(backupJobs.startedAt), desc(backupJobs.id))
    .limit(limit)
    .offset(offset);
  const [totalRow] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(backupJobs);
  return { data, total: Number(totalRow.total) };
}
