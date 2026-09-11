/**
 * backupCatalog.integration.test.ts — B5 integration coverage for the backup
 * job catalog (securityAudit.getBackupStatus / listBackupJobs +
 * server/lib/backupCatalog.ts recorder) against the REAL PG (PGlite) schema.
 *
 * Rows are recorded through the REAL recorder functions — no mocks. This is
 * the only suite file that inserts into backup_jobs (grep-verified), so the
 * fail-loud empty-catalog case runs FIRST, before any row exists.
 *
 * Seeded truth:
 *   job 1: started 10:00, finished 10:05, success, 2048 bytes,
 *          location 's3://wrk-bucket/backups/a/', verified
 *   job 2: started 11:00, finished 11:01, failed, sizeBytes NULL
 *          (never measured — must stay NULL, never defaulted)
 *   job 3: started 12:00 running → finished 12:03 success, 4096 bytes
 *   latest = job 3 (most recent startedAt)
 */
import { describe, it, beforeAll, afterAll } from "vitest";

import { getDb } from "../../server/db";
import {
  getLatestBackupJob,
  listBackupJobsPage,
  recordBackupJobFinish,
  recordBackupJobStart,
  recordCompletedBackupJob,
} from "../../server/lib/backupCatalog";
import {
  callerFor,
  adminUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "backupCatalog";

describe(`${FILE}: backup job catalog (B5)`, () => {
  beforeAll(() => {
    resetAssertionCount();
  });

  afterAll(() => {
    console.log(`[${FILE}] assertions: ${getAssertionCount()}`);
  });

  it("getBackupStatus fails loud PRECONDITION_FAILED while the catalog is empty", async () => {
    const admin = callerFor(adminUser);
    const err = await expectTrpcError(
      admin.securityAudit.getBackupStatus({}),
      "PRECONDITION_FAILED"
    );
    expect(err.message).toContain("no backups recorded");
  });

  it("recorder writes real rows; finish closes a running job with the real outcome", async () => {
    const db = (await getDb())!;
    await recordCompletedBackupJob(db, {
      startedAt: new Date("2020-06-01T10:00:00.000Z"),
      finishedAt: new Date("2020-06-01T10:05:00.000Z"),
      status: "success",
      sizeBytes: 2048,
      location: "s3://wrk-bucket/backups/a/",
      triggeredBy: "cron:pg_backup.sh",
      verificationStatus: "verified",
    });
    await recordCompletedBackupJob(db, {
      startedAt: new Date("2020-06-01T11:00:00.000Z"),
      finishedAt: new Date("2020-06-01T11:01:00.000Z"),
      status: "failed",
      triggeredBy: "cron:pg_backup.sh",
      verificationStatus: "failed",
    });
    const running = await recordBackupJobStart(db, {
      startedAt: new Date("2020-06-01T12:00:00.000Z"),
      triggeredBy: "integration-test",
    });
    expect(running.status).toBe("running");
    expect(running.finishedAt).toBeNull();
    expect(running.sizeBytes).toBeNull();

    const finished = await recordBackupJobFinish(db, running.id, {
      finishedAt: new Date("2020-06-01T12:03:00.000Z"),
      status: "success",
      sizeBytes: 4096,
      location: "/var/backups/insureportal/wrk.dump",
      verificationStatus: "verified",
    });
    expect(finished.status).toBe("success");
    expect(finished.sizeBytes).toBe(4096);
    expect(finished.verificationStatus).toBe("verified");
  });

  it("recordBackupJobFinish on a missing job id throws (fail-loud)", async () => {
    const db = (await getDb())!;
    await expect(
      recordBackupJobFinish(db, -1, {
        finishedAt: new Date("2020-06-01T12:30:00.000Z"),
        status: "failed",
      })
    ).rejects.toThrow("no backup_jobs row with id -1");
  });

  it("getBackupStatus returns the real latest job; unmeasured sizeBytes stays NULL", async () => {
    const admin = callerFor(adminUser);
    const status = await admin.securityAudit.getBackupStatus({});
    expect(status.latest.status).toBe("success");
    expect(status.latest.sizeBytes).toBe(4096);
    expect(status.latest.location).toBe("/var/backups/insureportal/wrk.dump");
    expect(status.latest.triggeredBy).toBe("integration-test");
    expect(status.latest.verificationStatus).toBe("verified");

    const db = (await getDb())!;
    const latest = await getLatestBackupJob(db);
    expect(latest?.id).toBe(status.latest.id);
  });

  it("listBackupJobs paginates most-recent-first and preserves NULL sizeBytes", async () => {
    const admin = callerFor(adminUser);
    const page = await admin.securityAudit.listBackupJobs({
      limit: 2,
      offset: 0,
    });
    expect(page.total).toBe(3);
    expect(page.data.length).toBe(2);
    expect(page.data[0].triggeredBy).toBe("integration-test");
    expect(page.data[1].status).toBe("failed");
    expect(page.data[1].sizeBytes).toBeNull();

    const page2 = await admin.securityAudit.listBackupJobs({
      limit: 2,
      offset: 2,
    });
    expect(page2.data.length).toBe(1);
    expect(page2.data[0].sizeBytes).toBe(2048);

    const db = (await getDb())!;
    const libPage = await listBackupJobsPage(db, 10, 0);
    expect(libPage.total).toBe(3);
  });
});
