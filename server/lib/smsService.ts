// @ts-check
/**
 * Sprint 9: SMS Notification Service
 *
 * Dual-provider SMS delivery with automatic failover:
 *   1. Twilio (primary) — global coverage, reliable delivery
 *   2. Africa's Talking (secondary) — optimized for African markets
 *   3. Termii (tertiary) — existing integration for Nigerian numbers
 *   4. Console (dev fallback) — logs to structured logger
 *
 * Features:
 *   - Automatic failover between providers
 *   - Per-phone rate limiting (anti-spam: max 5 SMS/hour per number)
 *   - Delivery logging with status tracking
 *   - Template rendering for common message types
 *   - Retry logic with exponential backoff
 *   - Phone number normalization (E.164)
 *
 * Environment variables:
 *   TWILIO_ACCOUNT_SID    — Twilio Account SID
 *   TWILIO_AUTH_TOKEN      — Twilio Auth Token
 *   TWILIO_FROM_NUMBER     — Twilio sender number (+1234567890)
 *   AT_API_KEY             — Africa's Talking API key
 *   AT_USERNAME            — Africa's Talking username
 *   AT_SENDER_ID           — Africa's Talking sender ID (e.g. "InsurePortal")
 *   TERMII_API_KEY         — Termii API key (existing)
 *   TERMII_SENDER_ID       — Termii sender ID (default: "InsurePortal")
 */
import { logger } from "../_core/logger";

// ── Types ────────────────────────────────────────────────────────────────────

export type SmsProvider = "twilio" | "africastalking" | "termii" | "console";

export interface SmsMessage {
  to: string;
  body: string;
  from?: string;
  metadata?: Record<string, unknown>;
}

export interface SmsResult {
  success: boolean;
  provider: SmsProvider;
  messageId?: string;
  error?: string;
  timestamp: Date;
  cost?: number;
}

export interface SmsDeliveryLog {
  id: string;
  to: string;
  body: string;
  provider: SmsProvider;
  status: "sent" | "delivered" | "failed" | "pending";
  messageId?: string;
  error?: string;
  cost?: number;
  sentAt: Date;
  deliveredAt?: Date;
}

interface SmsProviderConfig {
  name: SmsProvider;
  enabled: boolean;
  priority: number;
  rateLimit: number; // per minute
  sentThisMinute: number;
  lastResetAt: number;
}

// ── Provider State ───────────────────────────────────────────────────────────

const smsProviders: SmsProviderConfig[] = [
  {
    name: "twilio",
    enabled: !!(
      process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ),
    priority: 1,
    rateLimit: 60,
    sentThisMinute: 0,
    lastResetAt: Date.now(),
  },
  {
    name: "africastalking",
    enabled: !!(process.env.AT_API_KEY && process.env.AT_USERNAME),
    priority: 2,
    rateLimit: 60,
    sentThisMinute: 0,
    lastResetAt: Date.now(),
  },
  {
    name: "termii",
    enabled: !!process.env.TERMII_API_KEY,
    priority: 3,
    rateLimit: 30,
    sentThisMinute: 0,
    lastResetAt: Date.now(),
  },
  {
    name: "console",
    enabled: true,
    priority: 99,
    rateLimit: 999,
    sentThisMinute: 0,
    lastResetAt: Date.now(),
  },
];

// ── Rate Limiting (per-phone anti-spam) ─────────────────────────────────────

const phoneRateLimits = new Map<string, { count: number; resetAt: number }>();
const MAX_SMS_PER_PHONE_PER_HOUR = 5;

function checkPhoneRateLimit(phone: string): boolean {
  const now = Date.now();
  const entry = phoneRateLimits.get(phone);
  if (!entry || now > entry.resetAt) {
    phoneRateLimits.set(phone, { count: 0, resetAt: now + 3600_000 });
    return true;
  }
  return entry.count < MAX_SMS_PER_PHONE_PER_HOUR;
}

function incrementPhoneRateLimit(phone: string): void {
  const entry = phoneRateLimits.get(phone);
  if (entry) entry.count++;
}

function checkProviderRateLimit(provider: SmsProviderConfig): boolean {
  const now = Date.now();
  if (now - provider.lastResetAt > 60_000) {
    provider.sentThisMinute = 0;
    provider.lastResetAt = now;
  }
  return provider.sentThisMinute < provider.rateLimit;
}

// ── Phone Number Normalization ──────────────────────────────────────────────

export function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)\.]/g, "");
  // Add + prefix if starts with country code digit
  if (/^\d{10,15}$/.test(cleaned)) {
    // Assume Nigerian if 11 digits starting with 0
    if (cleaned.length === 11 && cleaned.startsWith("0")) {
      cleaned = "+234" + cleaned.slice(1);
    }
    // Assume Nigerian if 10 digits
    else if (cleaned.length === 10) {
      cleaned = "+234" + cleaned;
    }
    // Otherwise add + prefix
    else {
      cleaned = "+" + cleaned;
    }
  }
  if (!cleaned.startsWith("+")) {
    cleaned = "+" + cleaned;
  }
  return cleaned;
}

// ── Provider Implementations ────────────────────────────────────────────────

async function sendViaTwilio(
  msg: SmsMessage
): Promise<{ messageId: string; cost?: number }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const fromNumber = process.env.TWILIO_FROM_NUMBER ?? "+15005550006"; // test number

  const params = new URLSearchParams({
    To: normalizePhone(msg.to),
    From: msg.from ?? fromNumber,
    Body: msg.body,
  });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => "Unknown error");
    throw new Error(`Twilio ${res.status}: ${errBody}`);
  }

  const data = (await res.json()) as { sid: string; price?: string };
  return {
    messageId: data.sid,
    cost: data.price ? Math.abs(parseFloat(data.price)) : undefined,
  };
}

async function sendViaAfricasTalking(
  msg: SmsMessage
): Promise<{ messageId: string; cost?: number }> {
  const apiKey = process.env.AT_API_KEY!;
  const username = process.env.AT_USERNAME!;
  const senderId = process.env.AT_SENDER_ID ?? "InsurePortal";

  const params = new URLSearchParams({
    username,
    to: normalizePhone(msg.to),
    message: msg.body,
    from: msg.from ?? senderId,
  });

  const baseUrl =
    username === "sandbox"
      ? "https://api.sandbox.africastalking.com"
      : "https://api.africastalking.com";

  const res = await fetch(`${baseUrl}/version1/messaging`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "Unknown error");
    throw new Error(`Africa's Talking ${res.status}: ${errBody}`);
  }

  const data = (await res.json()) as {
    SMSMessageData: {
      Recipients: Array<{ messageId: string; cost: string; status: string }>;
    };
  };

  const recipient = data.SMSMessageData?.Recipients?.[0];
  if (!recipient || recipient.status !== "Success") {
    throw new Error(
      `Africa's Talking: ${recipient?.status ?? "No recipient data"}`
    );
  }

  return {
    messageId: recipient.messageId,
    cost: recipient.cost
      ? parseFloat(recipient.cost.replace(/[^0-9.]/g, ""))
      : undefined,
  };
}

async function sendViaTermii(msg: SmsMessage): Promise<{ messageId: string }> {
  const apiKey = process.env.TERMII_API_KEY!;
  const senderId = process.env.TERMII_SENDER_ID ?? "InsurePortal";

  const body = {
    to: normalizePhone(msg.to).replace("+", ""),
    from: msg.from ?? senderId,
    sms: msg.body,
    type: "plain",
    channel: "generic",
    api_key: apiKey,
  };

  const res = await fetch("https://api.ng.termii.com/api/sms/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "Unknown error");
    throw new Error(`Termii ${res.status}: ${errBody}`);
  }

  const data = (await res.json()) as { message_id?: string };
  return { messageId: data.message_id ?? `termii_${Date.now()}` };
}

async function sendViaConsole(msg: SmsMessage): Promise<{ messageId: string }> {
  logger.info(
    { service: "sms", provider: "console", to: msg.to, bodyPreview: msg.body.substring(0, 100) },
    `[SmsService/DEV] Would send SMS to ${msg.to}`
  );
  return { messageId: `sms_console_${Date.now()}` };
}

// ── Provider Dispatch ───────────────────────────────────────────────────────

const SMS_PROVIDER_FNS: Record<
  SmsProvider,
  (msg: SmsMessage) => Promise<{ messageId: string; cost?: number }>
> = {
  twilio: sendViaTwilio,
  africastalking: sendViaAfricasTalking,
  termii: sendViaTermii,
  console: sendViaConsole,
};

// ── Delivery Log (in-memory, production would use DB) ───────────────────────

const deliveryLog: SmsDeliveryLog[] = [];
const MAX_LOG_SIZE = 10_000;

function logDelivery(entry: SmsDeliveryLog): void {
  deliveryLog.unshift(entry);
  if (deliveryLog.length > MAX_LOG_SIZE) deliveryLog.length = MAX_LOG_SIZE;
}

// ── Main Send Function ──────────────────────────────────────────────────────

/**
 * Send an SMS with automatic provider failover.
 * Tries providers in priority order, skipping disabled or rate-limited ones.
 */
export async function sendSms(msg: SmsMessage): Promise<SmsResult> {
  const normalizedTo = normalizePhone(msg.to);

  // Check per-phone rate limit
  if (!checkPhoneRateLimit(normalizedTo)) {
    const result: SmsResult = {
      success: false,
      provider: "console",
      error: `Rate limited: max ${MAX_SMS_PER_PHONE_PER_HOUR} SMS/hour to ${normalizedTo}`,
      timestamp: new Date(),
    };
    logDelivery({
      id: `sms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      to: normalizedTo,
      body: msg.body,
      provider: "console",
      status: "failed",
      error: result.error,
      sentAt: new Date(),
    });
    return result;
  }

  const sortedProviders = [...smsProviders]
    .filter(p => p.enabled)
    .sort((a, b) => a.priority - b.priority);

  for (const provider of sortedProviders) {
    if (!checkProviderRateLimit(provider)) {
      logger.info(
        { service: "sms", provider: provider.name },
        `[SmsService] ${provider.name} rate limited, trying next provider`
      );
      continue;
    }

    try {
      const sendFn = SMS_PROVIDER_FNS[provider.name];
      const result = await sendFn({ ...msg, to: normalizedTo });
      provider.sentThisMinute++;
      incrementPhoneRateLimit(normalizedTo);

      const logEntry: SmsDeliveryLog = {
        id: `sms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        to: normalizedTo,
        body: msg.body,
        provider: provider.name,
        status: "sent",
        messageId: result.messageId,
        cost: result.cost,
        sentAt: new Date(),
      };
      logDelivery(logEntry);

      logger.info(
        { service: "sms", provider: provider.name, messageId: result.messageId },
        `[SmsService] Sent via ${provider.name}: ${result.messageId}`
      );
      return {
        success: true,
        provider: provider.name,
        messageId: result.messageId,
        cost: result.cost,
        timestamp: new Date(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        { service: "sms", provider: provider.name, error: message },
        `[SmsService] ${provider.name} failed: ${message}, trying next`
      );
      continue;
    }
  }

  const failEntry: SmsDeliveryLog = {
    id: `sms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    to: normalizedTo,
    body: msg.body,
    provider: "console",
    status: "failed",
    error: "All SMS providers failed",
    sentAt: new Date(),
  };
  logDelivery(failEntry);

  return {
    success: false,
    provider: "console",
    error: "All SMS providers failed",
    timestamp: new Date(),
  };
}

/**
 * Send SMS to multiple recipients.
 */
export async function sendBatchSms(
  recipients: string[],
  body: string
): Promise<{ sent: number; failed: number; results: SmsResult[] }> {
  const results: SmsResult[] = [];
  let sent = 0;
  let failed = 0;

  for (const to of recipients) {
    const result = await sendSms({ to, body });
    results.push(result);
    if (result.success) sent++;
    else failed++;
    // Small delay between sends
    await new Promise(r => setTimeout(r, 200));
  }

  return { sent, failed, results };
}

/**
 * Send SMS with retry (exponential backoff).
 */
export async function sendSmsWithRetry(
  msg: SmsMessage,
  maxRetries: number = 3
): Promise<SmsResult> {
  let lastResult: SmsResult | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    lastResult = await sendSms(msg);
    if (lastResult.success) return lastResult;

    if (attempt < maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  return lastResult!;
}

// ── Provider Status ─────────────────────────────────────────────────────────

export function getSmsProviderStatus(): Array<{
  name: SmsProvider;
  enabled: boolean;
  priority: number;
  sentThisMinute: number;
  rateLimit: number;
}> {
  return smsProviders.map(p => ({
    name: p.name,
    enabled: p.enabled,
    priority: p.priority,
    sentThisMinute: p.sentThisMinute,
    rateLimit: p.rateLimit,
  }));
}

/**
 * Get delivery log with optional filters.
 */
export function getSmsDeliveryLog(opts?: {
  phone?: string;
  provider?: SmsProvider;
  status?: string;
  limit?: number;
}): SmsDeliveryLog[] {
  let logs = [...deliveryLog];
  if (opts?.phone) logs = logs.filter(l => l.to.includes(opts.phone!));
  if (opts?.provider) logs = logs.filter(l => l.provider === opts.provider);
  if (opts?.status) logs = logs.filter(l => l.status === opts.status);
  return logs.slice(0, opts?.limit ?? 100);
}

/**
 * Get SMS stats summary.
 */
export function getSmsStats(): {
  totalSent: number;
  totalFailed: number;
  totalCost: number;
  byProvider: Record<string, number>;
} {
  const byProvider: Record<string, number> = {};
  let totalSent = 0;
  let totalFailed = 0;
  let totalCost = 0;

  for (const log of deliveryLog) {
    if (log.status === "sent" || log.status === "delivered") {
      totalSent++;
      totalCost += log.cost ?? 0;
    } else {
      totalFailed++;
    }
    byProvider[log.provider] = (byProvider[log.provider] ?? 0) + 1;
  }

  return { totalSent, totalFailed, totalCost, byProvider };
}

// ── SMS Templates ───────────────────────────────────────────────────────────

export function buildRateAlertSms(opts: {
  agentName: string;
  baseCurrency: string;
  targetCurrency: string;
  targetRate: number;
  currentRate: number;
  direction: "above" | "below";
}): SmsMessage {
  const verb = opts.direction === "above" ? "risen above" : "fallen below";
  return {
    to: "",
    body: `InsurePortal Alert: ${opts.baseCurrency}/${opts.targetCurrency} has ${verb} your target of ${opts.targetRate}. Current rate: ${opts.currentRate}. Log in to manage your alerts.`,
  };
}

export function buildFraudAlertSms(opts: {
  agentName: string;
  severity: string;
  type: string;
  amount: number;
  currency: string;
}): SmsMessage {
  return {
    to: "",
    body: `InsurePortal FRAUD ALERT [${opts.severity.toUpperCase()}]: ${opts.type} detected. Amount: ${opts.currency} ${opts.amount.toLocaleString()}. Agent: ${opts.agentName}. Take immediate action.`,
  };
}

export function buildTransactionConfirmSms(opts: {
  type: string;
  amount: number;
  currency: string;
  ref: string;
  customerName?: string;
}): SmsMessage {
  return {
    to: "",
    body: `InsurePortal: ${opts.type} of ${opts.currency} ${opts.amount.toLocaleString()} confirmed. Ref: ${opts.ref}${opts.customerName ? `. Customer: ${opts.customerName}` : ""}. Thank you.`,
  };
}

export function buildOtpSms(opts: {
  otp: string;
  expiresInMinutes: number;
}): SmsMessage {
  return {
    to: "",
    body: `Your InsurePortal verification code is: ${opts.otp}. Valid for ${opts.expiresInMinutes} minutes. Do not share this code.`,
  };
}

export function buildSettlementSms(opts: {
  agentName: string;
  txCount: number;
  totalVolume: number;
  commission: number;
  currency: string;
}): SmsMessage {
  return {
    to: "",
    body: `InsurePortal Daily Settlement: ${opts.agentName}, ${opts.txCount} transactions processed. Volume: ${opts.currency} ${opts.totalVolume.toLocaleString()}. Commission: ${opts.currency} ${opts.commission.toLocaleString()}.`,
  };
}
