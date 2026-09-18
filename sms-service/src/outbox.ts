/**
 * outbox.ts — Durable SMS delivery log + retry queue (NG-5).
 *
 * The previous delivery log was a process-local Map lost on restart; failed
 * sends had a single in-line fallback and no retry. Now every message is a DB
 * row, delivery reports update that row (unknown IDs are recorded, not
 * silently dropped), and a background worker retries failures with
 * exponential backoff up to MAX_ATTEMPTS before marking them dead.
 */
import { query } from "./db";

export const MAX_ATTEMPTS = 5;
export const BASE_BACKOFF_MS = 30_000;

export interface SMSRecord {
  id: number;
  recipient: string;
  body: string;
  provider: string | null;
  message_id: string | null;
  status: string; // queued | sent | delivered | failed | retrying | dead
  attempts: number;
  next_retry_at: Date | null;
  last_error: string | null;
  created_at?: Date;
  updated_at?: Date;
}

export async function initOutbox(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS sms_messages (
      id SERIAL PRIMARY KEY,
      recipient VARCHAR(32) NOT NULL,
      body TEXT NOT NULL,
      provider VARCHAR(32),
      message_id VARCHAR(128),
      status VARCHAR(16) NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await query(`CREATE INDEX IF NOT EXISTS sms_msg_retry_idx ON sms_messages(status, next_retry_at)`);
  await query(`CREATE INDEX IF NOT EXISTS sms_msg_provider_id_idx ON sms_messages(provider, message_id)`);
}

export async function recordOutgoing(recipient: string, body: string): Promise<number> {
  const r = await query(
    `INSERT INTO sms_messages (recipient, body, status) VALUES ($1, $2, 'queued') RETURNING id`,
    [recipient, body]
  );
  return r.rows[0].id as number;
}

export async function markResult(
  id: number,
  provider: string,
  messageId: string | null,
  ok: boolean,
  err?: string
): Promise<void> {
  if (ok) {
    await query(
      `UPDATE sms_messages SET provider=$2, message_id=$3, status='sent', last_error=NULL, updated_at=NOW() WHERE id=$1`,
      [id, provider, messageId]
    );
  } else {
    await query(
      `UPDATE sms_messages SET provider=$2, attempts=attempts+1, last_error=$3,
         status = CASE WHEN attempts+1 >= $4 THEN 'dead' ELSE 'retrying' END,
         next_retry_at = CASE WHEN attempts+1 >= $4 THEN NULL ELSE NOW() + (INTERVAL '1 millisecond' * ($5 * POWER(2, attempts))) END,
         updated_at=NOW()
       WHERE id=$1`,
      [id, provider, err ?? "send failed", MAX_ATTEMPTS, BASE_BACKOFF_MS]
    );
  }
}

/** Delivery report: update by provider message_id; unknown IDs are INSERTED
 *  (not silently dropped) so reports are never lost. */
export async function recordDeliveryReport(provider: string, messageId: string, status: string): Promise<void> {
  const r = await query(
    `UPDATE sms_messages SET status=$3, updated_at=NOW() WHERE provider=$1 AND message_id=$2`,
    [provider, messageId, status]
  );
  if (r.rowCount === 0) {
    await query(
      `INSERT INTO sms_messages (recipient, body, provider, message_id, status, last_error)
       VALUES ('unknown', '', $1, $2, $3, 'delivery report for unknown message id')`,
      [provider, messageId, status]
    );
  }
}

export async function getByMessageId(messageId: string): Promise<SMSRecord | null> {
  const r = await query(`SELECT * FROM sms_messages WHERE message_id=$1 ORDER BY id DESC LIMIT 1`, [messageId]);
  return r.rows[0] ?? null;
}

/** Fetch due retries and re-attempt via the provided senders. */
export async function processRetries(
  senders: Array<{ name: string; send: (to: string, body: string) => Promise<{ success: boolean; messageId?: string; error?: string }> }>
): Promise<number> {
  const due = await query(
    `SELECT * FROM sms_messages WHERE status='retrying' AND next_retry_at <= NOW() ORDER BY next_retry_at ASC LIMIT 50`
  );
  let processed = 0;
  for (const row of due.rows as SMSRecord[]) {
    // Alternate providers across attempts.
    const provider = senders[row.attempts % senders.length];
    const res = await provider.send(row.recipient, row.body);
    await markResult(row.id, provider.name, res.messageId ?? null, res.success, res.error);
    processed++;
  }
  return processed;
}

let worker: NodeJS.Timeout | null = null;
export function startRetryWorker(
  senders: Parameters<typeof processRetries>[0],
  intervalMs = 15_000
): void {
  if (worker) return;
  worker = setInterval(() => {
    processRetries(senders).catch((e) => console.error(`[sms-retry] ${e}`));
  }, intervalMs);
  worker.unref?.();
}
