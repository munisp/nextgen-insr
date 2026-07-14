// TypeScript enabled — Sprint 96 security audit
/**
 * Sprint 22: Weekly Report Enhancements
 *
 * 1. Email Delivery — HTML-formatted weekly report emails with distribution list
 * 2. Trend Comparison — Week-over-week deltas with arrows and percentages
 * 3. PDF Export — Server-side PDF generation with branded layout
 */

import { sendEmail, sendBatchEmail, type EmailMessage } from "./emailService";
import type {
  WeeklyReport,
  WeeklyReportMetrics,
} from "./weeklyReportGenerator";
import { getReportHistory } from "./weeklyReportGenerator";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface TrendDelta {
  current: number;
  previous: number;
  delta: number; // absolute change
  deltaPercent: number; // percentage change
  direction: "up" | "down" | "flat";
  isPositive: boolean; // whether the direction is good (e.g., up for tx count, down for errors)
}

export interface WeeklyReportTrends {
  transactionCount: TrendDelta;
  transactionValue: TrendDelta;
  successRate: TrendDelta;
  activeUsers: TrendDelta;
  newUsers: TrendDelta;
  apiLatencyP50: TrendDelta;
  apiLatencyP99: TrendDelta;
  errorRate: TrendDelta;
  criticalErrors: TrendDelta;
  uptimePercent: TrendDelta;
  securityEvents: TrendDelta;
  healthScore: TrendDelta;
}

export interface EmailDistributionConfig {
  recipients: Array<{ email: string; name: string; role: string }>;
  enabled: boolean;
  includeFullReport: boolean;
  includePdfAttachment: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// In-Memory Store
// ═══════════════════════════════════════════════════════════════════════════════

let emailConfig: EmailDistributionConfig = {
  recipients: [
    { email: "admin@insureportal.io", name: "Platform Admin", role: "admin" },
  ],
  enabled: true,
  includeFullReport: true,
  includePdfAttachment: false,
};

// ═══════════════════════════════════════════════════════════════════════════════
// 1. TREND COMPARISON
// ═══════════════════════════════════════════════════════════════════════════════

function calcDelta(
  current: number,
  previous: number,
  higherIsBetter: boolean
): TrendDelta {
  const delta = current - previous;
  const deltaPercent =
    previous === 0
      ? current > 0
        ? 100
        : 0
      : +((delta / previous) * 100).toFixed(1);
  const direction: "up" | "down" | "flat" =
    Math.abs(deltaPercent) < 0.5 ? "flat" : delta > 0 ? "up" : "down";
  const isPositive =
    direction === "flat"
      ? true
      : higherIsBetter
        ? direction === "up"
        : direction === "down";

  return { current, previous, delta, deltaPercent, direction, isPositive };
}

/**
 * Calculate week-over-week trends by comparing the current report with the previous one.
 */
export function calculateTrends(
  report: WeeklyReport
): WeeklyReportTrends | null {
  const history = getReportHistory();
  const currentIdx = history.findIndex(r => r.id === report.id);

  // Need a previous report to compare against
  const previousReport = currentIdx >= 0 ? history[currentIdx + 1] : history[1];
  if (!previousReport) return null;

  const curr = report.metrics;
  const prev = previousReport.metrics;

  return {
    transactionCount: calcDelta(
      curr.transactions.totalCount,
      prev.transactions.totalCount,
      true
    ),
    transactionValue: calcDelta(
      curr.transactions.totalValue,
      prev.transactions.totalValue,
      true
    ),
    successRate: calcDelta(
      curr.transactions.successRate,
      prev.transactions.successRate,
      true
    ),
    activeUsers: calcDelta(
      curr.userActivity.totalActiveUsers,
      prev.userActivity.totalActiveUsers,
      true
    ),
    newUsers: calcDelta(
      curr.userActivity.newUsers,
      prev.userActivity.newUsers,
      true
    ),
    apiLatencyP50: calcDelta(
      curr.apiPerformance.p50Ms,
      prev.apiPerformance.p50Ms,
      false
    ),
    apiLatencyP99: calcDelta(
      curr.apiPerformance.p99Ms,
      prev.apiPerformance.p99Ms,
      false
    ),
    errorRate: calcDelta(curr.errors.errorRate, prev.errors.errorRate, false),
    criticalErrors: calcDelta(
      curr.errors.criticalErrors,
      prev.errors.criticalErrors,
      false
    ),
    uptimePercent: calcDelta(
      curr.system.uptimePercent,
      prev.system.uptimePercent,
      true
    ),
    securityEvents: calcDelta(
      curr.security.suspiciousActivities + curr.security.accountLockouts,
      prev.security.suspiciousActivities + prev.security.accountLockouts,
      false
    ),
    healthScore: calcDelta(report.score, previousReport.score, true),
  };
}

/**
 * Format a trend delta as a human-readable string with arrow.
 */
export function formatTrendDelta(td: TrendDelta): string {
  if (td.direction === "flat") return "→ No change";
  const arrow = td.direction === "up" ? "↑" : "↓";
  const sign = td.delta > 0 ? "+" : "";
  const color = td.isPositive ? "green" : "red";
  return `${arrow} ${sign}${td.deltaPercent}% (${color})`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. EMAIL DELIVERY
// ═══════════════════════════════════════════════════════════════════════════════

const BRAND_COLOR = "#1d4ed8";
const BRAND_BG = "#f8fafc";

function trendArrowHtml(td: TrendDelta): string {
  if (td.direction === "flat") {
    return `<span style="color:#6b7280;">→ 0%</span>`;
  }
  const arrow = td.direction === "up" ? "▲" : "▼";
  const color = td.isPositive ? "#059669" : "#dc2626";
  const sign = td.delta > 0 ? "+" : "";
  return `<span style="color:${color};font-weight:600;">${arrow} ${sign}${td.deltaPercent}%</span>`;
}

function formatCurrency(amount: number): string {
  return `₦${amount.toLocaleString("en-NG", { minimumFractionDigits: 0 })}`;
}

function buildMetricRow(
  label: string,
  value: string,
  trend?: TrendDelta
): string {
  const trendCell = trend
    ? `<td style="padding:8px 12px;text-align:right;font-size:13px;">${trendArrowHtml(trend)}</td>`
    : `<td style="padding:8px 12px;"></td>`;
  return `<tr>
    <td style="padding:8px 12px;color:#6b7280;font-size:14px;">${label}</td>
    <td style="padding:8px 12px;font-weight:600;text-align:right;font-size:14px;">${value}</td>
    ${trendCell}
  </tr>`;
}

function buildSectionHeader(title: string, icon: string): string {
  return `<tr><td colspan="3" style="padding:16px 12px 8px;font-weight:700;font-size:15px;color:#1e293b;border-bottom:2px solid ${BRAND_COLOR};">${icon} ${title}</td></tr>`;
}

/**
 * Build a comprehensive HTML email for the weekly report.
 */
export function buildWeeklyReportEmail(
  report: WeeklyReport,
  trends: WeeklyReportTrends | null
): EmailMessage {
  const m = report.metrics;
  const scoreColor =
    report.score >= 90 ? "#059669" : report.score >= 70 ? "#d97706" : "#dc2626";
  const scoreLabel =
    report.score >= 90
      ? "Excellent"
      : report.score >= 70
        ? "Good"
        : "Needs Attention";

  // Score badge
  const scoreBadge = `<div style="text-align:center;margin:16px 0;">
    <div style="display:inline-block;background:${scoreColor};color:#fff;border-radius:50%;width:80px;height:80px;line-height:80px;font-size:28px;font-weight:700;">${report.score}</div>
    <p style="margin:8px 0 0;font-size:16px;font-weight:600;color:${scoreColor};">${scoreLabel}</p>
    <p style="margin:4px 0 0;color:#6b7280;font-size:13px;">${m.period.start} → ${m.period.end}</p>
    ${trends ? `<p style="margin:4px 0 0;font-size:13px;">${trendArrowHtml(trends.healthScore)} vs last week</p>` : ""}
  </div>`;

  // Metrics table
  let table = `<table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;">`;

  // Transactions
  table += buildSectionHeader("Transactions", "💰");
  table += buildMetricRow(
    "Total Count",
    m.transactions.totalCount.toLocaleString(),
    trends?.transactionCount
  );
  table += buildMetricRow(
    "Total Value",
    formatCurrency(m.transactions.totalValue),
    trends?.transactionValue
  );
  table += buildMetricRow(
    "Success Rate",
    `${m.transactions.successRate}%`,
    trends?.successRate
  );
  table += buildMetricRow("Avg/Day", String(m.transactions.avgPerDay));
  table += buildMetricRow(
    "Peak Day",
    `${m.transactions.peakDay} (${m.transactions.peakDayCount})`
  );

  // User Activity
  table += buildSectionHeader("User Activity", "👥");
  table += buildMetricRow(
    "Active Users",
    String(m.userActivity.totalActiveUsers),
    trends?.activeUsers
  );
  table += buildMetricRow(
    "New Users",
    String(m.userActivity.newUsers),
    trends?.newUsers
  );
  table += buildMetricRow("Sessions", String(m.userActivity.totalSessions));
  table += buildMetricRow(
    "Returning Rate",
    `${m.userActivity.returningUserRate}%`
  );

  // API Performance
  table += buildSectionHeader("API Performance", "⚡");
  table += buildMetricRow(
    "Total Requests",
    m.apiPerformance.totalRequests.toLocaleString()
  );
  table += buildMetricRow(
    "p50 Latency",
    `${m.apiPerformance.p50Ms}ms`,
    trends?.apiLatencyP50
  );
  table += buildMetricRow(
    "p99 Latency",
    `${m.apiPerformance.p99Ms}ms`,
    trends?.apiLatencyP99
  );
  table += buildMetricRow(
    "Req/min",
    String(m.apiPerformance.requestsPerMinute)
  );

  // Errors
  table += buildSectionHeader("Errors", "🔴");
  table += buildMetricRow(
    "Error Rate",
    `${m.errors.errorRate}%`,
    trends?.errorRate
  );
  table += buildMetricRow(
    "Critical Errors",
    String(m.errors.criticalErrors),
    trends?.criticalErrors
  );
  table += buildMetricRow("Resolved", String(m.errors.resolvedErrors));

  // Security
  table += buildSectionHeader("Security", "🛡️");
  table += buildMetricRow("Blocked IPs", String(m.security.blockedIPs));
  table += buildMetricRow("Failed Logins", String(m.security.failedLogins));
  table += buildMetricRow("Rate Limit Hits", String(m.security.rateLimitHits));
  table += buildMetricRow(
    "Suspicious Activities",
    String(m.security.suspiciousActivities),
    trends?.securityEvents
  );

  // System
  table += buildSectionHeader("System", "🖥️");
  table += buildMetricRow(
    "Uptime",
    `${m.system.uptimePercent}%`,
    trends?.uptimePercent
  );
  table += buildMetricRow("DB Latency", `${m.system.dbLatencyAvgMs}ms`);
  table += buildMetricRow("Memory", `${m.system.memoryUsageMB}MB`);
  table += buildMetricRow("CPU", `${m.system.cpuUsagePercent}%`);

  table += `</table>`;

  // Alerts section
  let alertsHtml = "";
  if (report.alerts.length > 0) {
    alertsHtml = `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;font-weight:700;color:#dc2626;">⚠️ Alerts (${report.alerts.length})</p>
      <ul style="margin:0;padding-left:20px;">
        ${report.alerts.map(a => `<li style="color:#7f1d1d;font-size:13px;margin:4px 0;">${a}</li>`).join("")}
      </ul>
    </div>`;
  }

  // Recommendations section
  let recsHtml = "";
  if (report.recommendations.length > 0) {
    recsHtml = `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;font-weight:700;color:#059669;">💡 Recommendations</p>
      <ul style="margin:0;padding-left:20px;">
        ${report.recommendations.map(r => `<li style="color:#14532d;font-size:13px;margin:4px 0;">${r}</li>`).join("")}
      </ul>
    </div>`;
  }

  const body = `${scoreBadge}${table}${alertsHtml}${recsHtml}
    <p style="text-align:center;margin:20px 0 0;color:#6b7280;font-size:12px;">
      Generated at ${new Date(report.generatedAt).toLocaleString("en-NG")} UTC
    </p>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:${BRAND_COLOR};padding:20px 24px;">
      <h1 style="color:#fff;margin:0;font-size:20px;">InsurePortal POS — Weekly Health Report</h1>
      <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">${m.period.start} → ${m.period.end}</p>
    </div>
    <div style="padding:24px;">${body}</div>
    <div style="padding:16px 24px;background:#f1f5f9;border-top:1px solid #e2e8f0;">
      <p style="margin:0;color:#94a3b8;font-size:11px;">This is an automated weekly report from InsurePortal POS. Do not reply to this email.</p>
      <p style="margin:4px 0 0;color:#94a3b8;font-size:11px;">&copy; ${new Date().getFullYear()} InsurePortal Financial Technologies</p>
    </div>
  </div>
</body>
</html>`;

  return {
    to: emailConfig.recipients.map(r => r.email).join(","),
    subject: `Weekly Health Report — ${scoreLabel}: ${report.score}/100 (${m.period.start} → ${m.period.end})`,
    html,
    text: report.summary,
    category: "weekly_report",
    tags: ["weekly-report", m.period.start],
  };
}

/**
 * Send the weekly report email to all recipients in the distribution list.
 */
export async function sendWeeklyReportEmail(
  report: WeeklyReport
): Promise<{ sent: number; failed: number; recipients: string[] }> {
  if (!emailConfig.enabled || emailConfig.recipients.length === 0) {
    return { sent: 0, failed: 0, recipients: [] };
  }

  const trends = calculateTrends(report);
  const emailMsg = buildWeeklyReportEmail(report, trends);

  const recipientEmails = emailConfig.recipients.map(r => r.email);

  if (recipientEmails.length === 1) {
    emailMsg.to = recipientEmails[0];
    const result = await sendEmail(emailMsg);
    return {
      sent: result.success ? 1 : 0,
      failed: result.success ? 0 : 1,
      recipients: recipientEmails,
    };
  }

  // Batch send
  const { to: _to, ...msgWithoutTo } = emailMsg;
  const batchResult = await sendBatchEmail(recipientEmails, msgWithoutTo);
  return {
    sent: batchResult.sent,
    failed: batchResult.failed,
    recipients: recipientEmails,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. PDF EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a PDF-ready HTML string for the weekly report.
 * This produces a print-optimized layout that can be converted to PDF
 * using a headless browser or html-to-pdf library.
 */
export function generateReportPdfHtml(
  report: WeeklyReport,
  trends: WeeklyReportTrends | null
): string {
  const m = report.metrics;
  const scoreColor =
    report.score >= 90 ? "#059669" : report.score >= 70 ? "#d97706" : "#dc2626";
  const scoreLabel =
    report.score >= 90
      ? "Excellent"
      : report.score >= 70
        ? "Good"
        : "Needs Attention";

  const trendCell = (td?: TrendDelta): string => {
    if (!td || td.direction === "flat")
      return `<td style="padding:6px 8px;color:#6b7280;text-align:right;">—</td>`;
    const arrow = td.direction === "up" ? "▲" : "▼";
    const color = td.isPositive ? "#059669" : "#dc2626";
    const sign = td.delta > 0 ? "+" : "";
    return `<td style="padding:6px 8px;color:${color};font-weight:600;text-align:right;">${arrow} ${sign}${td.deltaPercent}%</td>`;
  };

  const metricRow = (
    label: string,
    value: string,
    trend?: TrendDelta
  ): string =>
    `<tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:6px 8px;color:#374151;font-size:12px;">${label}</td>
      <td style="padding:6px 8px;font-weight:600;text-align:right;font-size:12px;">${value}</td>
      ${trendCell(trend)}
    </tr>`;

  const sectionTitle = (title: string): string =>
    `<tr><td colspan="3" style="padding:12px 8px 6px;font-weight:700;font-size:13px;color:#1e293b;border-bottom:2px solid ${BRAND_COLOR};">${title}</td></tr>`;

  let table = `<table style="width:100%;border-collapse:collapse;font-size:12px;">`;
  table += `<thead><tr style="background:#f1f5f9;">
    <th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280;">Metric</th>
    <th style="padding:6px 8px;text-align:right;font-size:11px;color:#6b7280;">Value</th>
    <th style="padding:6px 8px;text-align:right;font-size:11px;color:#6b7280;">vs Last Week</th>
  </tr></thead><tbody>`;

  table += sectionTitle("Transactions");
  table += metricRow(
    "Total Count",
    m.transactions.totalCount.toLocaleString(),
    trends?.transactionCount
  );
  table += metricRow(
    "Total Value",
    formatCurrency(m.transactions.totalValue),
    trends?.transactionValue
  );
  table += metricRow(
    "Success Rate",
    `${m.transactions.successRate}%`,
    trends?.successRate
  );
  table += metricRow("Avg/Day", String(m.transactions.avgPerDay));

  table += sectionTitle("User Activity");
  table += metricRow(
    "Active Users",
    String(m.userActivity.totalActiveUsers),
    trends?.activeUsers
  );
  table += metricRow(
    "New Users",
    String(m.userActivity.newUsers),
    trends?.newUsers
  );
  table += metricRow("Sessions", String(m.userActivity.totalSessions));
  table += metricRow("Returning Rate", `${m.userActivity.returningUserRate}%`);

  table += sectionTitle("API Performance");
  table += metricRow(
    "Total Requests",
    m.apiPerformance.totalRequests.toLocaleString()
  );
  table += metricRow(
    "p50 Latency",
    `${m.apiPerformance.p50Ms}ms`,
    trends?.apiLatencyP50
  );
  table += metricRow("p95 Latency", `${m.apiPerformance.p95Ms}ms`);
  table += metricRow(
    "p99 Latency",
    `${m.apiPerformance.p99Ms}ms`,
    trends?.apiLatencyP99
  );

  table += sectionTitle("Errors");
  table += metricRow("Error Rate", `${m.errors.errorRate}%`, trends?.errorRate);
  table += metricRow(
    "Critical Errors",
    String(m.errors.criticalErrors),
    trends?.criticalErrors
  );
  table += metricRow("Resolved", String(m.errors.resolvedErrors));

  table += sectionTitle("Security");
  table += metricRow("Blocked IPs", String(m.security.blockedIPs));
  table += metricRow("Failed Logins", String(m.security.failedLogins));
  table += metricRow("Rate Limit Hits", String(m.security.rateLimitHits));
  table += metricRow(
    "Suspicious",
    String(m.security.suspiciousActivities),
    trends?.securityEvents
  );

  table += sectionTitle("System");
  table += metricRow(
    "Uptime",
    `${m.system.uptimePercent}%`,
    trends?.uptimePercent
  );
  table += metricRow("DB Latency", `${m.system.dbLatencyAvgMs}ms`);
  table += metricRow("Memory", `${m.system.memoryUsageMB}MB`);
  table += metricRow("CPU", `${m.system.cpuUsagePercent}%`);

  table += `</tbody></table>`;

  // Alerts
  let alertsHtml = "";
  if (report.alerts.length > 0) {
    alertsHtml = `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px;margin:12px 0;">
      <p style="margin:0 0 6px;font-weight:700;color:#dc2626;font-size:13px;">Alerts (${report.alerts.length})</p>
      <ul style="margin:0;padding-left:16px;font-size:11px;">
        ${report.alerts.map(a => `<li style="color:#7f1d1d;margin:3px 0;">${a}</li>`).join("")}
      </ul>
    </div>`;
  }

  // Recommendations
  let recsHtml = "";
  if (report.recommendations.length > 0) {
    recsHtml = `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:12px;margin:12px 0;">
      <p style="margin:0 0 6px;font-weight:700;color:#059669;font-size:13px;">Recommendations</p>
      <ul style="margin:0;padding-left:16px;font-size:11px;">
        ${report.recommendations.map(r => `<li style="color:#14532d;margin:3px 0;">${r}</li>`).join("")}
      </ul>
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: A4; margin: 20mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; margin: 0; padding: 0; }
    .header { background: ${BRAND_COLOR}; color: #fff; padding: 24px; margin: -20mm -20mm 20px -20mm; }
    .header h1 { margin: 0; font-size: 22px; }
    .header p { margin: 4px 0 0; color: rgba(255,255,255,0.8); font-size: 13px; }
    .score-section { text-align: center; margin: 20px 0; }
    .score-circle { display: inline-block; width: 70px; height: 70px; line-height: 70px; border-radius: 50%; font-size: 26px; font-weight: 700; color: #fff; }
    .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <h1>InsurePortal POS — Weekly Health Report</h1>
    <p>${m.period.start} → ${m.period.end} | Generated: ${new Date(report.generatedAt).toLocaleString("en-NG")}</p>
  </div>

  <div class="score-section">
    <div class="score-circle" style="background:${scoreColor};">${report.score}</div>
    <p style="margin:8px 0 0;font-size:16px;font-weight:600;color:${scoreColor};">${scoreLabel}</p>
    ${trends ? `<p style="margin:4px 0 0;font-size:12px;color:#6b7280;">Health Score: ${trends.healthScore.direction === "up" ? "▲" : trends.healthScore.direction === "down" ? "▼" : "→"} ${trends.healthScore.deltaPercent}% vs last week</p>` : ""}
  </div>

  ${table}
  ${alertsHtml}
  ${recsHtml}

  <div class="footer">
    <p>&copy; ${new Date().getFullYear()} InsurePortal Financial Technologies | Confidential</p>
    <p>Report ID: ${report.id}</p>
  </div>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Distribution List Management
// ═══════════════════════════════════════════════════════════════════════════════

export function getEmailConfig(): EmailDistributionConfig {
  return { ...emailConfig, recipients: [...emailConfig.recipients] };
}

export function updateEmailConfig(
  updates: Partial<Omit<EmailDistributionConfig, "recipients">>
): EmailDistributionConfig {
  emailConfig = { ...emailConfig, ...updates };
  return getEmailConfig();
}

export function addRecipient(
  email: string,
  name: string,
  role: string
): EmailDistributionConfig {
  const exists = emailConfig.recipients.some(
    r => r.email.toLowerCase() === email.toLowerCase()
  );
  if (!exists) {
    emailConfig.recipients.push({ email, name, role });
  }
  return getEmailConfig();
}

export function removeRecipient(email: string): EmailDistributionConfig {
  emailConfig.recipients = emailConfig.recipients.filter(
    r => r.email.toLowerCase() !== email.toLowerCase()
  );
  return getEmailConfig();
}

export function listRecipients(): Array<{
  email: string;
  name: string;
  role: string;
}> {
  return [...emailConfig.recipients];
}
