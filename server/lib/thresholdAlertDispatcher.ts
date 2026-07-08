// @ts-check

/**
 * Threshold Alert Notification Dispatcher
 * Connects breach events from the data threshold alert system to email and SMS services.
 * Supports cooldown periods, notification history, and multi-channel dispatch.
 */
import { logger } from '../_core/logger';

// ─── Types ───────────────────────────────────────────────────────────────────
type Severity = "info" | "warning" | "critical";
type Channel = "email" | "sms" | "push" | "webhook" | "in-app";

interface BreachEvent {
  eventId: string;
  ruleId: string;
  ruleName: string;
  metric: string;
  metricLabel: string;
  operator: string;
  threshold: number;
  actualValue: number;
  unit: string;
  severity: Severity;
  channels: Channel[];
  recipients: string[];
  message: string;
  createdAt: string;
}

interface NotificationRecord {
  id: string;
  eventId: string;
  ruleId: string;
  channel: Channel;
  recipient: string;
  status: "sent" | "failed" | "skipped_cooldown" | "skipped_quiet_hours";
  sentAt: string;
  errorMessage?: string;
}

interface CooldownEntry {
  ruleId: string;
  channel: Channel;
  lastSentAt: number;
  cooldownMs: number;
}

// ─── Notification History Store ──────────────────────────────────────────────
const notificationHistory: NotificationRecord[] = [];
const cooldowns: CooldownEntry[] = [];
let nextNotifId = 1;

// ─── Severity Configuration ─────────────────────────────────────────────────
const SEVERITY_CONFIG: Record<
  Severity,
  {
    emailSubjectPrefix: string;
    emailPriority: "high" | "normal" | "low";
    smsPrefix: string;
    enableSms: boolean;
    cooldownMultiplier: number;
  }
> = {
  critical: {
    emailSubjectPrefix: "🚨 CRITICAL ALERT",
    emailPriority: "high",
    smsPrefix: "[CRITICAL]",
    enableSms: true,
    cooldownMultiplier: 0.5, // shorter cooldown for critical
  },
  warning: {
    emailSubjectPrefix: "⚠️ WARNING",
    emailPriority: "normal",
    smsPrefix: "[WARNING]",
    enableSms: true,
    cooldownMultiplier: 1.0,
  },
  info: {
    emailSubjectPrefix: "ℹ️ INFO",
    emailPriority: "low",
    smsPrefix: "[INFO]",
    enableSms: false, // no SMS for info-level
    cooldownMultiplier: 2.0, // longer cooldown for info
  },
};

// ─── Quiet Hours Configuration ──────────────────────────────────────────────
const QUIET_HOURS = {
  enabled: true,
  start: 22, // 10 PM
  end: 7, // 7 AM
  timezone: "Africa/Lagos",
  bypassForCritical: true, // critical alerts always go through
};

// ─── Email Templates ────────────────────────────────────────────────────────
function buildBreachEmailHtml(event: BreachEvent): string {
  const severityColors: Record<Severity, string> = {
    critical: "#dc2626",
    warning: "#d97706",
    info: "#2563eb",
  };
  const color = severityColors[event.severity];

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="border-left: 4px solid ${color}; padding: 16px; background: #f8f9fa; border-radius: 4px; margin-bottom: 20px;">
    <h2 style="margin: 0 0 8px; color: ${color}; font-size: 18px;">
      ${SEVERITY_CONFIG[event.severity].emailSubjectPrefix}: ${event.ruleName}
    </h2>
    <p style="margin: 0; color: #374151; font-size: 14px;">${event.message}</p>
  </div>

  <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 8px 0; color: #6b7280; width: 140px;">Metric</td>
      <td style="padding: 8px 0; font-weight: 600;">${event.metricLabel}</td>
    </tr>
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 8px 0; color: #6b7280;">Current Value</td>
      <td style="padding: 8px 0; font-weight: 600; color: ${color};">${event.actualValue} ${event.unit}</td>
    </tr>
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 8px 0; color: #6b7280;">Threshold</td>
      <td style="padding: 8px 0;">${event.operator} ${event.threshold} ${event.unit}</td>
    </tr>
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 8px 0; color: #6b7280;">Severity</td>
      <td style="padding: 8px 0;">
        <span style="background: ${color}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; text-transform: uppercase;">
          ${event.severity}
        </span>
      </td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #6b7280;">Triggered At</td>
      <td style="padding: 8px 0;">${new Date(event.createdAt).toLocaleString()}</td>
    </tr>
  </table>

  <div style="margin-top: 24px; padding: 12px; background: #fef3c7; border-radius: 4px; font-size: 13px; color: #92400e;">
    <strong>Action Required:</strong> Please review this alert in the InsurePortal Dashboard under
    Data Threshold Alerts and acknowledge or resolve it.
  </div>

  <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
    <p>This is an automated alert from InsurePortal POS Shell. Rule ID: ${event.ruleId} | Event ID: ${event.eventId}</p>
    <p>To manage your alert preferences, visit the Data Threshold Alerts page in your dashboard.</p>
  </div>
</body>
</html>`;
}

function buildBreachEmailText(event: BreachEvent): string {
  return `${SEVERITY_CONFIG[event.severity].emailSubjectPrefix}: ${event.ruleName}

${event.message}

Metric: ${event.metricLabel}
Current Value: ${event.actualValue} ${event.unit}
Threshold: ${event.operator} ${event.threshold} ${event.unit}
Severity: ${event.severity.toUpperCase()}
Triggered At: ${new Date(event.createdAt).toLocaleString()}

Action Required: Review this alert in the InsurePortal Dashboard.

Rule ID: ${event.ruleId} | Event ID: ${event.eventId}`;
}

function buildBreachSmsText(event: BreachEvent): string {
  const prefix = SEVERITY_CONFIG[event.severity].smsPrefix;
  return `${prefix} ${event.ruleName}: ${event.metricLabel} is ${event.actualValue}${event.unit} (threshold: ${event.threshold}${event.unit}). Review in dashboard.`;
}

// ─── Cooldown Management ────────────────────────────────────────────────────
function isCooldownActive(
  ruleId: string,
  channel: Channel,
  cooldownMinutes: number,
  severity: Severity
): boolean {
  const entry = cooldowns.find(
    c => c.ruleId === ruleId && c.channel === channel
  );
  if (!entry) return false;
  const effectiveCooldown =
    cooldownMinutes * SEVERITY_CONFIG[severity].cooldownMultiplier * 60 * 1000;
  return Date.now() - entry.lastSentAt < effectiveCooldown;
}

function updateCooldown(
  ruleId: string,
  channel: Channel,
  cooldownMinutes: number
): void {
  const existing = cooldowns.find(
    c => c.ruleId === ruleId && c.channel === channel
  );
  if (existing) {
    existing.lastSentAt = Date.now();
    existing.cooldownMs = cooldownMinutes * 60 * 1000;
  } else {
    cooldowns.push({
      ruleId,
      channel,
      lastSentAt: Date.now(),
      cooldownMs: cooldownMinutes * 60 * 1000,
    });
  }
}

// ─── Quiet Hours Check ──────────────────────────────────────────────────────
function isQuietHours(severity: Severity): boolean {
  if (!QUIET_HOURS.enabled) return false;
  if (QUIET_HOURS.bypassForCritical && severity === "critical") return false;
  const now = new Date();
  const hour = now.getHours(); // Simplified — production would use timezone-aware check
  if (QUIET_HOURS.start > QUIET_HOURS.end) {
    return hour >= QUIET_HOURS.start || hour < QUIET_HOURS.end;
  }
  return hour >= QUIET_HOURS.start && hour < QUIET_HOURS.end;
}

// ─── Mock Send Functions (production: wire to real emailService/smsService) ──
async function sendEmailNotification(
  to: string,
  subject: string,
  html: string,
  _text: string,
  _priority: "high" | "normal" | "low"
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // In production, this calls:
  // import { sendEmail } from './emailService';
  // return sendEmail({ to, subject, html, text, priority, tags: ['threshold-alert'] });
  logger.info(`[ThresholdDispatcher] EMAIL → ${to}: ${subject}`);
  return {
    success: true,
    messageId: `email_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  };
}

async function sendSmsNotification(
  to: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // In production, this calls:
  // import { sendSms } from './smsService';
  // return sendSms({ to, message, provider: 'auto' });
  logger.info(`[ThresholdDispatcher] SMS → ${to}: ${message.slice(0, 50)}...`);
  return {
    success: true,
    messageId: `sms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  };
}

async function sendPushNotification(
  _userId: string,
  title: string,
  _body: string
): Promise<{ success: boolean }> {
  logger.info(`[ThresholdDispatcher] PUSH: ${title}`);
  return { success: true };
}

async function sendWebhookNotification(
  _url: string,
  payload: object
): Promise<{ success: boolean }> {
  logger.info(`[ThresholdDispatcher] WEBHOOK:: ` + JSON.stringify(payload).slice(0, 100)
  );
  return { success: true };
}

// ─── Main Dispatch Function ─────────────────────────────────────────────────
export async function dispatchThresholdAlert(
  event: BreachEvent,
  cooldownMinutes: number = 60
): Promise<{
  dispatched: NotificationRecord[];
  skipped: NotificationRecord[];
  summary: {
    sent: number;
    failed: number;
    skippedCooldown: number;
    skippedQuietHours: number;
  };
}> {
  const dispatched: NotificationRecord[] = [];
  const skipped: NotificationRecord[] = [];
  const summary = {
    sent: 0,
    failed: 0,
    skippedCooldown: 0,
    skippedQuietHours: 0,
  };

  const config = SEVERITY_CONFIG[event.severity];
  const emailSubject = `${config.emailSubjectPrefix}: ${event.ruleName}`;
  const emailHtml = buildBreachEmailHtml(event);
  const emailText = buildBreachEmailText(event);
  const smsText = buildBreachSmsText(event);

  for (const channel of event.channels) {
    // Check cooldown
    if (
      isCooldownActive(event.ruleId, channel, cooldownMinutes, event.severity)
    ) {
      const record: NotificationRecord = {
        id: `notif_${nextNotifId++}`,
        eventId: event.eventId,
        ruleId: event.ruleId,
        channel,
        recipient: "all",
        status: "skipped_cooldown",
        sentAt: new Date().toISOString(),
      };
      skipped.push(record);
      notificationHistory.push(record);
      summary.skippedCooldown++;
      continue;
    }

    // Check quiet hours
    if (isQuietHours(event.severity)) {
      const record: NotificationRecord = {
        id: `notif_${nextNotifId++}`,
        eventId: event.eventId,
        ruleId: event.ruleId,
        channel,
        recipient: "all",
        status: "skipped_quiet_hours",
        sentAt: new Date().toISOString(),
      };
      skipped.push(record);
      notificationHistory.push(record);
      summary.skippedQuietHours++;
      continue;
    }

    // Dispatch per channel
    switch (channel) {
      case "email": {
        for (const recipient of event.recipients) {
          if (!recipient.includes("@")) continue; // skip non-email recipients
          const result = await sendEmailNotification(
            recipient,
            emailSubject,
            emailHtml,
            emailText,
            config.emailPriority
          );
          const record: NotificationRecord = {
            id: `notif_${nextNotifId++}`,
            eventId: event.eventId,
            ruleId: event.ruleId,
            channel: "email",
            recipient,
            status: result.success ? "sent" : "failed",
            sentAt: new Date().toISOString(),
            errorMessage: result.error,
          };
          dispatched.push(record);
          notificationHistory.push(record);
          result.success ? summary.sent++ : summary.failed++;
        }
        updateCooldown(event.ruleId, "email", cooldownMinutes);
        break;
      }

      case "sms": {
        if (!config.enableSms) {
          const record: NotificationRecord = {
            id: `notif_${nextNotifId++}`,
            eventId: event.eventId,
            ruleId: event.ruleId,
            channel: "sms",
            recipient: "all",
            status: "skipped_cooldown",
            sentAt: new Date().toISOString(),
            errorMessage: `SMS disabled for ${event.severity} severity`,
          };
          skipped.push(record);
          notificationHistory.push(record);
          break;
        }
        for (const recipient of event.recipients) {
          // For SMS, use phone numbers or fall back to a default
          const phone = recipient.includes("@") ? "+234800000000" : recipient;
          const result = await sendSmsNotification(phone, smsText);
          const record: NotificationRecord = {
            id: `notif_${nextNotifId++}`,
            eventId: event.eventId,
            ruleId: event.ruleId,
            channel: "sms",
            recipient: phone,
            status: result.success ? "sent" : "failed",
            sentAt: new Date().toISOString(),
            errorMessage: result.error,
          };
          dispatched.push(record);
          notificationHistory.push(record);
          result.success ? summary.sent++ : summary.failed++;
        }
        updateCooldown(event.ruleId, "sms", cooldownMinutes);
        break;
      }

      case "push": {
        const result = await sendPushNotification(
          event.recipients[0] || "admin",
          `${config.emailSubjectPrefix}: ${event.ruleName}`,
          event.message
        );
        const record: NotificationRecord = {
          id: `notif_${nextNotifId++}`,
          eventId: event.eventId,
          ruleId: event.ruleId,
          channel: "push",
          recipient: event.recipients[0] || "admin",
          status: result.success ? "sent" : "failed",
          sentAt: new Date().toISOString(),
        };
        dispatched.push(record);
        notificationHistory.push(record);
        result.success ? summary.sent++ : summary.failed++;
        updateCooldown(event.ruleId, "push", cooldownMinutes);
        break;
      }

      case "webhook": {
        const payload = {
          type: "threshold_alert",
          eventId: event.eventId,
          ruleId: event.ruleId,
          ruleName: event.ruleName,
          metric: event.metric,
          threshold: event.threshold,
          actualValue: event.actualValue,
          severity: event.severity,
          message: event.message,
          timestamp: event.createdAt,
        };
        const result = await sendWebhookNotification(
          "https://hooks.insureportal.com/alerts",
          payload
        );
        const record: NotificationRecord = {
          id: `notif_${nextNotifId++}`,
          eventId: event.eventId,
          ruleId: event.ruleId,
          channel: "webhook",
          recipient: "https://hooks.insureportal.com/alerts",
          status: result.success ? "sent" : "failed",
          sentAt: new Date().toISOString(),
        };
        dispatched.push(record);
        notificationHistory.push(record);
        result.success ? summary.sent++ : summary.failed++;
        updateCooldown(event.ruleId, "webhook", cooldownMinutes);
        break;
      }

      case "in-app": {
        // In-app notifications are handled by the WebSocket realtime system
        const record: NotificationRecord = {
          id: `notif_${nextNotifId++}`,
          eventId: event.eventId,
          ruleId: event.ruleId,
          channel: "in-app",
          recipient: "all",
          status: "sent",
          sentAt: new Date().toISOString(),
        };
        dispatched.push(record);
        notificationHistory.push(record);
        summary.sent++;
        updateCooldown(event.ruleId, "in-app", cooldownMinutes);
        break;
      }
    }
  }

  return { dispatched, skipped, summary };
}

// ─── Notification History Query ─────────────────────────────────────────────
export function getNotificationHistory(options?: {
  ruleId?: string;
  channel?: Channel;
  status?: string;
  limit?: number;
}): NotificationRecord[] {
  let records = [...notificationHistory];
  if (options?.ruleId)
    records = records.filter(r => r.ruleId === options.ruleId);
  if (options?.channel)
    records = records.filter(r => r.channel === options.channel);
  if (options?.status)
    records = records.filter(r => r.status === options.status);
  records.sort(
    (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()
  );
  return records.slice(0, options?.limit ?? 100);
}

// ─── Cooldown Status Query ──────────────────────────────────────────────────
export function getCooldownStatus(): Array<
  CooldownEntry & { remainingMs: number; isActive: boolean }
> {
  return cooldowns.map(c => {
    const elapsed = Date.now() - c.lastSentAt;
    const remaining = Math.max(0, c.cooldownMs - elapsed);
    return { ...c, remainingMs: remaining, isActive: remaining > 0 };
  });
}

// ─── Clear Expired Cooldowns ────────────────────────────────────────────────
export function clearExpiredCooldowns(): number {
  const before = cooldowns.length;
  const now = Date.now();
  for (let i = cooldowns.length - 1; i >= 0; i--) {
    if (now - cooldowns[i].lastSentAt > cooldowns[i].cooldownMs) {
      cooldowns.splice(i, 1);
    }
  }
  return before - cooldowns.length;
}

// ─── Export for testing ─────────────────────────────────────────────────────
export {
  buildBreachEmailHtml,
  buildBreachEmailText,
  buildBreachSmsText,
  isCooldownActive,
  isQuietHours,
  SEVERITY_CONFIG,
  QUIET_HOURS,
};
export type {
  BreachEvent,
  NotificationRecord,
  CooldownEntry,
  Severity,
  Channel,
};
