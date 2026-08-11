// TypeScript enabled — Sprint 96 security audit
import { ENV } from "./_core/env";
import { logger } from './_core/logger';
/**
 * termii.ts — Shared Termii SMS helper for the InsurePortal platform.
 *
 * All SMS-sending logic is centralised here so every router (transactions,
 * pinReset, settlement, smsReceipt, disputes) uses the same API client and
 * graceful-fallback behaviour.
 *
 * MOCKWARE FIX: When TERMII_API_KEY is absent the helper no longer fakes
 * success. In production it returns a degraded failure
 * ({success:false, degraded:true, error:"SMS provider not configured"}).
 * The console fallback only applies outside production and is clearly
 * labelled as a development fallback.
 */

const TERMII_URL = "https://api.ng.termii.com/api/sms/send";

export interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
  degraded?: boolean;
}

/**
 * Send a plain-text SMS via Termii.
 *
 * @param to      Recipient phone number (E.164 or local 10-digit Nigerian format).
 * @param message SMS body (max 160 chars per segment).
 */
export async function sendSms(to: string, message: string): Promise<SmsResult> {
  // Read at call time so tests can set process.env.TERMII_API_KEY in beforeEach
  const apiKey = process.env.TERMII_API_KEY ?? ENV.termiiApiKey;

  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      // Honest degraded failure — never fake delivery in production.
      logger.error(`[SMS] Termii API key not configured — cannot send SMS to ${to}`);
      return {
        success: false,
        degraded: true,
        error: "SMS provider not configured",
      };
    }
    // Development-only console fallback (labelled — not a real send).
    logger.info(`[SMS DEV-ONLY Console Fallback — no SMS sent] To: ${to}\n${message}\n`);
    return {
      success: true,
      degraded: true,
      messageId: `CONSOLE-DEV-${Date.now()}`,
      error: "SMS provider not configured — logged to console (development only)",
    };
  }

  try {
    const response = await fetch(TERMII_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to,
        from: "InsurePortal",
        sms: message,
        type: "plain",
        channel: "generic",
        api_key: apiKey,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error(`[SMS] Termii error ${response.status}: ${text}`);
      return { success: false, error: `Termii ${response.status}: ${text}` };
    }

    const data = (await response.json()) as {
      message_id?: string;
      message?: string;
    };
    return { success: true, messageId: data.message_id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[SMS] Network error: ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * Build the customer-confirmation SMS body for Cash Out / Transfer / Card /
 * QR / NFC transactions.
 *
 * Includes a dispute-reply instruction per CBN consumer-protection guidelines.
 */
export function buildConfirmationSms(data: {
  ref: string;
  type: string;
  amount: number;
  agentId: string;
  agentName: string;
  customerName?: string | null;
  timestamp?: Date;
}): string {
  const ts = (data.timestamp ?? new Date()).toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const lines = [
    `InsurePortal Insurance`,
    `Ref: ${data.ref}`,
    `Type: ${data.type}`,
    `Amount: NGN ${data.amount.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`,
  ];
  if (data.customerName) lines.push(`Customer: ${data.customerName}`);
  lines.push(`Agent: ${data.agentName} (${data.agentId})`);
  lines.push(`Time: ${ts}`);
  lines.push(`To dispute, call 0700-54LINK or reply DISPUTE to this number.`);
  return lines.join("\n");
}

/**
 * Build the receipt SMS body (used by smsReceipt router).
 */
export function buildReceiptSms(data: {
  ref: string;
  type: string;
  amount: number;
  fee: number;
  agentId: string;
  agentName: string;
  customerName?: string | null;
}): string {
  const lines = [
    `InsurePortal Receipt`,
    `Ref: ${data.ref}`,
    `Type: ${data.type}`,
    `Amount: NGN ${data.amount.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`,
  ];
  if (data.fee > 0) lines.push(`Fee: NGN ${data.fee.toFixed(2)}`);
  if (data.customerName) lines.push(`Customer: ${data.customerName}`);
  lines.push(`Agent: ${data.agentName} (${data.agentId})`);
  lines.push(
    `Time: ${new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}`
  );
  lines.push(`Powered by InsurePortal Insurance`);
  return lines.join("\n");
}
