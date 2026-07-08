// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * Notification Event Triggers — InsurePortal Agent Banking Platform
 *
 * Automatically publishes real-time notifications for critical system events.
 * Integrates with the existing publishNotification / notifyUser / broadcastNotification
 * functions from realtimeNotifications.ts.
 *
 * Event Categories:
 * - Fraud Detection: New fraud alerts, high-risk transactions
 * - KYC Status: Document approved/rejected, expiry warnings
 * - System Health: Service degradation, high CPU/memory, connectivity issues
 * - Transaction Failures: Failed transactions, reversal requests, limit breaches
 * - Settlement: Batch completion, reconciliation discrepancies
 * - Compliance: CBN report due, regulatory deadline approaching
 */

import {
  publishNotification,
  notifyUser,
  broadcastNotification,
} from "./realtimeNotifications";
import type { NotificationChannel } from "./realtimeNotifications";

// ═══════════════════════════════════════════════════════════════════════════════
// Fraud Event Triggers
// ═══════════════════════════════════════════════════════════════════════════════

export async function triggerFraudAlert(params: {
  agentId: string;
  agentName: string;
  transactionId?: string;
  amount: number;
  fraudScore: number;
  reason: string;
  type: string;
}): Promise<void> {
  const severity =
    params.fraudScore >= 80
      ? "critical"
      : params.fraudScore >= 50
        ? "warning"
        : "info";

  await broadcastNotification({
    channel: "fraud",
    title: `Fraud Alert: ${params.type}`,
    body: `Agent ${params.agentName} — ${params.reason}. Score: ${params.fraudScore}/100. Amount: ₦${params.amount.toLocaleString()}`,
    severity,
    actionUrl: "/admin/fraud",
    metadata: {
      agentId: params.agentId,
      transactionId: params.transactionId,
      fraudScore: params.fraudScore,
      amount: params.amount,
    },
  });
}

export async function triggerHighRiskTransaction(params: {
  agentId: string;
  agentName: string;
  amount: number;
  transactionRef: string;
  riskLevel: "medium" | "high" | "critical";
}): Promise<void> {
  await broadcastNotification({
    channel: "fraud",
    title: `High-Risk Transaction Detected`,
    body: `₦${params.amount.toLocaleString()} by ${params.agentName} (${params.transactionRef}). Risk: ${params.riskLevel.toUpperCase()}`,
    severity: params.riskLevel === "critical" ? "critical" : "warning",
    actionUrl: `/admin/fraud`,
    metadata: { agentId: params.agentId, ref: params.transactionRef },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// KYC Event Triggers
// ═══════════════════════════════════════════════════════════════════════════════

export async function triggerKycStatusChange(params: {
  agentId: string;
  agentName: string;
  documentType: string;
  status: "approved" | "rejected" | "expired";
  reason?: string;
}): Promise<void> {
  const severity =
    params.status === "rejected"
      ? "warning"
      : params.status === "expired"
        ? "critical"
        : "info";
  const title =
    params.status === "approved"
      ? `KYC Approved: ${params.documentType}`
      : params.status === "rejected"
        ? `KYC Rejected: ${params.documentType}`
        : `KYC Expired: ${params.documentType}`;

  await notifyUser(params.agentId, {
    channel: "kyc",
    title,
    body: `Agent ${params.agentName} — ${params.documentType} ${params.status}${params.reason ? `. Reason: ${params.reason}` : ""}`,
    severity,
    actionUrl: "/kyc-verification",
    metadata: { agentId: params.agentId, documentType: params.documentType },
  });

  // Also notify admins
  await broadcastNotification({
    channel: "kyc",
    title: `KYC ${params.status}: ${params.agentName}`,
    body: `${params.documentType} ${params.status}${params.reason ? ` — ${params.reason}` : ""}`,
    severity: severity === "critical" ? "warning" : "info",
    actionUrl: "/kyc-verification",
  });
}

export async function triggerKycExpiryWarning(params: {
  agentId: string;
  agentName: string;
  documentType: string;
  daysUntilExpiry: number;
}): Promise<void> {
  await notifyUser(params.agentId, {
    channel: "kyc",
    title: `KYC Document Expiring Soon`,
    body: `${params.documentType} for ${params.agentName} expires in ${params.daysUntilExpiry} days. Please renew.`,
    severity: params.daysUntilExpiry <= 7 ? "critical" : "warning",
    actionUrl: "/kyc-verification",
    metadata: {
      agentId: params.agentId,
      daysUntilExpiry: params.daysUntilExpiry,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// System Health Event Triggers
// ═══════════════════════════════════════════════════════════════════════════════

export async function triggerSystemHealthAlert(params: {
  metric: string;
  currentValue: number;
  threshold: number;
  unit: string;
  service?: string;
}): Promise<void> {
  const severity =
    params.currentValue >= params.threshold * 1.2 ? "critical" : "warning";

  await broadcastNotification({
    channel: "system",
    title: `System Alert: ${params.metric}`,
    body: `${params.service ? `[${params.service}] ` : ""}${params.metric} at ${params.currentValue}${params.unit} (threshold: ${params.threshold}${params.unit})`,
    severity,
    actionUrl: "/system-health-monitor",
    metadata: {
      metric: params.metric,
      value: params.currentValue,
      threshold: params.threshold,
    },
  });
}

export async function triggerServiceDown(params: {
  serviceName: string;
  lastSeen: string;
  impact: string;
}): Promise<void> {
  await broadcastNotification({
    channel: "system",
    title: `Service Down: ${params.serviceName}`,
    body: `${params.serviceName} is unreachable. Last seen: ${params.lastSeen}. Impact: ${params.impact}`,
    severity: "critical",
    actionUrl: "/system-health-monitor",
    metadata: { service: params.serviceName },
  });
}

export async function triggerConnectivityIssue(params: {
  provider: string;
  errorRate: number;
  affectedAgents: number;
}): Promise<void> {
  await broadcastNotification({
    channel: "system",
    title: `Connectivity Issue: ${params.provider}`,
    body: `${params.provider} error rate: ${params.errorRate}%. ${params.affectedAgents} agents affected.`,
    severity: params.errorRate > 50 ? "critical" : "warning",
    actionUrl: "/system-health-monitor",
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Transaction Event Triggers
// ═══════════════════════════════════════════════════════════════════════════════

export async function triggerTransactionFailure(params: {
  agentId: string;
  agentName: string;
  transactionRef: string;
  amount: number;
  reason: string;
  type: string;
}): Promise<void> {
  await notifyUser(params.agentId, {
    channel: "transaction",
    title: `Transaction Failed: ${params.type}`,
    body: `₦${params.amount.toLocaleString()} (${params.transactionRef}) — ${params.reason}`,
    severity: "warning",
    actionUrl: "/",
    metadata: { ref: params.transactionRef, amount: params.amount },
  });
}

export async function triggerReversalRequest(params: {
  agentId: string;
  agentName: string;
  transactionRef: string;
  amount: number;
  requestedBy: string;
}): Promise<void> {
  await broadcastNotification({
    channel: "transaction",
    title: `Reversal Requested`,
    body: `₦${params.amount.toLocaleString()} (${params.transactionRef}) by ${params.agentName}. Requested by: ${params.requestedBy}`,
    severity: "warning",
    actionUrl: "/admin",
    metadata: { ref: params.transactionRef, agentId: params.agentId },
  });
}

export async function triggerLimitBreach(params: {
  agentId: string;
  agentName: string;
  limitType: string;
  currentAmount: number;
  maxAmount: number;
}): Promise<void> {
  await notifyUser(params.agentId, {
    channel: "transaction",
    title: `Transaction Limit Reached`,
    body: `${params.limitType}: ₦${params.currentAmount.toLocaleString()} / ₦${params.maxAmount.toLocaleString()} for ${params.agentName}`,
    severity: "warning",
    actionUrl: "/",
    metadata: { limitType: params.limitType },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Settlement Event Triggers
// ═══════════════════════════════════════════════════════════════════════════════

export async function triggerSettlementComplete(params: {
  batchId: string;
  totalAmount: number;
  transactionCount: number;
}): Promise<void> {
  await broadcastNotification({
    channel: "settlement",
    title: `Settlement Batch Complete`,
    body: `Batch ${params.batchId}: ₦${params.totalAmount.toLocaleString()} across ${params.transactionCount} transactions`,
    severity: "info",
    actionUrl: "/settlement-reconciliation",
    metadata: { batchId: params.batchId },
  });
}

export async function triggerReconciliationDiscrepancy(params: {
  batchId: string;
  discrepancyAmount: number;
  discrepancyCount: number;
}): Promise<void> {
  await broadcastNotification({
    channel: "settlement",
    title: `Reconciliation Discrepancy Found`,
    body: `Batch ${params.batchId}: ${params.discrepancyCount} discrepancies totaling ₦${params.discrepancyAmount.toLocaleString()}`,
    severity: "critical",
    actionUrl: "/settlement-reconciliation",
    metadata: { batchId: params.batchId },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Compliance Event Triggers
// ═══════════════════════════════════════════════════════════════════════════════

export async function triggerComplianceDeadline(params: {
  reportType: string;
  dueDate: string;
  daysRemaining: number;
}): Promise<void> {
  await broadcastNotification({
    channel: "compliance",
    title: `Compliance Deadline: ${params.reportType}`,
    body: `${params.reportType} due ${params.dueDate} (${params.daysRemaining} days remaining)`,
    severity:
      params.daysRemaining <= 3
        ? "critical"
        : params.daysRemaining <= 7
          ? "warning"
          : "info",
    actionUrl: "/cbn-reporting",
    metadata: { reportType: params.reportType, dueDate: params.dueDate },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Commission Event Triggers
// ═══════════════════════════════════════════════════════════════════════════════

export async function triggerCommissionPayout(params: {
  agentId: string;
  agentName: string;
  amount: number;
  period: string;
}): Promise<void> {
  await notifyUser(params.agentId, {
    channel: "commission",
    title: `Commission Payout Processed`,
    body: `₦${params.amount.toLocaleString()} for ${params.period} has been processed for ${params.agentName}`,
    severity: "info",
    actionUrl: "/commission-payouts",
    metadata: { amount: params.amount, period: params.period },
  });
}
