// TypeScript enabled — Sprint 96 security audit
/**
 * P1-C: Email Notification Queue
 *
 * Provides a reliable, in-process email queue with:
 *   - Exponential backoff retry (up to 3 attempts)
 *   - SMTP via Nodemailer (configurable via env vars)
 *   - Fallback to console logging when SMTP is not configured (dev mode)
 *   - Template helpers for common notification types
 *
 * Environment variables:
 *   SMTP_HOST        - SMTP server hostname (e.g., smtp.sendgrid.net)
 *   SMTP_PORT        - SMTP port (default: 587)
 *   SMTP_USER        - SMTP username / API key
 *   SMTP_PASS        - SMTP password / API key
 *   SMTP_FROM        - From address (e.g., "54Link POS <noreply@54link.io>")
 *   SMTP_SECURE      - "true" for TLS on port 465 (default: false)
 *
 * Usage:
 *   import { enqueueEmail } from "./emailQueue";
 *   import { enqueueEmail } from "./emailQueue";
import { logger } from './_core/logger';
 *
 *   await enqueueEmail({
 *     to: "agent@example.com",
 *     subject: "Transaction Receipt",
 *     html: "<p>Your transaction of ₦5,000 was successful.</p>",
 *   });
 */

interface EmailJob {
  id: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: number;
}

// In-process queue (suitable for single-instance deployments)
// For multi-instance deployments, replace with Redis-backed Bull/BullMQ queue
const queue: EmailJob[] = [];
let workerRunning = false;

const DEFAULT_FROM = process.env.SMTP_FROM ?? "54Link POS <noreply@54link.io>";
const MAX_ATTEMPTS = 3;
const BASE_RETRY_MS = 5_000; // 5s base, doubles each retry

/**
 * Enqueue an email for delivery.
 * Returns immediately; delivery is asynchronous.
 */
export function enqueueEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}): string {
  const id = `email_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const job: EmailJob = {
    id,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    from: opts.from ?? DEFAULT_FROM,
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    nextRetryAt: Date.now(),
  };
  queue.push(job);
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
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      from: opts.from ?? DEFAULT_FROM,
      attempts: 0,
      maxAttempts: 1,
      nextRetryAt: Date.now(),
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
    logger.error("[EmailQueue] Worker crashed:", err);
    workerRunning = false;
  });
}

async function processQueue() {
  while (true) {
    const now = Date.now();
    const job = queue.find(
      j => j.attempts < j.maxAttempts && j.nextRetryAt <= now
    );

    if (!job) {
      // No ready jobs — check if any are pending future retry
      const hasPending = queue.some(j => j.attempts < j.maxAttempts);
      if (!hasPending) {
        workerRunning = false;
        return;
      }
      // Wait 1s before next check
      await sleep(1_000);
      continue;
    }

    job.attempts++;
    try {
      await deliverEmail(job);
      // Remove successful job from queue
      const idx = queue.indexOf(job);
      if (idx !== -1) queue.splice(idx, 1);
      logger.info(`[EmailQueue] Delivered ${job.id} (attempt ${job.attempts})`);
    } catch (err) {
      const delay = BASE_RETRY_MS * Math.pow(2, job.attempts - 1);
      job.nextRetryAt = Date.now() + delay;
      logger.warn(
        `[EmailQueue] Delivery failed for ${job.id} (attempt ${job.attempts}/${job.maxAttempts}): ${(err as Error).message}. Retry in ${delay}ms.`
      );
      if (job.attempts >= job.maxAttempts) {
        logger.error(
          `[EmailQueue] Giving up on ${job.id} after ${job.maxAttempts} attempts.`
        );
        const idx = queue.indexOf(job);
        if (idx !== -1) queue.splice(idx, 1);
      }
    }
  }
}

async function deliverEmail(job: EmailJob): Promise<void> {
  const smtpHost = process.env.SMTP_HOST;

  if (!smtpHost) {
    // Dev mode: log to console instead of sending
    logger.info(
      `[EmailQueue/DEV] Would send email:\n  To: ${Array.isArray(job.to) ? job.to.join(", ") : job.to}\n  Subject: ${job.subject}\n  From: ${job.from}`
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
  agentCode: string;
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
      <h2 style="color:#1d4ed8;margin-bottom:4px;">54Link POS</h2>
      <p style="color:#6b7280;margin-top:0;">Transaction Receipt</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:6px 0;color:#6b7280;">Reference</td><td style="padding:6px 0;font-weight:600;">${opts.ref}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Type</td><td style="padding:6px 0;">${opts.type}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Amount</td><td style="padding:6px 0;font-weight:600;">${amountStr}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Fee</td><td style="padding:6px 0;">${feeStr}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Commission</td><td style="padding:6px 0;color:#16a34a;">${commStr}</td></tr>
        ${opts.customerName ? `<tr><td style="padding:6px 0;color:#6b7280;">Customer</td><td style="padding:6px 0;">${opts.customerName}</td></tr>` : ""}
        <tr><td style="padding:6px 0;color:#6b7280;">Agent</td><td style="padding:6px 0;">${opts.agentName} (${opts.agentCode})</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Date</td><td style="padding:6px 0;">${opts.timestamp.toLocaleString("en-NG")}</td></tr>
      </table>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
      <p style="color:#6b7280;font-size:12px;margin:0;">This is an automated receipt from 54Link POS. Do not reply to this email.</p>
    </div>
  `;

  const text = `54Link POS — Transaction Receipt\n\nRef: ${opts.ref}\nType: ${opts.type}\nAmount: ${amountStr}\nFee: ${feeStr}\nCommission: ${commStr}\nAgent: ${opts.agentName} (${opts.agentCode})\nDate: ${opts.timestamp.toLocaleString("en-NG")}`;

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
  agentCode: string;
  tier: string;
  approvedAt: Date;
}): { subject: string; html: string; text: string } {
  const subject = `KYC Approved — Welcome to ${opts.tier} Tier, ${opts.agentName}`;
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #d1fae5;border-radius:8px;background:#f0fdf4;"><h2 style="color:#065f46;">✅ KYC Approved</h2><p>Dear <strong>${opts.agentName}</strong> (${opts.agentCode}), your KYC has been approved. Tier: <strong>${opts.tier}</strong>.</p><p style="color:#6b7280;font-size:12px;">Approved: ${opts.approvedAt.toLocaleString("en-NG")}</p></div>`;
  const text = `KYC Approved\n\nDear ${opts.agentName} (${opts.agentCode}),\nYour KYC has been approved. Tier: ${opts.tier}\nApproved: ${opts.approvedAt.toLocaleString("en-NG")}`;
  return { subject, html, text };
}

export function buildKycRejectionEmail(opts: {
  agentName: string;
  agentCode: string;
  reason: string;
  rejectedAt: Date;
}): { subject: string; html: string; text: string } {
  const subject = `KYC Verification Update — Action Required`;
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #fee2e2;border-radius:8px;background:#fff7f7;"><h2 style="color:#991b1b;">⚠️ KYC Requires Attention</h2><p>Dear <strong>${opts.agentName}</strong> (${opts.agentCode}),</p><p>Reason: ${opts.reason}</p><p style="color:#6b7280;font-size:12px;">Reviewed: ${opts.rejectedAt.toLocaleString("en-NG")}</p></div>`;
  const text = `KYC Update\n\nDear ${opts.agentName} (${opts.agentCode}),\nReason: ${opts.reason}\nReviewed: ${opts.rejectedAt.toLocaleString("en-NG")}`;
  return { subject, html, text };
}

export function buildFloatAlertEmail(opts: {
  agentName: string;
  agentCode: string;
  currentBalance: number;
  threshold: number;
  currency?: string;
}): { subject: string; html: string; text: string } {
  const cur = opts.currency ?? "NGN";
  const fmt = (n: number) =>
    `${cur} ${n.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
  const subject = `Float Balance Alert — ${opts.agentCode} below threshold`;
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border:2px solid #d97706;border-radius:8px;background:#fffbeb;"><h2 style="color:#92400e;">⚠️ Low Float Balance</h2><p>Dear <strong>${opts.agentName}</strong> (${opts.agentCode}),</p><p>Current: <strong style="color:#dc2626;">${fmt(opts.currentBalance)}</strong> | Threshold: ${fmt(opts.threshold)}</p><p>Please top up immediately.</p></div>`;
  const text = `Float Alert\n\n${opts.agentName} (${opts.agentCode})\nCurrent: ${fmt(opts.currentBalance)}\nThreshold: ${fmt(opts.threshold)}`;
  return { subject, html, text };
}

export function buildCommissionPayoutEmail(opts: {
  agentName: string;
  agentCode: string;
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
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #d1fae5;border-radius:8px;background:#f0fdf4;"><h2 style="color:#065f46;">💰 Commission Payout Processed</h2><p>Dear <strong>${opts.agentName}</strong> (${opts.agentCode}),</p><p>Ref: ${opts.payoutRef} | Amount: <strong>${fmt(opts.amount)}</strong> | Period: ${opts.period}</p><p style="color:#6b7280;font-size:12px;">Processed: ${opts.paidAt.toLocaleString("en-NG")}</p></div>`;
  const text = `Commission Payout\n\n${opts.agentName} (${opts.agentCode})\nRef: ${opts.payoutRef}\nAmount: ${fmt(opts.amount)}\nPeriod: ${opts.period}`;
  return { subject, html, text };
}

export function buildOnboardingCompleteEmail(opts: {
  agentName: string;
  agentCode: string;
  completedAt: Date;
}): { subject: string; html: string; text: string } {
  const subject = `Welcome to 54Link — Onboarding Complete, ${opts.agentName}!`;
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #ddd6fe;border-radius:8px;background:#faf5ff;"><h2 style="color:#5b21b6;">🎉 Onboarding Complete!</h2><p>Dear <strong>${opts.agentName}</strong> (${opts.agentCode}),</p><p>All 5 onboarding steps completed. You are now fully activated.</p><p style="color:#6b7280;font-size:12px;">Completed: ${opts.completedAt.toLocaleString("en-NG")}</p></div>`;
  const text = `Onboarding Complete!\n\nDear ${opts.agentName} (${opts.agentCode}),\nAll 5 steps completed.\nCompleted: ${opts.completedAt.toLocaleString("en-NG")}`;
  return { subject, html, text };
}
