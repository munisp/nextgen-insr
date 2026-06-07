// TypeScript enabled — Sprint 96 security audit
interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: Array<{ filename: string; content: string | Buffer }>;
  category?: string;
  tags?: string[];
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider?: string;
  timestamp?: Date;
}

export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  if (!smtpHost || !smtpUser) {
    const to = Array.isArray(options.to) ? options.to.join(", ") : options.to;
    console.log(`[Email] (console) To: ${to} | Subject: ${options.subject}`);
    return {
      success: true,
      messageId: `console_local-${Date.now()}`,
      provider: "console",
      timestamp: new Date(),
    };
  }
  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(process.env.SMTP_PORT ?? "587"),
      secure: Number(process.env.SMTP_PORT ?? "587") === 465,
      auth: { user: smtpUser, pass: process.env.SMTP_PASS },
    });
    const result = await transporter.sendMail({
      from: options.from ?? process.env.EMAIL_FROM ?? "noreply@insureportal.com",
      to: Array.isArray(options.to) ? options.to.join(", ") : options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    return {
      success: true,
      messageId: result.messageId,
      provider: "smtp",
      timestamp: new Date(),
    };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message,
      provider: "smtp",
      timestamp: new Date(),
    };
  }
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  category?: string;
  tags?: string[];
  attachments?: Array<{ filename: string; content: string | Buffer }>;
}

export async function sendBatchEmail(
  recipientsOrMessages: string[] | EmailMessage[],
  sharedOptions?: {
    subject?: string;
    html?: string;
    text?: string;
    batchSize?: number;
    delayMs?: number;
  }
): Promise<{
  sent: number;
  failed: number;
  errors: string[];
  results: EmailResult[];
}> {
  const batchSize = sharedOptions?.batchSize ?? 10;
  const delayMs = sharedOptions?.delayMs ?? 100;
  let sent = 0,
    failed = 0;
  const errors: string[] = [],
    results: EmailResult[] = [];
  if (!recipientsOrMessages.length)
    return { sent: 0, failed: 0, errors: [], results: [] };
  const messages: EmailMessage[] =
    typeof recipientsOrMessages[0] === "string"
      ? (recipientsOrMessages as string[]).map(to => ({
          to,
          subject: sharedOptions?.subject ?? "",
          html: sharedOptions?.html ?? "",
        }))
      : (recipientsOrMessages as EmailMessage[]);
  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(msg =>
        sendEmail({
          to: msg.to,
          subject: msg.subject,
          html: msg.html,
          from: msg.from,
        })
      )
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled" && r.value.success) {
        sent++;
        results.push(r.value);
      } else {
        failed++;
        const e =
          r.status === "rejected"
            ? r.reason?.message
            : (r.value?.error ?? "Unknown");
        errors.push(e);
        results.push(
          r.status === "fulfilled"
            ? r.value
            : {
                success: false,
                error: e,
                provider: "unknown",
                timestamp: new Date(),
              }
        );
      }
    }
    if (i + batchSize < messages.length && delayMs > 0)
      await new Promise(r => setTimeout(r, delayMs));
  }
  return { sent, failed, errors, results };
}

export function getProviderStatus(): Array<{
  name: string;
  enabled: boolean;
  configured: boolean;
  healthy: boolean;
}> {
  return [
    { name: "console", enabled: true, configured: true, healthy: true },
    {
      name: "smtp",
      enabled: !!process.env.SMTP_HOST,
      configured: !!process.env.SMTP_HOST,
      healthy: !!process.env.SMTP_HOST,
    },
    {
      name: "sendgrid",
      enabled: !!process.env.SENDGRID_API_KEY,
      configured: !!process.env.SENDGRID_API_KEY,
      healthy: !!process.env.SENDGRID_API_KEY,
    },
  ];
}

export function buildTransactionReceiptEmail(data: {
  ref: string;
  type: string;
  amount: number;
  agentCode: string;
  customerName?: string;
  timestamp: Date;
}): string {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:#1a1a2e;color:white;padding:20px;text-align:center"><h1 style="margin:0">InsurePortal POS</h1><p style="margin:5px 0 0">Transaction Receipt</p></div><div style="padding:20px;background:#f8f9fa"><table style="width:100%;border-collapse:collapse"><tr><td style="padding:8px;border-bottom:1px solid #dee2e6"><strong>Reference</strong></td><td>${data.ref}</td></tr><tr><td style="padding:8px;border-bottom:1px solid #dee2e6"><strong>Type</strong></td><td>${data.type}</td></tr><tr><td style="padding:8px;border-bottom:1px solid #dee2e6"><strong>Amount</strong></td><td>₦${data.amount.toLocaleString()}</td></tr><tr><td style="padding:8px;border-bottom:1px solid #dee2e6"><strong>Agent</strong></td><td>${data.agentCode}</td></tr><tr><td style="padding:8px;border-bottom:1px solid #dee2e6"><strong>Date</strong></td><td>${data.timestamp.toLocaleString()}</td></tr></table></div></div>`;
}

export function buildRateAlertEmail(data: {
  agentName?: string;
  agentCode?: string;
  alertType?: string;
  baseCurrency?: string;
  targetCurrency?: string;
  targetRate?: number;
  currentRate?: number;
  direction?: string;
  threshold?: number;
  message?: string;
  triggeredAt?: Date;
}): EmailMessage {
  const pair =
    data.baseCurrency && data.targetCurrency
      ? `${data.baseCurrency}/${data.targetCurrency}`
      : "";
  const dirText = data.direction === "below" ? "fallen below" : "risen above";
  const subject = pair
    ? `Rate Alert: ${pair} has ${dirText} your target of ${data.targetRate}`
    : `Rate Alert: ${data.alertType ?? "threshold"} triggered`;
  const tags: string[] = [];
  if (data.baseCurrency) tags.push(data.baseCurrency);
  if (data.targetCurrency) tags.push(data.targetCurrency);
  tags.push("rate_alert");
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:#e74c3c;color:white;padding:20px;text-align:center"><h1 style="margin:0">Rate Alert</h1></div><div style="padding:20px"><p>Dear ${data.agentName ?? data.agentCode ?? "Agent"},</p>${pair ? `<p>The exchange rate for <strong>${pair}</strong> has ${dirText} your target rate of <strong>${data.targetRate}</strong>.</p>` : ""}<p>Current Rate: <strong>${data.currentRate}</strong></p>${data.triggeredAt ? `<p style="color:#999;font-size:12px">Triggered at: ${data.triggeredAt.toISOString()}</p>` : ""}</div></div>`;
  return {
    to: "",
    subject,
    html,
    text: `Rate Alert: ${pair || data.alertType} — Current: ${data.currentRate}`,
    category: "rate_alert",
    tags,
  };
}

export function buildWelcomeEmail(data: {
  agentName: string;
  agentCode: string;
}): EmailMessage {
  const html = `<!DOCTYPE html><html><body><div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:#1a1a2e;color:white;padding:20px;text-align:center"><h1 style="margin:0">InsurePortal POS</h1><p>Welcome to the Platform</p></div><div style="padding:20px"><p>Dear ${data.agentName},</p><p>Welcome to InsurePortal POS! Your agent code: <strong>${data.agentCode}</strong></p></div></div></body></html>`;
  return {
    to: "",
    subject: `Welcome to InsurePortal POS — Agent ${data.agentCode}`,
    html,
    text: `Welcome ${data.agentName}! Agent code: ${data.agentCode}`,
    category: "welcome",
    tags: ["welcome", "onboarding"],
  };
}

export function buildPasswordResetEmail(data: {
  agentName: string;
  otp: string;
  expiresInMinutes: number;
}): EmailMessage {
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:#e67e22;color:white;padding:20px;text-align:center"><h1 style="margin:0">PIN Reset Request</h1></div><div style="padding:20px"><p>Dear ${data.agentName},</p><p>Your OTP code: <strong>${data.otp}</strong></p><p>Expires in <strong>${data.expiresInMinutes} minutes</strong>.</p></div></div>`;
  return {
    to: "",
    subject: "PIN Reset OTP — InsurePortal POS",
    html,
    text: `OTP: ${data.otp}. Expires in ${data.expiresInMinutes} min.`,
    category: "security",
    tags: ["pin_reset", "security"],
  };
}

export function buildDigestEmail(data: {
  agentName?: string;
  recipientName?: string;
  period: string;
  txCount?: number;
  totalVolume?: number;
  totalCommission?: number;
  alertCount?: number;
  items?: Array<{ title: string; summary: string }>;
}): EmailMessage {
  const name = data.agentName ?? data.recipientName ?? "Agent";
  const itemsHtml = data.items
    ? data.items
        .map(
          i =>
            `<tr><td style="padding:12px;border-bottom:1px solid #eee"><strong>${i.title}</strong><br/><span style="color:#666">${i.summary}</span></td></tr>`
        )
        .join("")
    : "";
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:#1a1a2e;color:white;padding:20px;text-align:center"><h1 style="margin:0">InsurePortal POS</h1><p>${data.period} Digest</p></div><div style="padding:20px"><p>Hello ${name},</p><p>Here's your ${data.period} summary:</p>${data.txCount !== undefined ? `<p>Transactions: ${data.txCount}</p>` : ""}${itemsHtml ? `<table style="width:100%">${itemsHtml}</table>` : ""}</div></div>`;
  return {
    to: "",
    subject: `${data.period} Digest — InsurePortal POS`,
    html,
    text: `${data.period} digest for ${name}`,
    category: "digest",
    tags: ["digest", data.period.toLowerCase()],
  };
}

export function buildKycExpiryWarningEmail(
  agentCode: string,
  daysUntilExpiry: number
): string {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:#e74c3c;color:white;padding:20px;text-align:center"><h1 style="margin:0">KYC Expiry Warning</h1></div><div style="padding:20px"><p>Dear Agent <strong>${agentCode}</strong>,</p><p>Your KYC documents will expire in <strong>${daysUntilExpiry} days</strong>.</p></div></div>`;
}

export function extractEmailFromString(formatted: string): string {
  const match = formatted.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return match ? match[0] : "";
}
