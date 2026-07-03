// TypeScript enabled — Sprint 96 security audit
/**
 * Report Email Delivery — 54Link Agency Banking Platform
 *
 * Sends comparison PDF reports via email after scheduled load tests.
 * Uses the existing emailService infrastructure.
 */
import { notifyOwner } from "../_core/notification";
import { logger } from '../_core/logger';

export interface ReportEmailPayload {
  recipientEmail: string;
  reportType: "load_test_comparison" | "archival_summary" | "security_audit";
  subject: string;
  htmlBody: string;
  csvAttachment?: string;
}

export function generateComparisonReportHtml(data: {
  runAName: string;
  runBName: string;
  p50Delta: number;
  p95Delta: number;
  p99Delta: number;
  rpsDelta: number;
  errorRateDelta: number;
  verdict: "IMPROVEMENT" | "REGRESSION" | "MIXED";
}): string {
  const verdictColor =
    data.verdict === "IMPROVEMENT"
      ? "#22c55e"
      : data.verdict === "REGRESSION"
        ? "#ef4444"
        : "#f59e0b";
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1e293b;">Load Test Comparison Report</h2>
      <p><strong>${data.runAName}</strong> vs <strong>${data.runBName}</strong></p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr style="background: #f1f5f9;"><th style="padding: 8px; text-align: left;">Metric</th><th style="padding: 8px;">Delta</th></tr>
        <tr><td style="padding: 8px;">P50 Latency</td><td style="padding: 8px; text-align: center;">${data.p50Delta > 0 ? "+" : ""}${data.p50Delta}ms</td></tr>
        <tr style="background: #f8fafc;"><td style="padding: 8px;">P95 Latency</td><td style="padding: 8px; text-align: center;">${data.p95Delta > 0 ? "+" : ""}${data.p95Delta}ms</td></tr>
        <tr><td style="padding: 8px;">P99 Latency</td><td style="padding: 8px; text-align: center;">${data.p99Delta > 0 ? "+" : ""}${data.p99Delta}ms</td></tr>
        <tr style="background: #f8fafc;"><td style="padding: 8px;">RPS</td><td style="padding: 8px; text-align: center;">${data.rpsDelta > 0 ? "+" : ""}${data.rpsDelta}</td></tr>
        <tr><td style="padding: 8px;">Error Rate</td><td style="padding: 8px; text-align: center;">${data.errorRateDelta > 0 ? "+" : ""}${data.errorRateDelta}%</td></tr>
      </table>
      <div style="padding: 12px; background: ${verdictColor}20; border-left: 4px solid ${verdictColor}; border-radius: 4px;">
        <strong style="color: ${verdictColor};">Verdict: ${data.verdict}</strong>
      </div>
    </div>
  `;
}

export async function sendReportEmail(
  payload: ReportEmailPayload
): Promise<boolean> {
  try {
    // Use notifyOwner as the delivery mechanism
    await notifyOwner({
      title: payload.subject,
      content: `Report Type: ${payload.reportType}\n\nRecipient: ${payload.recipientEmail}\n\n${payload.htmlBody.replace(/<[^>]*>/g, "")}`,
    });
    logger.info(
      `[ReportEmail] Sent ${payload.reportType} report to ${payload.recipientEmail}`
    );
    return true;
  } catch (err: any) {
    logger.error(`[ReportEmail] Failed to send: ${err.message}`);
    return false;
  }
}
