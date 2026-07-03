/**
 * Sprint 93 — Security Alert Notification Service
 *
 * Wires ransomware mitigation alerts, bulk-op limit triggers, and other
 * critical security events to the notifyOwner helper (Manus push notification)
 * plus email and SMS delivery channels.
 *
 * Design:
 * - Listens for alert lifecycle changes (new alert, escalation, resolution)
 * - Routes to appropriate channels based on severity + admin preferences
 * - Maintains delivery history for audit compliance
 * - Supports configurable quiet hours and escalation chains
 */

import { notifyOwner } from "../_core/notification";
import { logger } from './_core/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AlertSeverity = "critical" | "high" | "medium" | "low" | "info";
export type AlertCategory =
  | "ransomware"
  | "bulk_operation"
  | "file_integrity"
  | "exfiltration"
  | "brute_force"
  | "canary_trigger"
  | "ddos"
  | "deepfake"
  | "unauthorized_access";

export type DeliveryChannel = "push" | "email" | "sms" | "webhook" | "slack";
export type DeliveryStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "failed"
  | "bounced";

export interface SecurityAlertEvent {
  alertId: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  description: string;
  sourceIp?: string;
  affectedResource?: string;
  actorId?: string;
  actorName?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface NotificationPreference {
  adminId: string;
  adminName: string;
  adminEmail: string;
  adminPhone?: string;
  channels: {
    push: boolean;
    email: boolean;
    sms: boolean;
    webhook: boolean;
    slack: boolean;
  };
  severityThreshold: AlertSeverity;
  quietHours?: {
    enabled: boolean;
    startHour: number; // 0-23 UTC
    endHour: number;
    overrideForCritical: boolean;
  };
  categories: AlertCategory[];
  webhookUrl?: string;
  slackWebhookUrl?: string;
}

export interface DeliveryRecord {
  id: string;
  alertId: string;
  channel: DeliveryChannel;
  recipientId: string;
  recipientAddress: string;
  status: DeliveryStatus;
  sentAt: number;
  deliveredAt?: number;
  failureReason?: string;
  retryCount: number;
  messagePreview: string;
}

export interface EscalationRule {
  id: string;
  name: string;
  triggerAfterMinutes: number;
  fromSeverity: AlertSeverity;
  escalateToSeverity: AlertSeverity;
  notifyAdditionalRecipients: string[];
  enabled: boolean;
}

// ─── Severity Ordering ───────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function meetsThreshold(
  alertSeverity: AlertSeverity,
  threshold: AlertSeverity
): boolean {
  return SEVERITY_ORDER[alertSeverity] >= SEVERITY_ORDER[threshold];
}

// ─── In-Memory State (production: PostgreSQL + Redis pub/sub) ────────────────

const adminPreferences = new Map<string, NotificationPreference>();
const deliveryHistory: DeliveryRecord[] = [];
const escalationRules: EscalationRule[] = [];
const pendingEscalations = new Map<string, NodeJS.Timeout>();

// ─── Seed Default Admin Preferences ──────────────────────────────────────────

function seedDefaults() {
  if (adminPreferences.size > 0) return;

  adminPreferences.set("admin-001", {
    adminId: "admin-001",
    adminName: "System Administrator",
    adminEmail: "admin@pos-shell.ng",
    adminPhone: "+2348012345678",
    channels: {
      push: true,
      email: true,
      sms: true,
      webhook: false,
      slack: false,
    },
    severityThreshold: "medium",
    quietHours: {
      enabled: true,
      startHour: 23,
      endHour: 6,
      overrideForCritical: true,
    },
    categories: [
      "ransomware",
      "bulk_operation",
      "file_integrity",
      "exfiltration",
      "brute_force",
      "canary_trigger",
      "ddos",
      "deepfake",
      "unauthorized_access",
    ],
  });

  adminPreferences.set("admin-002", {
    adminId: "admin-002",
    adminName: "Security Officer",
    adminEmail: "security@pos-shell.ng",
    adminPhone: "+2348098765432",
    channels: {
      push: true,
      email: true,
      sms: false,
      webhook: true,
      slack: true,
    },
    severityThreshold: "high",
    quietHours: {
      enabled: false,
      startHour: 0,
      endHour: 0,
      overrideForCritical: true,
    },
    categories: ["ransomware", "exfiltration", "deepfake", "canary_trigger"],
    webhookUrl: "https://hooks.pos-shell.ng/security-alerts",
    slackWebhookUrl: "https://hooks.slack.com/services/T00/B00/xxx",
  });

  // Default escalation rules
  escalationRules.push(
    {
      id: "esc-001",
      name: "Critical unacknowledged → SMS blast",
      triggerAfterMinutes: 5,
      fromSeverity: "critical",
      escalateToSeverity: "critical",
      notifyAdditionalRecipients: ["admin-001", "admin-002"],
      enabled: true,
    },
    {
      id: "esc-002",
      name: "High unacknowledged → escalate to critical",
      triggerAfterMinutes: 15,
      fromSeverity: "high",
      escalateToSeverity: "critical",
      notifyAdditionalRecipients: ["admin-001"],
      enabled: true,
    },
    {
      id: "esc-003",
      name: "Medium unacknowledged → escalate to high",
      triggerAfterMinutes: 30,
      fromSeverity: "medium",
      escalateToSeverity: "high",
      notifyAdditionalRecipients: [],
      enabled: true,
    }
  );
}

// ─── Quiet Hours Check ───────────────────────────────────────────────────────

function isInQuietHours(pref: NotificationPreference): boolean {
  if (!pref.quietHours?.enabled) return false;
  const now = new Date();
  const hour = now.getUTCHours();
  const { startHour, endHour } = pref.quietHours;

  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  // Wraps midnight (e.g., 23:00 → 06:00)
  return hour >= startHour || hour < endHour;
}

// ─── Message Formatting ──────────────────────────────────────────────────────

function formatAlertTitle(event: SecurityAlertEvent): string {
  const severityEmoji: Record<AlertSeverity, string> = {
    critical: "🚨",
    high: "⚠️",
    medium: "🔶",
    low: "🔵",
    info: "ℹ️",
  };
  return `${severityEmoji[event.severity]} [${event.severity.toUpperCase()}] ${event.title}`;
}

function formatAlertContent(event: SecurityAlertEvent): string {
  const lines = [
    `Category: ${event.category.replace(/_/g, " ").toUpperCase()}`,
    `Description: ${event.description}`,
    `Time: ${new Date(event.timestamp).toISOString()}`,
  ];
  if (event.sourceIp) lines.push(`Source IP: ${event.sourceIp}`);
  if (event.affectedResource)
    lines.push(`Affected Resource: ${event.affectedResource}`);
  if (event.actorName)
    lines.push(`Actor: ${event.actorName} (${event.actorId})`);
  lines.push(`Alert ID: ${event.alertId}`);
  return lines.join("\n");
}

function formatSmsMessage(event: SecurityAlertEvent): string {
  return `[POS-SHELL ${event.severity.toUpperCase()}] ${event.title} | ${event.category} | ID:${event.alertId.slice(0, 8)}`;
}

// ─── Delivery Functions ──────────────────────────────────────────────────────

function createDeliveryRecord(
  alertId: string,
  channel: DeliveryChannel,
  recipientId: string,
  recipientAddress: string,
  messagePreview: string
): DeliveryRecord {
  const record: DeliveryRecord = {
    id: `del-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    alertId,
    channel,
    recipientId,
    recipientAddress,
    status: "pending",
    sentAt: Date.now(),
    retryCount: 0,
    messagePreview: messagePreview.slice(0, 200),
  };
  deliveryHistory.push(record);
  return record;
}

async function deliverViaPush(
  event: SecurityAlertEvent,
  pref: NotificationPreference
): Promise<DeliveryRecord> {
  const record = createDeliveryRecord(
    event.alertId,
    "push",
    pref.adminId,
    pref.adminEmail,
    formatAlertTitle(event)
  );

  try {
    const success = await notifyOwner({
      title: formatAlertTitle(event),
      content: formatAlertContent(event),
    });
    record.status = success ? "delivered" : "failed";
    if (!success) record.failureReason = "Notification service returned false";
    record.deliveredAt = success ? Date.now() : undefined;
  } catch (err: any) {
    record.status = "failed";
    record.failureReason = err?.message || "Push delivery exception";
  }

  return record;
}

async function deliverViaEmail(
  event: SecurityAlertEvent,
  pref: NotificationPreference
): Promise<DeliveryRecord> {
  const record = createDeliveryRecord(
    event.alertId,
    "email",
    pref.adminId,
    pref.adminEmail,
    formatAlertTitle(event)
  );

  try {
    // Production: integrate with SendGrid/SES/Mailgun
    // For now, use the Manus notification service as email proxy
    const success = await notifyOwner({
      title: `[EMAIL] ${formatAlertTitle(event)}`,
      content: [
        `To: ${pref.adminEmail}`,
        `Subject: Security Alert - ${event.title}`,
        "",
        formatAlertContent(event),
        "",
        "---",
        "This is an automated security alert from POS Shell Platform.",
        "To manage your notification preferences, visit the Security Alert Preferences page.",
      ].join("\n"),
    });
    record.status = success ? "delivered" : "failed";
    if (!success)
      record.failureReason = "Email delivery service returned false";
    record.deliveredAt = success ? Date.now() : undefined;
  } catch (err: any) {
    record.status = "failed";
    record.failureReason = err?.message || "Email delivery exception";
  }

  return record;
}

async function deliverViaSms(
  event: SecurityAlertEvent,
  pref: NotificationPreference
): Promise<DeliveryRecord> {
  const record = createDeliveryRecord(
    event.alertId,
    "sms",
    pref.adminId,
    pref.adminPhone || "no-phone",
    formatSmsMessage(event)
  );

  if (!pref.adminPhone) {
    record.status = "failed";
    record.failureReason = "No phone number configured";
    return record;
  }

  try {
    // Production: integrate with Twilio/Africa's Talking/Termii
    // For now, log and mark as sent (SMS gateway not yet deployed)
    const success = await notifyOwner({
      title: `[SMS] ${formatAlertTitle(event)}`,
      content: [
        `To: ${pref.adminPhone}`,
        `Message: ${formatSmsMessage(event)}`,
        "",
        "Note: SMS delivery via Termii/Africa's Talking gateway pending deployment.",
      ].join("\n"),
    });
    record.status = success ? "sent" : "failed";
    if (!success) record.failureReason = "SMS proxy delivery failed";
    record.deliveredAt = success ? Date.now() : undefined;
  } catch (err: any) {
    record.status = "failed";
    record.failureReason = err?.message || "SMS delivery exception";
  }

  return record;
}

async function deliverViaWebhook(
  event: SecurityAlertEvent,
  pref: NotificationPreference
): Promise<DeliveryRecord> {
  const record = createDeliveryRecord(
    event.alertId,
    "webhook",
    pref.adminId,
    pref.webhookUrl || "no-webhook-url",
    JSON.stringify({ alertId: event.alertId, severity: event.severity })
  );

  if (!pref.webhookUrl) {
    record.status = "failed";
    record.failureReason = "No webhook URL configured";
    return record;
  }

  try {
    const response = await fetch(pref.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Alert-Severity": event.severity,
        "X-Alert-Category": event.category,
      },
      body: JSON.stringify({
        alertId: event.alertId,
        severity: event.severity,
        category: event.category,
        title: event.title,
        description: event.description,
        sourceIp: event.sourceIp,
        affectedResource: event.affectedResource,
        timestamp: event.timestamp,
        metadata: event.metadata,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    record.status = response.ok ? "delivered" : "failed";
    if (!response.ok)
      record.failureReason = `Webhook returned ${response.status}`;
    record.deliveredAt = response.ok ? Date.now() : undefined;
  } catch (err: any) {
    record.status = "failed";
    record.failureReason = err?.message || "Webhook delivery exception";
  }

  return record;
}

async function deliverViaSlack(
  event: SecurityAlertEvent,
  pref: NotificationPreference
): Promise<DeliveryRecord> {
  const record = createDeliveryRecord(
    event.alertId,
    "slack",
    pref.adminId,
    pref.slackWebhookUrl || "no-slack-url",
    formatAlertTitle(event)
  );

  if (!pref.slackWebhookUrl) {
    record.status = "failed";
    record.failureReason = "No Slack webhook URL configured";
    return record;
  }

  try {
    const colorMap: Record<AlertSeverity, string> = {
      critical: "#FF0000",
      high: "#FF6600",
      medium: "#FFAA00",
      low: "#0066FF",
      info: "#999999",
    };

    const response = await fetch(pref.slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attachments: [
          {
            color: colorMap[event.severity],
            title: formatAlertTitle(event),
            text: formatAlertContent(event),
            footer: "POS Shell Security Alert System",
            ts: Math.floor(event.timestamp / 1000),
          },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    record.status = response.ok ? "delivered" : "failed";
    if (!response.ok)
      record.failureReason = `Slack returned ${response.status}`;
    record.deliveredAt = response.ok ? Date.now() : undefined;
  } catch (err: any) {
    record.status = "failed";
    record.failureReason = err?.message || "Slack delivery exception";
  }

  return record;
}

// ─── Core Dispatch Logic ─────────────────────────────────────────────────────

/**
 * Dispatches a security alert to all eligible administrators across all
 * configured channels, respecting severity thresholds, category filters,
 * and quiet hours.
 */
export async function dispatchSecurityAlert(
  event: SecurityAlertEvent
): Promise<{
  totalRecipients: number;
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  records: DeliveryRecord[];
}> {
  seedDefaults();

  const records: DeliveryRecord[] = [];
  let successCount = 0;
  let failCount = 0;

  const eligibleAdmins = Array.from(adminPreferences.values()).filter(pref => {
    // Check severity threshold
    if (!meetsThreshold(event.severity, pref.severityThreshold)) return false;
    // Check category subscription
    if (!pref.categories.includes(event.category)) return false;
    return true;
  });

  for (const pref of eligibleAdmins) {
    const inQuiet = isInQuietHours(pref);
    const isCritical = event.severity === "critical";
    const skipQuiet =
      inQuiet && !(pref.quietHours?.overrideForCritical && isCritical);

    if (skipQuiet) {
      // Log suppression for audit
      const suppressRecord = createDeliveryRecord(
        event.alertId,
        "push",
        pref.adminId,
        pref.adminEmail,
        `[SUPPRESSED - QUIET HOURS] ${formatAlertTitle(event)}`
      );
      suppressRecord.status = "failed";
      suppressRecord.failureReason = "Suppressed during quiet hours";
      records.push(suppressRecord);
      continue;
    }

    // Deliver to each enabled channel
    const deliveryPromises: Promise<DeliveryRecord>[] = [];

    if (pref.channels.push) {
      deliveryPromises.push(deliverViaPush(event, pref));
    }
    if (pref.channels.email) {
      deliveryPromises.push(deliverViaEmail(event, pref));
    }
    if (pref.channels.sms && (isCritical || event.severity === "high")) {
      // SMS only for critical/high to avoid cost overruns
      deliveryPromises.push(deliverViaSms(event, pref));
    }
    if (pref.channels.webhook) {
      deliveryPromises.push(deliverViaWebhook(event, pref));
    }
    if (pref.channels.slack) {
      deliveryPromises.push(deliverViaSlack(event, pref));
    }

    const results = await Promise.allSettled(deliveryPromises);
    for (const result of results) {
      if (result.status === "fulfilled") {
        records.push(result.value);
        if (
          result.value.status === "delivered" ||
          result.value.status === "sent"
        ) {
          successCount++;
        } else {
          failCount++;
        }
      } else {
        failCount++;
      }
    }
  }

  // Start escalation timer for critical/high alerts
  if (event.severity === "critical" || event.severity === "high") {
    startEscalationTimer(event);
  }

  logger.info(
    `[SecurityAlertNotifier] Alert ${event.alertId} dispatched: ` +
      `${eligibleAdmins.length} recipients, ${successCount} delivered, ${failCount} failed`
  );

  return {
    totalRecipients: eligibleAdmins.length,
    totalDeliveries: records.length,
    successfulDeliveries: successCount,
    failedDeliveries: failCount,
    records,
  };
}

// ─── Escalation Timer ────────────────────────────────────────────────────────

function startEscalationTimer(event: SecurityAlertEvent): void {
  const applicableRules = escalationRules.filter(
    r => r.enabled && r.fromSeverity === event.severity
  );

  for (const rule of applicableRules) {
    const timer = setTimeout(
      async () => {
        logger.info(
          `[SecurityAlertNotifier] Escalation triggered: ${rule.name} for alert ${event.alertId}`
        );

        // Re-dispatch with escalated severity
        const escalatedEvent: SecurityAlertEvent = {
          ...event,
          severity: rule.escalateToSeverity,
          title: `[ESCALATED] ${event.title}`,
          description: `Auto-escalated from ${event.severity} to ${rule.escalateToSeverity} after ${rule.triggerAfterMinutes} minutes unacknowledged.\n\nOriginal: ${event.description}`,
          timestamp: Date.now(),
        };

        await dispatchSecurityAlert(escalatedEvent);
        pendingEscalations.delete(event.alertId);
      },
      rule.triggerAfterMinutes * 60 * 1000
    );

    pendingEscalations.set(event.alertId, timer);
  }
}

/**
 * Cancel escalation when an alert is acknowledged.
 */
export function cancelEscalation(alertId: string): boolean {
  const timer = pendingEscalations.get(alertId);
  if (timer) {
    clearTimeout(timer);
    pendingEscalations.delete(alertId);
    return true;
  }
  return false;
}

// ─── Preference Management ───────────────────────────────────────────────────

export function getAdminPreferences(): NotificationPreference[] {
  seedDefaults();
  return Array.from(adminPreferences.values());
}

export function getAdminPreference(
  adminId: string
): NotificationPreference | undefined {
  seedDefaults();
  return adminPreferences.get(adminId);
}

export function updateAdminPreference(
  adminId: string,
  updates: Partial<Omit<NotificationPreference, "adminId">>
): NotificationPreference | null {
  seedDefaults();
  const existing = adminPreferences.get(adminId);
  if (!existing) return null;

  const updated: NotificationPreference = {
    ...existing,
    ...updates,
    adminId, // Prevent overwriting adminId
    channels: updates.channels
      ? { ...existing.channels, ...updates.channels }
      : existing.channels,
    quietHours:
      updates.quietHours !== undefined
        ? updates.quietHours
        : existing.quietHours,
  };

  adminPreferences.set(adminId, updated);
  return updated;
}

export function addAdminPreference(pref: NotificationPreference): void {
  seedDefaults();
  adminPreferences.set(pref.adminId, pref);
}

// ─── Delivery History ────────────────────────────────────────────────────────

export function getDeliveryHistory(options?: {
  alertId?: string;
  adminId?: string;
  channel?: DeliveryChannel;
  status?: DeliveryStatus;
  limit?: number;
  offset?: number;
}): { records: DeliveryRecord[]; total: number } {
  let filtered = [...deliveryHistory];

  if (options?.alertId) {
    filtered = filtered.filter(r => r.alertId === options.alertId);
  }
  if (options?.adminId) {
    filtered = filtered.filter(r => r.recipientId === options.adminId);
  }
  if (options?.channel) {
    filtered = filtered.filter(r => r.channel === options.channel);
  }
  if (options?.status) {
    filtered = filtered.filter(r => r.status === options.status);
  }

  // Sort by most recent first
  filtered.sort((a, b) => b.sentAt - a.sentAt);

  const total = filtered.length;
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  return {
    records: filtered.slice(offset, offset + limit),
    total,
  };
}

export function getDeliveryStats(): {
  totalSent: number;
  totalDelivered: number;
  totalFailed: number;
  byChannel: Record<
    DeliveryChannel,
    { sent: number; delivered: number; failed: number }
  >;
  last24h: { sent: number; delivered: number; failed: number };
} {
  const channels: DeliveryChannel[] = [
    "push",
    "email",
    "sms",
    "webhook",
    "slack",
  ];
  const byChannel = {} as Record<
    DeliveryChannel,
    { sent: number; delivered: number; failed: number }
  >;
  const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;

  let totalSent = 0;
  let totalDelivered = 0;
  let totalFailed = 0;
  const last24h = { sent: 0, delivered: 0, failed: 0 };

  for (const ch of channels) {
    byChannel[ch] = { sent: 0, delivered: 0, failed: 0 };
  }

  for (const record of deliveryHistory) {
    totalSent++;
    byChannel[record.channel].sent++;

    if (record.status === "delivered" || record.status === "sent") {
      totalDelivered++;
      byChannel[record.channel].delivered++;
    } else if (record.status === "failed" || record.status === "bounced") {
      totalFailed++;
      byChannel[record.channel].failed++;
    }

    if (record.sentAt >= cutoff24h) {
      last24h.sent++;
      if (record.status === "delivered" || record.status === "sent")
        last24h.delivered++;
      if (record.status === "failed" || record.status === "bounced")
        last24h.failed++;
    }
  }

  return { totalSent, totalDelivered, totalFailed, byChannel, last24h };
}

// ─── Escalation Rule Management ──────────────────────────────────────────────

export function getEscalationRules(): EscalationRule[] {
  seedDefaults();
  return [...escalationRules];
}

export function updateEscalationRule(
  ruleId: string,
  updates: Partial<Omit<EscalationRule, "id">>
): EscalationRule | null {
  seedDefaults();
  const idx = escalationRules.findIndex(r => r.id === ruleId);
  if (idx === -1) return null;

  escalationRules[idx] = { ...escalationRules[idx], ...updates, id: ruleId };
  return escalationRules[idx];
}

// ─── Test Alert ──────────────────────────────────────────────────────────────

export async function sendTestAlert(
  adminId: string,
  severity: AlertSeverity = "info"
): Promise<{ success: boolean; deliveryCount: number }> {
  seedDefaults();

  const testEvent: SecurityAlertEvent = {
    alertId: `test-${Date.now()}`,
    severity,
    category: "ransomware",
    title: "Test Security Alert",
    description:
      "This is a test alert to verify your notification preferences are configured correctly. No action is required.",
    timestamp: Date.now(),
  };

  const result = await dispatchSecurityAlert(testEvent);
  return {
    success: result.successfulDeliveries > 0,
    deliveryCount: result.successfulDeliveries,
  };
}
