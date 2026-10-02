// TypeScript enabled — Sprint 96 security audit
/**
 * P1-C: Email Notification Queue
 *
 * Provides a reliable, Postgres-durable email queue with:
 *   - Jobs persisted to email_queue on enqueue (survive restarts) — 2026-10-01 (C2-lib, A4)
 *   - Delivery/failure outcomes marked in email_delivery_log
 *   - Exponential backoff retry (up to 3 attempts)
 *   - SMTP via Nodemailer (configurable via env vars)
 *   - Fallback to console logging when SMTP is not configured (dev mode ONLY;
 *     production fails loud and never marks the job delivered — H2)
 *   - Template helpers for common notification types
 *
 * Environment variables:
 *   SMTP_HOST        - SMTP server hostname (e.g., smtp.sendgrid.net)
 *   SMTP_PORT        - SMTP port (default: 587)
 *   SMTP_USER        - SMTP username / API key
 *   SMTP_PASS        - SMTP password / API key
 *   SMTP_FROM        - From address (e.g., "InsurePortal POS <noreply@insureportal.io>")
 *   SMTP_SECURE      - "true" for TLS on port 465 (default: false)
 *
 * Usage:
 *   import { enqueueEmail } from "./emailQueue";
 *
 *   await enqueueEmail({
 *     to: "agent@example.com",
 *     subject: "Transaction Receipt",
 *     html: "<p>Your transaction of ₦5,000 was successful.</p>",
 *   });
 */
import { asc, eq } from "drizzle-orm";

import { emailDeliveryLog, emailQueue } from "../../drizzle/schema";
import { logger } from '../_core/logger';
import { getDb } from "../db";

// 2026-10-01 (C2-lib, A4): the queue is now Postgres-backed via the EXISTING
// drizzle tables email_queue (schema:1705) and email_delivery_log (schema:2700).
// The old in-process `queue: EmailJob[]` silently dropped every queued receipt/
// OTP email on restart. Honest column mapping:
//   email_queue.toAddress     ← recipients, comma-joined (varchar 320; nodemailer accepts this form)
//   email_queue.subject       ← subject (varchar 256)
//   email_queue.templateName  ← "raw_html" (these jobs carry literal HTML/text, not a named template)
//   email_queue.templateData  ← { to: string[], html, text, from } (full fidelity payload)
//   email_queue.status        ← queued → sent | failed   (email_status enum)
//   email_queue.retryCount    ← delivery attempts so far
//   emailDeliveryLog          ← one row per terminal outcome (sent/failed)
type EmailQueueDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

interface EmailJob {
  id: string;
  queueId: number;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  attempts: number;
  maxAttempts: number;
}

let workerRunning = false;

// Retry backoff overlay: nextRetryAt per email_queue.id. This is deliberately
// in-memory ONLY (attempt pacing, not business data) — after a restart, pending
// rows are reloaded from PG and re-scheduled with backoff based on their
// persisted retryCount, so no queued job is ever lost.
const nextRetryAtByQueueId = new Map<number, number>();

const DEFAULT_FROM = process.env.SMTP_FROM ?? "InsurePortal POS <noreply@insureportal.io>";
const MAX_ATTEMPTS = 3;
const BASE_RETRY_MS = 5_000; // 5s base, doubles each retry
// Template name recorded for raw HTML/text jobs (email_queue.templateName is NOT NULL).
const RAW_TEMPLATE_NAME = "raw_html";

/** Fail-closed DB resolution: enqueue/drain throws when the DB is unavailable. */
async function requireEmailDb(): Promise<EmailQueueDb> {
  const db = await getDb();
  if (!db) {
    throw new Error(
      "[EmailQueue] Database unavailable — refusing to queue email without durable storage (fail-closed)"
    );
  }
  return db;
}

interface EnqueueEmailOpts {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

/**
 * Persist an email job to email_queue. Returns the durable job id (`email_<row id>`).
 * Throws (fail-closed) on constraint violations — never pretends queued.
 */
export async function enqueueEmailToDb(db: EmailQueueDb, opts: EnqueueEmailOpts): Promise<string> {
  const toList = Array.isArray(opts.to) ? opts.to : [opts.to];
  const toAddress = toList.join(", ");
  if (toAddress.length > 320) {
    throw new Error(`[EmailQueue] recipient list exceeds email_queue.toAddress (varchar 320): ${toAddress.length} chars`);
  }
  if (opts.subject.length > 256) {
    throw new Error(`[EmailQueue] subject exceeds email_queue.subject (varchar 256): ${opts.subject.length} chars`);
  }
  if (RAW_TEMPLATE_NAME.length > 64) {
    throw new Error("[EmailQueue] template name exceeds email_queue.templateName (varchar 64)");
  }

  const rows = await db
    .insert(emailQueue)
    .values({
      toAddress,
      subject: opts.subject,
      templateName: RAW_TEMPLATE_NAME,
      templateData: {
        to: toList,
        html: opts.html,
        ...(opts.text !== undefined ? { text: opts.text } : {}),
        from: opts.from ?? DEFAULT_FROM,
      },
      status: "queued",
      retryCount: 0,
    })
    .returning({ id: emailQueue.id });

  const queueId = rows[0]?.id;
  if (queueId === undefined) {
    throw new Error("[EmailQueue] INSERT into email_queue returned no id — job NOT queued");
  }
  return `email_${queueId}`;
}

/**
 * Enqueue an email for durable, asynchronous delivery.
 * 2026-10-01 (C2-lib, A4): ASYNC now. The job is persisted to Postgres BEFORE
 * this resolves; if the DB is down it THROWS — callers must `await` (or
 * explicitly handle rejection) and will never observe a pretend-queued email.
 */
export async function enqueueEmail(opts: EnqueueEmailOpts): Promise<string> {
  const db = await requireEmailDb();
  const id = await enqueueEmailToDb(db, opts);
  logger.info(
    `[EmailQueue] Enqueued ${id} → ${Array.isArray(opts.to) ? opts.to.join(", ") : opts.to}`
  );
  if (!workerRunning) startWorker();
  return id;
}

/**
 * Send an email immediately (bypasses queue).
 * Use for critical synchronous notifications.
 */
export async function sendEmailNow(opts: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await deliverEmail({
      id: "direct",
      queueId: 0,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      from: opts.from ?? DEFAULT_FROM,
      attempts: 0,
      maxAttempts: 1,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ── Internal worker ──────────────────────────────────────────────────────────

function startWorker() {
  workerRunning = true;
  processQueue().catch(err => {
    logger.error("[EmailQueue] Worker crashed:: " + String(err));
    workerRunning = false;
  });
}

interface QueuedEmailRow {
  id: number;
  toAddress: string;
  subject: string;
  templateData: Record<string, unknown> | null;
  retryCount: number;
}

/** Reconstruct a deliverable job from a persisted email_queue row. */
function rowToJob(row: QueuedEmailRow): EmailJob {
  const td = (row.templateData ?? {}) as Record<string, unknown>;
  const to = Array.isArray(td.to) ? (td.to as string[]) : row.toAddress;
  return {
    id: `email_${row.id}`,
    queueId: row.id,
    to,
    subject: row.subject,
    html: typeof td.html === "string" ? td.html : "",
    ...(typeof td.text === "string" ? { text: td.text } : {}),
    from: typeof td.from === "string" ? td.from : DEFAULT_FROM,
    attempts: row.retryCount,
    maxAttempts: MAX_ATTEMPTS,
  };
}

export interface DrainResult {
  delivered: number;
  failed: number;
  retried: number;
  skippedBackoff: number;
}

/**
 * Drain pending jobs from email_queue (status 'queued', oldest first).
 * 2026-10-01 (C2-lib, A4): the worker drains from Postgres, so a restart loses
 * nothing — pending rows survive and are re-drained on the next boot/enqueue.
 * Terminal outcomes are marked in email_delivery_log.
 *
 * `respectBackoff` (default true) skips rows whose in-memory retry overlay says
 * "not yet due". Tests pass false to drive retries deterministically.
 */
export async function drainEmailQueueFromDb(
  db: EmailQueueDb,
  opts: { limit?: number; respectBackoff?: boolean } = {}
): Promise<DrainResult> {
  const limit = opts.limit ?? 25;
  const respectBackoff = opts.respectBackoff ?? true;
  const result: DrainResult = { delivered: 0, failed: 0, retried: 0, skippedBackoff: 0 };

  const rows = await db
    .select({
      id: emailQueue.id,
      toAddress: emailQueue.toAddress,
      subject: emailQueue.subject,
      templateData: emailQueue.templateData,
      retryCount: emailQueue.retryCount,
    })
    .from(emailQueue)
    .where(eq(emailQueue.status, "queued"))
    .orderBy(asc(emailQueue.createdAt))
    .limit(limit);

  const now = Date.now();
  for (const row of rows) {
    if (respectBackoff) {
      const due = nextRetryAtByQueueId.get(row.id);
      if (due !== undefined && due > now) {
        result.skippedBackoff++;
        continue;
      }
    }

    const job = rowToJob(row);
    const attempt = row.retryCount + 1;
    try {
      await deliverEmail(job);
      const provider = process.env.SMTP_HOST ? "smtp" : "console";
      await db
        .update(emailQueue)
        .set({ status: "sent", sentAt: new Date(), retryCount: attempt, errorMessage: null })
        .where(eq(emailQueue.id, row.id));
      await db.insert(emailDeliveryLog).values({
        emailQueueId: row.id,
        provider,
        toAddress: row.toAddress,
        subject: row.subject,
        status: "sent",
        metadata: { attempt, ...(provider === "console" ? { devBypass: true } : {}) },
      });
      nextRetryAtByQueueId.delete(row.id);
      result.delivered++;
      logger.info(`[EmailQueue] Delivered ${job.id} (attempt ${attempt})`);
    } catch (err) {
      const message = (err as Error).message;
      if (attempt >= MAX_ATTEMPTS) {
        await db
          .update(emailQueue)
          .set({ status: "failed", retryCount: attempt, errorMessage: message })
          .where(eq(emailQueue.id, row.id));
        await db.insert(emailDeliveryLog).values({
          emailQueueId: row.id,
          provider: process.env.SMTP_HOST ? "smtp" : "console",
          toAddress: row.toAddress,
          subject: row.subject,
          status: "failed",
          errorMessage: message,
          metadata: { attempt },
        });
        nextRetryAtByQueueId.delete(row.id);
        result.failed++;
        logger.error(`[EmailQueue] Giving up on ${job.id} after ${attempt} attempts: ${message}`);
      } else {
        const delay = BASE_RETRY_MS * Math.pow(2, attempt - 1);
        await db
          .update(emailQueue)
          .set({ retryCount: attempt, errorMessage: message })
          .where(eq(emailQueue.id, row.id));
        nextRetryAtByQueueId.set(row.id, Date.now() + delay);
        result.retried++;
        logger.warn(
          `[EmailQueue] Delivery failed for ${job.id} (attempt ${attempt}/${MAX_ATTEMPTS}): ${message}. Retry in ${delay}ms.`
        );
      }
    }
  }
  return result;
}

/** Count jobs still awaiting delivery (queued and not exhausted). */
export async function countPendingEmailsInDb(db: EmailQueueDb): Promise<number> {
  const rows = await db
    .select({ id: emailQueue.id })
    .from(emailQueue)
    .where(eq(emailQueue.status, "queued"));
  return rows.length;
}

async function processQueue() {
  // 2026-10-01 (C2-lib, A4): fail-closed — if the DB is unavailable the worker
  // stops with a loud error instead of pretending an empty queue.
  const db = await requireEmailDb();
  while (true) {
    const drained = await drainEmailQueueFromDb(db);
    const pending = await countPendingEmailsInDb(db);
    if (pending === 0) {
      workerRunning = false;
      return;
    }
    if (drained.delivered === 0 && drained.failed === 0 && drained.retried === 0) {
      // Everything pending is in backoff — wait before the next poll.
      await sleep(1_000);
    }
  }
}

async function deliverEmail(job: EmailJob): Promise<void> {
  const smtpHost = process.env.SMTP_HOST;

  if (!smtpHost) {
    // DD-FINAL-SWEEP (H2): mirror termii.ts:37-55. In production an
    // unconfigured SMTP must NOT silently mark the job delivered — throw so
    // the worker retries and finally gives up with a loud error, rather than
    // callers observing success while the email is dropped.
    if (process.env.NODE_ENV === "production") {
      logger.error(
        `[EmailQueue] SMTP not configured — REFUSING to mark email delivered (job ${job.id}, to: ${Array.isArray(job.to) ? job.to.join(", ") : job.to}, subject: "${job.subject}")`
      );
      throw new Error("SMTP provider not configured — email NOT delivered");
    }
    // Development-only labeled bypass: logged, NOT a real delivery.
    logger.info(
      `[EmailQueue/DEV-BYPASS — email NOT sent, not marked delivered in prod] Would send email:\n  To: ${Array.isArray(job.to) ? job.to.join(", ") : job.to}\n  Subject: ${job.subject}\n  From: ${job.from}`
    );
    return;
  }

  // Dynamically import nodemailer to avoid hard dependency when SMTP is not configured
  let nodemailer: typeof import("nodemailer");
  try {
    nodemailer = await import("nodemailer");
  } catch {
    throw new Error(
      "nodemailer is not installed. Run: pnpm add nodemailer @types/nodemailer"
    );
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: parseInt(process.env.SMTP_PORT ?? "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: job.from,
    to: job.to,
    subject: job.subject,
    html: job.html,
    text: job.text,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Email templates ──────────────────────────────────────────────────────────

export function buildTransactionReceiptEmail(opts: {
  agentName: string;
  agentId: string;
  ref: string;
  type: string;
  amount: number;
  fee: number;
  commission: number;
  customerName?: string | null;
  timestamp: Date;
}): { subject: string; html: string; text: string } {
  const subject = `Transaction Receipt — ${opts.ref}`;
  const amountStr = `₦${opts.amount.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
  const feeStr = `₦${opts.fee.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
  const commStr = `₦${opts.commission.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
      <h2 style="color:#1d4ed8;margin-bottom:4px;">InsurePortal POS</h2>
      <p style="color:#6b7280;margin-top:0;">Transaction Receipt</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:6px 0;color:#6b7280;">Reference</td><td style="padding:6px 0;font-weight:600;">${opts.ref}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Type</td><td style="padding:6px 0;">${opts.type}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Amount</td><td style="padding:6px 0;font-weight:600;">${amountStr}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Fee</td><td style="padding:6px 0;">${feeStr}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Commission</td><td style="padding:6px 0;color:#16a34a;">${commStr}</td></tr>
        ${opts.customerName ? `<tr><td style="padding:6px 0;color:#6b7280;">Customer</td><td style="padding:6px 0;">${opts.customerName}</td></tr>` : ""}
        <tr><td style="padding:6px 0;color:#6b7280;">Agent</td><td style="padding:6px 0;">${opts.agentName} (${opts.agentId})</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Date</td><td style="padding:6px 0;">${opts.timestamp.toLocaleString("en-NG")}</td></tr>
      </table>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
      <p style="color:#6b7280;font-size:12px;margin:0;">This is an automated receipt from InsurePortal POS. Do not reply to this email.</p>
    </div>
  `;

  const text = `InsurePortal POS — Transaction Receipt\n\nRef: ${opts.ref}\nType: ${opts.type}\nAmount: ${amountStr}\nFee: ${feeStr}\nCommission: ${commStr}\nAgent: ${opts.agentName} (${opts.agentId})\nDate: ${opts.timestamp.toLocaleString("en-NG")}`;

  return { subject, html, text };
}

export function buildAlertEmail(opts: {
  title: string;
  message: string;
  severity: "low" | "medium" | "high" | "critical";
  timestamp?: Date;
}): { subject: string; html: string; text: string } {
  const severityColors: Record<string, string> = {
    low: "#6b7280",
    medium: "#d97706",
    high: "#dc2626",
    critical: "#7c3aed",
  };
  const color = severityColors[opts.severity] ?? "#6b7280";
  const ts = opts.timestamp ?? new Date();

  const subject = `[${opts.severity.toUpperCase()}] ${opts.title}`;
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border:2px solid ${color};border-radius:8px;">
      <h2 style="color:${color};margin-bottom:4px;">${opts.title}</h2>
      <p style="color:#374151;">${opts.message}</p>
      <p style="color:#6b7280;font-size:12px;">Severity: <strong style="color:${color};">${opts.severity.toUpperCase()}</strong> · ${ts.toLocaleString("en-NG")}</p>
    </div>
  `;
  const text = `[${opts.severity.toUpperCase()}] ${opts.title}\n\n${opts.message}\n\nTimestamp: ${ts.toLocaleString("en-NG")}`;

  return { subject, html, text };
}

// ── Additional email templates (Phase 165) ────────────────────────────────────

export function buildKycApprovalEmail(opts: {
  agentName: string;
  agentId: string;
  tier: string;
  approvedAt: Date;
}): { subject: string; html: string; text: string } {
  const subject = `KYC Approved — Welcome to ${opts.tier} Tier, ${opts.agentName}`;
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #d1fae5;border-radius:8px;background:#f0fdf4;"><h2 style="color:#065f46;">✅ KYC Approved</h2><p>Dear <strong>${opts.agentName}</strong> (${opts.agentId}), your KYC has been approved. Tier: <strong>${opts.tier}</strong>.</p><p style="color:#6b7280;font-size:12px;">Approved: ${opts.approvedAt.toLocaleString("en-NG")}</p></div>`;
  const text = `KYC Approved\n\nDear ${opts.agentName} (${opts.agentId}),\nYour KYC has been approved. Tier: ${opts.tier}\nApproved: ${opts.approvedAt.toLocaleString("en-NG")}`;
  return { subject, html, text };
}

export function buildKycRejectionEmail(opts: {
  agentName: string;
  agentId: string;
  reason: string;
  rejectedAt: Date;
}): { subject: string; html: string; text: string } {
  const subject = `KYC Verification Update — Action Required`;
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #fee2e2;border-radius:8px;background:#fff7f7;"><h2 style="color:#991b1b;">⚠️ KYC Requires Attention</h2><p>Dear <strong>${opts.agentName}</strong> (${opts.agentId}),</p><p>Reason: ${opts.reason}</p><p style="color:#6b7280;font-size:12px;">Reviewed: ${opts.rejectedAt.toLocaleString("en-NG")}</p></div>`;
  const text = `KYC Update\n\nDear ${opts.agentName} (${opts.agentId}),\nReason: ${opts.reason}\nReviewed: ${opts.rejectedAt.toLocaleString("en-NG")}`;
  return { subject, html, text };
}

export function buildFloatAlertEmail(opts: {
  agentName: string;
  agentId: string;
  currentBalance: number;
  threshold: number;
  currency?: string;
}): { subject: string; html: string; text: string } {
  const cur = opts.currency ?? "NGN";
  const fmt = (n: number) =>
    `${cur} ${n.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
  const subject = `Float Balance Alert — ${opts.agentId} below threshold`;
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border:2px solid #d97706;border-radius:8px;background:#fffbeb;"><h2 style="color:#92400e;">⚠️ Low Float Balance</h2><p>Dear <strong>${opts.agentName}</strong> (${opts.agentId}),</p><p>Current: <strong style="color:#dc2626;">${fmt(opts.currentBalance)}</strong> | Threshold: ${fmt(opts.threshold)}</p><p>Please top up immediately.</p></div>`;
  const text = `Float Alert\n\n${opts.agentName} (${opts.agentId})\nCurrent: ${fmt(opts.currentBalance)}\nThreshold: ${fmt(opts.threshold)}`;
  return { subject, html, text };
}

export function buildCommissionPayoutEmail(opts: {
  agentName: string;
  agentId: string;
  amount: number;
  period: string;
  payoutRef: string;
  paidAt: Date;
  currency?: string;
}): { subject: string; html: string; text: string } {
  const cur = opts.currency ?? "NGN";
  const fmt = (n: number) =>
    `${cur} ${n.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
  const subject = `Commission Payout — ${fmt(opts.amount)} for ${opts.period}`;
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #d1fae5;border-radius:8px;background:#f0fdf4;"><h2 style="color:#065f46;">💰 Commission Payout Processed</h2><p>Dear <strong>${opts.agentName}</strong> (${opts.agentId}),</p><p>Ref: ${opts.payoutRef} | Amount: <strong>${fmt(opts.amount)}</strong> | Period: ${opts.period}</p><p style="color:#6b7280;font-size:12px;">Processed: ${opts.paidAt.toLocaleString("en-NG")}</p></div>`;
  const text = `Commission Payout\n\n${opts.agentName} (${opts.agentId})\nRef: ${opts.payoutRef}\nAmount: ${fmt(opts.amount)}\nPeriod: ${opts.period}`;
  return { subject, html, text };
}

export function buildOnboardingCompleteEmail(opts: {
  agentName: string;
  agentId: string;
  completedAt: Date;
}): { subject: string; html: string; text: string } {
  const subject = `Welcome to InsurePortal — Onboarding Complete, ${opts.agentName}!`;
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #ddd6fe;border-radius:8px;background:#faf5ff;"><h2 style="color:#5b21b6;">🎉 Onboarding Complete!</h2><p>Dear <strong>${opts.agentName}</strong> (${opts.agentId}),</p><p>All 5 onboarding steps completed. You are now fully activated.</p><p style="color:#6b7280;font-size:12px;">Completed: ${opts.completedAt.toLocaleString("en-NG")}</p></div>`;
  const text = `Onboarding Complete!\n\nDear ${opts.agentName} (${opts.agentId}),\nAll 5 steps completed.\nCompleted: ${opts.completedAt.toLocaleString("en-NG")}`;
  return { subject, html, text };
}
