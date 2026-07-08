// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * Email Delivery Service — Nodemailer with SMTP configuration
 * Supports weekly report delivery, notification emails, and transactional emails.
 * Falls back to console.log when SMTP is not configured.
 */

interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
  }>;
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// SMTP configuration from environment
const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587");
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "InsurePortal POS <noreply@insureportal.com>";

const isSmtpConfigured = SMTP_USER && SMTP_PASS;

// ─── Email Templates ────────────────────────────────────────────────────────

export function weeklyReportTemplate(data: {
  agentName: string;
  weekStart: string;
  weekEnd: string;
  totalTransactions: number;
  totalVolume: number;
  totalCommission: number;
  fraudAlerts: number;
  topTransactionType: string;
  premiumReserve: number;
}): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;margin-top:20px;">
    <div style="background:#1e40af;color:#fff;padding:24px;text-align:center;">
      <h1 style="margin:0;font-size:24px;">InsurePortal POS</h1>
      <p style="margin:4px 0 0;opacity:0.9;">Weekly Performance Report</p>
    </div>
    <div style="padding:24px;">
      <p>Hello <strong>${data.agentName}</strong>,</p>
      <p>Here's your performance summary for <strong>${data.weekStart} — ${data.weekEnd}</strong>:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:12px;border-bottom:1px solid #eee;color:#666;">Total Transactions</td><td style="padding:12px;border-bottom:1px solid #eee;font-weight:bold;text-align:right;">${data.totalTransactions.toLocaleString()}</td></tr>
        <tr><td style="padding:12px;border-bottom:1px solid #eee;color:#666;">Total Volume</td><td style="padding:12px;border-bottom:1px solid #eee;font-weight:bold;text-align:right;">₦${data.totalVolume.toLocaleString()}</td></tr>
        <tr><td style="padding:12px;border-bottom:1px solid #eee;color:#666;">Commission Earned</td><td style="padding:12px;border-bottom:1px solid #eee;font-weight:bold;text-align:right;color:#16a34a;">₦${data.totalCommission.toLocaleString()}</td></tr>
        <tr><td style="padding:12px;border-bottom:1px solid #eee;color:#666;">Fraud Alerts</td><td style="padding:12px;border-bottom:1px solid #eee;font-weight:bold;text-align:right;color:${data.fraudAlerts > 0 ? "#dc2626" : "#16a34a"};">${data.fraudAlerts}</td></tr>
        <tr><td style="padding:12px;border-bottom:1px solid #eee;color:#666;">Top Transaction Type</td><td style="padding:12px;border-bottom:1px solid #eee;font-weight:bold;text-align:right;">${data.topTransactionType}</td></tr>
        <tr><td style="padding:12px;color:#666;">Current Float Balance</td><td style="padding:12px;font-weight:bold;text-align:right;">₦${data.premiumReserve.toLocaleString()}</td></tr>
      </table>
      <p style="color:#666;font-size:14px;">Keep up the great work! Log in to your dashboard for detailed analytics.</p>
    </div>
    <div style="background:#f4f4f7;padding:16px;text-align:center;font-size:12px;color:#999;">
      <p>InsurePortal Agent Banking Platform — Powered by InsurePortal Technologies</p>
      <p>This is an automated report. Do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;
}

export function transactionReceiptTemplate(data: {
  reference: string;
  type: string;
  amount: number;
  fee: number;
  customerName: string;
  agentId: string;
  timestamp: string;
  status: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:Arial,sans-serif;">
  <div style="max-width:400px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden;">
    <div style="background:#1e40af;color:#fff;padding:16px;text-align:center;">
      <h2 style="margin:0;">Transaction Receipt</h2>
    </div>
    <div style="padding:20px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px 0;color:#666;">Reference</td><td style="padding:8px 0;font-weight:bold;text-align:right;">${data.reference}</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Type</td><td style="padding:8px 0;text-align:right;">${data.type}</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Amount</td><td style="padding:8px 0;font-weight:bold;text-align:right;">₦${data.amount.toLocaleString()}</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Fee</td><td style="padding:8px 0;text-align:right;">₦${data.fee.toLocaleString()}</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Customer</td><td style="padding:8px 0;text-align:right;">${data.customerName}</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Agent</td><td style="padding:8px 0;text-align:right;">${data.agentId}</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Date</td><td style="padding:8px 0;text-align:right;">${data.timestamp}</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Status</td><td style="padding:8px 0;font-weight:bold;text-align:right;color:#16a34a;">${data.status}</td></tr>
      </table>
    </div>
    <div style="background:#f4f4f7;padding:12px;text-align:center;font-size:11px;color:#999;">InsurePortal POS — Thank you for your transaction</div>
  </div>
</body>
</html>`;
}

export function kycReminderTemplate(data: {
  agentName: string;
  currentTier: string;
  requiredDocs: string[];
}): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden;">
    <div style="background:#f59e0b;color:#fff;padding:20px;text-align:center;">
      <h2 style="margin:0;">KYC Verification Reminder</h2>
    </div>
    <div style="padding:24px;">
      <p>Hello <strong>${data.agentName}</strong>,</p>
      <p>Your current KYC tier is <strong>${data.currentTier}</strong>. To increase your daily transaction limits, please submit the following documents:</p>
      <ul>${data.requiredDocs.map(d => `<li style="padding:4px 0;">${d}</li>`).join("")}</ul>
      <p>Log in to your dashboard and navigate to KYC Verification to upload documents.</p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Send Email ─────────────────────────────────────────────────────────────

export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  const recipients = Array.isArray(options.to) ? options.to : [options.to];

  if (!isSmtpConfigured) {
    console.log(
      `[Email] SMTP not configured — would send to: ${recipients.join(", ")}`
    );
    console.log(`[Email] Subject: ${options.subject}`);
    console.log(
      `[Email] Body preview: ${options.text || options.html.substring(0, 200)}...`
    );
    return { success: true, messageId: `local-${Date.now()}` };
  }

  try {
    // Dynamic import to avoid requiring nodemailer when not configured
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    const info = await transporter.sendMail({
      from: SMTP_FROM,
      to: recipients.join(", "),
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments: options.attachments,
    });

    console.log(
      `[Email] Sent to ${recipients.join(", ")} — messageId: ${info.messageId}`
    );
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error(`[Email] Failed to send: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ─── Batch Email Delivery ───────────────────────────────────────────────────

export async function sendBatchEmails(
  emails: EmailOptions[],
  concurrency = 5
): Promise<{ sent: number; failed: number; results: EmailResult[] }> {
  const results: EmailResult[] = [];
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < emails.length; i += concurrency) {
    const batch = emails.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(sendEmail));

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
        if (result.value.success) sent++;
        else failed++;
      } else {
        results.push({ success: false, error: result.reason?.message });
        failed++;
      }
    }
  }

  console.log(
    `[Email] Batch complete: ${sent} sent, ${failed} failed out of ${emails.length}`
  );
  return { sent, failed, results };
}
