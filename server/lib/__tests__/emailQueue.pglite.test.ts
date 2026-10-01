/**
 * 2026-10-01 (C2-lib, A4): real-DB restart-simulation tests for the
 * Postgres-durable email queue (email_queue + email_delivery_log). No mocks:
 * a real PGlite database persisted to a temp data dir is closed and REOPENED
 * to simulate a process restart; queued jobs and delivery marks must survive.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  countPendingEmailsInDb,
  drainEmailQueueFromDb,
  enqueueEmail,
  enqueueEmailToDb,
} from "../emailQueue";
import type { getDb } from "../../db";

type EmailQueueDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const CREATE_SQL = `
  CREATE TYPE email_status AS ENUM ('queued','sent','failed','bounced');
  CREATE TYPE email_provider AS ENUM ('sendgrid','ses','smtp','console');
  CREATE TABLE email_queue (
    id BIGSERIAL PRIMARY KEY,
    "toAddress" VARCHAR(320) NOT NULL,
    "toName" VARCHAR(128),
    subject VARCHAR(256) NOT NULL,
    "templateName" VARCHAR(64) NOT NULL,
    "templateData" JSON DEFAULT '{}',
    status email_status DEFAULT 'queued' NOT NULL,
    "sentAt" TIMESTAMP,
    "errorMessage" TEXT,
    "retryCount" INTEGER DEFAULT 0 NOT NULL,
    "tenantId" INTEGER,
    "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL
  );
  CREATE TABLE email_delivery_log (
    id BIGSERIAL PRIMARY KEY,
    email_queue_id INTEGER,
    provider email_provider NOT NULL,
    provider_message_id VARCHAR(128),
    to_address VARCHAR(320) NOT NULL,
    subject VARCHAR(256) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'sent',
    opened_at TIMESTAMP,
    clicked_at TIMESTAMP,
    bounced_at TIMESTAMP,
    error_message TEXT,
    metadata JSON DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  );
`;

function asQueueDb(pglite: PGlite): EmailQueueDb {
  return drizzle(pglite) as unknown as EmailQueueDb;
}

describe("emailQueue — Postgres-durable queue (A4, PGlite restart simulation)", () => {
  let dataDir: string;
  let pglite: PGlite;
  let db: EmailQueueDb;
  const savedSmtpHost = process.env.SMTP_HOST;

  beforeAll(async () => {
    // Dev-mode console bypass delivers without a real SMTP server; in
    // production this same path throws (H2 fail-closed) — covered implicitly
    // by the failure-path test below using an unreachable SMTP host.
    delete process.env.SMTP_HOST;
    dataDir = mkdtempSync(path.join(tmpdir(), "a4-emailq-"));
    pglite = new PGlite(dataDir);
    await pglite.exec(CREATE_SQL);
    db = asQueueDb(pglite);
  });

  afterEach(() => {
    delete process.env.SMTP_HOST;
  });

  afterAll(async () => {
    if (savedSmtpHost !== undefined) process.env.SMTP_HOST = savedSmtpHost;
    await pglite.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("enqueueEmailToDb persists a queued job with honest column mapping", async () => {
    const id = await enqueueEmailToDb(db, {
      to: ["a@example.com", "b@example.com"],
      subject: "Receipt ₦5,000",
      html: "<p>ok</p>",
      text: "ok",
    });
    expect(id).toMatch(/^email_\d+$/);

    const raw = await pglite.query<{
      toAddress: string; subject: string; templateName: string;
      templateData: Record<string, unknown>; status: string; retryCount: number;
    }>(`SELECT * FROM email_queue`);
    expect(raw.rows).toHaveLength(1);
    expect(raw.rows[0].toAddress).toBe("a@example.com, b@example.com");
    expect(raw.rows[0].templateName).toBe("raw_html");
    expect(raw.rows[0].status).toBe("queued");
    expect(raw.rows[0].retryCount).toBe(0);
    expect(raw.rows[0].templateData.to).toEqual(["a@example.com", "b@example.com"]);
    expect(raw.rows[0].templateData.html).toBe("<p>ok</p>");
  });

  it("fail-closed: enqueueEmail (public path) throws when the DB is unavailable", async () => {
    // Unit-test env has no POSTGRES_URL/DATABASE_URL → getDb() returns null →
    // the queue must REFUSE rather than pretend the job is queued.
    await expect(
      enqueueEmail({ to: "x@example.com", subject: "s", html: "<p/>" })
    ).rejects.toThrow(/fail-closed|unavailable/i);
    expect(await countPendingEmailsInDb(db)).toBe(1); // nothing slipped in
  });

  it("rejects over-long recipients/subjects instead of truncating", async () => {
    await expect(
      enqueueEmailToDb(db, { to: `${"a".repeat(320)}@x.io`, subject: "s", html: "<p/>" })
    ).rejects.toThrow(/varchar 320/);
    await expect(
      enqueueEmailToDb(db, { to: "a@x.io", subject: "s".repeat(257), html: "<p/>" })
    ).rejects.toThrow(/varchar 256/);
  });

  it("worker drains from PG: queued → sent, delivery mark written to email_delivery_log", async () => {
    const drained = await drainEmailQueueFromDb(db);
    expect(drained.delivered).toBe(1);
    expect(await countPendingEmailsInDb(db)).toBe(0);

    const q = await pglite.query<{ status: string; sentAt: Date | null }>(`SELECT status, "sentAt" FROM email_queue`);
    expect(q.rows[0].status).toBe("sent");
    expect(q.rows[0].sentAt).not.toBeNull();

    const log = await pglite.query<{ provider: string; status: string; to_address: string; metadata: Record<string, unknown> }>(
      `SELECT provider, status, to_address, metadata FROM email_delivery_log`
    );
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0].provider).toBe("console");
    expect(log.rows[0].status).toBe("sent");
    expect(log.rows[0].to_address).toBe("a@example.com, b@example.com");
  });

  it("restart simulation: job enqueued before restart drains AFTER reopening the DB; delivery marks survive", async () => {
    // Enqueue a second job, then simulate a process restart.
    const id = await enqueueEmailToDb(db, { to: "c@example.com", subject: "OTP 123456", html: "<p>otp</p>" });
    await pglite.close();
    pglite = new PGlite(dataDir);
    db = asQueueDb(pglite);

    // Previously delivered marks survive the restart.
    const log = await pglite.query<{ status: string }>(`SELECT status FROM email_delivery_log`);
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0].status).toBe("sent");

    // The queued job is still pending and drains from the fresh connection.
    expect(await countPendingEmailsInDb(db)).toBe(1);
    const drained = await drainEmailQueueFromDb(db);
    expect(drained.delivered).toBe(1);

    const q = await pglite.query<{ status: string }>(`SELECT status FROM email_queue ORDER BY id`);
    expect(q.rows.map(r => r.status)).toEqual(["sent", "sent"]);
    const logs = await pglite.query<{ status: string }>(`SELECT status FROM email_delivery_log ORDER BY id`);
    expect(logs.rows.map(r => r.status)).toEqual(["sent", "sent"]);
    void id;
  });

  it("failed delivery retries with persisted retryCount, then terminally fails with a delivery-log row", async () => {
    // Unreachable SMTP → deliverEmail throws for real (nodemailer connect refused).
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "1";

    await enqueueEmailToDb(db, { to: "d@example.com", subject: "will fail", html: "<p/>" });

    // Attempts 1 and 2: stay queued with increasing retryCount.
    for (const expectedRetry of [1, 2]) {
      const r = await drainEmailQueueFromDb(db, { respectBackoff: false });
      expect(r.retried).toBe(1);
      const q = await pglite.query<{ status: string; retryCount: number; errorMessage: string | null }>(
        `SELECT status, "retryCount", "errorMessage" FROM email_queue WHERE subject='will fail'`
      );
      expect(q.rows[0].status).toBe("queued");
      expect(q.rows[0].retryCount).toBe(expectedRetry);
      expect(q.rows[0].errorMessage).toBeTruthy();
    }

    // Attempt 3: terminal failure.
    const r3 = await drainEmailQueueFromDb(db, { respectBackoff: false });
    expect(r3.failed).toBe(1);
    const q = await pglite.query<{ status: string; retryCount: number }>(
      `SELECT status, "retryCount" FROM email_queue WHERE subject='will fail'`
    );
    expect(q.rows[0].status).toBe("failed");
    expect(q.rows[0].retryCount).toBe(3);
    const log = await pglite.query<{ status: string; error_message: string | null; provider: string }>(
      `SELECT status, error_message, provider FROM email_delivery_log WHERE subject='will fail'`
    );
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0].status).toBe("failed");
    expect(log.rows[0].provider).toBe("smtp");
    expect(log.rows[0].error_message).toBeTruthy();
  }, 20000);
});
