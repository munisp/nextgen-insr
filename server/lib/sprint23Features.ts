// TypeScript enabled — Sprint 96 security audit
/**
 * Sprint 23: Final Production Features
 *
 * 1. Scheduled email delivery for weekly reports (cron integration)
 * 2. Report comparison (side-by-side any two reports)
 * 3. Custom metric thresholds with alerting
 * 4. Per-endpoint rate limiting
 * 5. Webhook retry with exponential backoff + dead letter queue
 * 6. Agent performance scoring
 * 7. Transaction dispute auto-resolution
 * 8. KYC document verification workflow
 */

// ─── 1. Scheduled Email Delivery ────────────────────────────────────────

interface ScheduledDeliveryConfig {
  enabled: boolean;
  cronExpression: string; // e.g., "0 8 * * 1" = Monday 08:00
  timezone: string;
  lastDelivery: string | null;
  nextDelivery: string | null;
  deliveryHistory: Array<{
    sentAt: string;
    recipientCount: number;
    status: "success" | "partial" | "failed";
    errors: string[];
  }>;
}

let scheduledDeliveryConfig: ScheduledDeliveryConfig = {
  enabled: true,
  cronExpression: "0 8 * * 1", // Monday 08:00
  timezone: "Africa/Lagos",
  lastDelivery: null,
  nextDelivery: getNextMonday(),
  deliveryHistory: [],
};

function getNextMonday(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = (1 - day + 7) % 7 || 7;
  const next = new Date(now);
  next.setDate(now.getDate() + diff);
  next.setHours(8, 0, 0, 0);
  return next.toISOString();
}

export function getScheduledDeliveryConfig(): ScheduledDeliveryConfig {
  return { ...scheduledDeliveryConfig };
}

export function updateScheduledDeliveryConfig(
  updates: Partial<
    Pick<ScheduledDeliveryConfig, "enabled" | "cronExpression" | "timezone">
  >
): ScheduledDeliveryConfig {
  Object.assign(scheduledDeliveryConfig, updates);
  scheduledDeliveryConfig.nextDelivery = getNextMonday();
  return getScheduledDeliveryConfig();
}

export function recordDelivery(
  recipientCount: number,
  status: "success" | "partial" | "failed",
  errors: string[] = []
): void {
  scheduledDeliveryConfig.lastDelivery = new Date().toISOString();
  scheduledDeliveryConfig.nextDelivery = getNextMonday();
  scheduledDeliveryConfig.deliveryHistory.unshift({
    sentAt: new Date().toISOString(),
    recipientCount,
    status,
    errors,
  });
  // Keep last 52 weeks of history
  if (scheduledDeliveryConfig.deliveryHistory.length > 52) {
    scheduledDeliveryConfig.deliveryHistory =
      scheduledDeliveryConfig.deliveryHistory.slice(0, 52);
  }
}

// ─── 2. Report Comparison ───────────────────────────────────────────────

export interface ReportComparisonResult {
  reportA: {
    id: string;
    period: { start: string; end: string };
    score: number;
  };
  reportB: {
    id: string;
    period: { start: string; end: string };
    score: number;
  };
  deltas: Record<
    string,
    {
      label: string;
      valueA: number;
      valueB: number;
      delta: number;
      percentChange: number;
      direction: "up" | "down" | "flat";
      isImprovement: boolean;
    }
  >;
  summary: string;
}

export function compareReports(
  reportA: {
    id: string;
    period: { start: string; end: string };
    score: number;
    metrics: any;
  },
  reportB: {
    id: string;
    period: { start: string; end: string };
    score: number;
    metrics: any;
  }
): ReportComparisonResult {
  const deltas: ReportComparisonResult["deltas"] = {};

  const metricPairs: Array<{
    key: string;
    label: string;
    pathA: number;
    pathB: number;
    higherIsBetter: boolean;
  }> = [
    {
      key: "healthScore",
      label: "Health Score",
      pathA: reportA.score,
      pathB: reportB.score,
      higherIsBetter: true,
    },
    {
      key: "txCount",
      label: "Transaction Count",
      pathA: reportA.metrics?.transactions?.totalCount ?? 0,
      pathB: reportB.metrics?.transactions?.totalCount ?? 0,
      higherIsBetter: true,
    },
    {
      key: "txValue",
      label: "Transaction Value",
      pathA: reportA.metrics?.transactions?.totalValue ?? 0,
      pathB: reportB.metrics?.transactions?.totalValue ?? 0,
      higherIsBetter: true,
    },
    {
      key: "successRate",
      label: "Success Rate",
      pathA: reportA.metrics?.transactions?.successRate ?? 0,
      pathB: reportB.metrics?.transactions?.successRate ?? 0,
      higherIsBetter: true,
    },
    {
      key: "activeUsers",
      label: "Active Users",
      pathA: reportA.metrics?.userActivity?.totalActiveUsers ?? 0,
      pathB: reportB.metrics?.userActivity?.totalActiveUsers ?? 0,
      higherIsBetter: true,
    },
    {
      key: "newUsers",
      label: "New Users",
      pathA: reportA.metrics?.userActivity?.newUsers ?? 0,
      pathB: reportB.metrics?.userActivity?.newUsers ?? 0,
      higherIsBetter: true,
    },
    {
      key: "p50Latency",
      label: "API Latency (p50)",
      pathA: reportA.metrics?.apiPerformance?.p50Ms ?? 0,
      pathB: reportB.metrics?.apiPerformance?.p50Ms ?? 0,
      higherIsBetter: false,
    },
    {
      key: "p99Latency",
      label: "API Latency (p99)",
      pathA: reportA.metrics?.apiPerformance?.p99Ms ?? 0,
      pathB: reportB.metrics?.apiPerformance?.p99Ms ?? 0,
      higherIsBetter: false,
    },
    {
      key: "errorRate",
      label: "Error Rate",
      pathA: reportA.metrics?.errors?.errorRate ?? 0,
      pathB: reportB.metrics?.errors?.errorRate ?? 0,
      higherIsBetter: false,
    },
    {
      key: "uptime",
      label: "Uptime %",
      pathA: reportA.metrics?.system?.uptimePercent ?? 0,
      pathB: reportB.metrics?.system?.uptimePercent ?? 0,
      higherIsBetter: true,
    },
  ];

  let improvements = 0;
  let regressions = 0;

  for (const mp of metricPairs) {
    const delta = mp.pathB - mp.pathA;
    const pct = mp.pathA !== 0 ? (delta / mp.pathA) * 100 : 0;
    const direction: "up" | "down" | "flat" =
      delta > 0.01 ? "up" : delta < -0.01 ? "down" : "flat";
    const isImprovement =
      direction === "flat"
        ? true
        : mp.higherIsBetter
          ? direction === "up"
          : direction === "down";
    if (isImprovement && direction !== "flat") improvements++;
    if (!isImprovement) regressions++;
    deltas[mp.key] = {
      label: mp.label,
      valueA: mp.pathA,
      valueB: mp.pathB,
      delta,
      percentChange: Math.round(pct * 100) / 100,
      direction,
      isImprovement,
    };
  }

  const summary =
    regressions === 0
      ? `All ${improvements} metrics improved or held steady between the two periods.`
      : `${improvements} metrics improved, ${regressions} regressed between the two periods.`;

  return {
    reportA: { id: reportA.id, period: reportA.period, score: reportA.score },
    reportB: { id: reportB.id, period: reportB.period, score: reportB.score },
    deltas,
    summary,
  };
}

// ─── 3. Custom Metric Thresholds ────────────────────────────────────────

export interface MetricThreshold {
  id: string;
  metricKey: string;
  label: string;
  operator: "gt" | "lt" | "gte" | "lte" | "eq";
  value: number;
  severity: "critical" | "warning" | "info";
  enabled: boolean;
  lastTriggered: string | null;
  triggerCount: number;
}

const defaultThresholds: MetricThreshold[] = [
  {
    id: "th-001",
    metricKey: "errors.errorRate",
    label: "Error Rate > 1%",
    operator: "gt",
    value: 1,
    severity: "critical",
    enabled: true,
    lastTriggered: null,
    triggerCount: 0,
  },
  {
    id: "th-002",
    metricKey: "system.uptimePercent",
    label: "Uptime < 99.9%",
    operator: "lt",
    value: 99.9,
    severity: "critical",
    enabled: true,
    lastTriggered: null,
    triggerCount: 0,
  },
  {
    id: "th-003",
    metricKey: "apiPerformance.p99Ms",
    label: "P99 Latency > 500ms",
    operator: "gt",
    value: 500,
    severity: "warning",
    enabled: true,
    lastTriggered: null,
    triggerCount: 0,
  },
  {
    id: "th-004",
    metricKey: "security.failedLogins",
    label: "Failed Logins > 50",
    operator: "gt",
    value: 50,
    severity: "warning",
    enabled: true,
    lastTriggered: null,
    triggerCount: 0,
  },
  {
    id: "th-005",
    metricKey: "transactions.successRate",
    label: "Success Rate < 95%",
    operator: "lt",
    value: 95,
    severity: "critical",
    enabled: true,
    lastTriggered: null,
    triggerCount: 0,
  },
  {
    id: "th-006",
    metricKey: "system.cpuAvgPercent",
    label: "CPU > 80%",
    operator: "gt",
    value: 80,
    severity: "warning",
    enabled: true,
    lastTriggered: null,
    triggerCount: 0,
  },
  {
    id: "th-007",
    metricKey: "system.memoryAvgPercent",
    label: "Memory > 85%",
    operator: "gt",
    value: 85,
    severity: "warning",
    enabled: true,
    lastTriggered: null,
    triggerCount: 0,
  },
];

let metricThresholds: MetricThreshold[] = [...defaultThresholds];

export function listThresholds(): MetricThreshold[] {
  return [...metricThresholds];
}

export function getThreshold(id: string): MetricThreshold | undefined {
  return metricThresholds.find(t => t.id === id);
}

export function createThreshold(
  input: Omit<MetricThreshold, "id" | "lastTriggered" | "triggerCount">
): MetricThreshold {
  const threshold: MetricThreshold = {
    ...input,
    id: `th-${Date.now().toString(36)}`,
    lastTriggered: null,
    triggerCount: 0,
  };
  metricThresholds.push(threshold);
  return threshold;
}

export function updateThreshold(
  id: string,
  updates: Partial<
    Pick<
      MetricThreshold,
      "label" | "operator" | "value" | "severity" | "enabled"
    >
  >
): MetricThreshold | null {
  const idx = metricThresholds.findIndex(t => t.id === id);
  if (idx === -1) return null;
  Object.assign(metricThresholds[idx], updates);
  return metricThresholds[idx];
}

export function deleteThreshold(id: string): boolean {
  const before = metricThresholds.length;
  metricThresholds = metricThresholds.filter(t => t.id !== id);
  return metricThresholds.length < before;
}

function getNestedValue(obj: any, path: string): number | undefined {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return typeof current === "number" ? current : undefined;
}

export function evaluateThresholds(metrics: any): Array<{
  threshold: MetricThreshold;
  currentValue: number;
  triggered: boolean;
}> {
  const results: Array<{
    threshold: MetricThreshold;
    currentValue: number;
    triggered: boolean;
  }> = [];
  for (const th of metricThresholds) {
    if (!th.enabled) continue;
    const val = getNestedValue(metrics, th.metricKey);
    if (val === undefined) continue;
    let triggered = false;
    switch (th.operator) {
      case "gt":
        triggered = val > th.value;
        break;
      case "lt":
        triggered = val < th.value;
        break;
      case "gte":
        triggered = val >= th.value;
        break;
      case "lte":
        triggered = val <= th.value;
        break;
      case "eq":
        triggered = val === th.value;
        break;
    }
    if (triggered) {
      th.lastTriggered = new Date().toISOString();
      th.triggerCount++;
    }
    results.push({ threshold: th, currentValue: val, triggered });
  }
  return results;
}

// ─── 4. Per-Endpoint Rate Limiting ──────────────────────────────────────

export interface EndpointRateLimit {
  endpoint: string;
  maxRequests: number;
  windowMs: number;
  currentCount: number;
  lastReset: string;
}

const endpointLimits: Map<string, EndpointRateLimit> = new Map([
  [
    "transactions.create",
    {
      endpoint: "transactions.create",
      maxRequests: 100,
      windowMs: 60000,
      currentCount: 0,
      lastReset: new Date().toISOString(),
    },
  ],
  [
    "auth.login",
    {
      endpoint: "auth.login",
      maxRequests: 10,
      windowMs: 60000,
      currentCount: 0,
      lastReset: new Date().toISOString(),
    },
  ],
  [
    "pinReset.requestOtp",
    {
      endpoint: "pinReset.requestOtp",
      maxRequests: 3,
      windowMs: 300000,
      currentCount: 0,
      lastReset: new Date().toISOString(),
    },
  ],
  [
    "export.transactionsCsv",
    {
      endpoint: "export.transactionsCsv",
      maxRequests: 5,
      windowMs: 60000,
      currentCount: 0,
      lastReset: new Date().toISOString(),
    },
  ],
  [
    "gdpr.requestErasure",
    {
      endpoint: "gdpr.requestErasure",
      maxRequests: 2,
      windowMs: 3600000,
      currentCount: 0,
      lastReset: new Date().toISOString(),
    },
  ],
]);

export function getEndpointLimits(): EndpointRateLimit[] {
  return Array.from(endpointLimits.values());
}

export function setEndpointLimit(
  endpoint: string,
  maxRequests: number,
  windowMs: number
): EndpointRateLimit {
  const limit: EndpointRateLimit = {
    endpoint,
    maxRequests,
    windowMs,
    currentCount: 0,
    lastReset: new Date().toISOString(),
  };
  endpointLimits.set(endpoint, limit);
  return limit;
}

export function checkEndpointLimit(endpoint: string): {
  allowed: boolean;
  remaining: number;
  resetAt: string;
} {
  const limit = endpointLimits.get(endpoint);
  if (!limit) return { allowed: true, remaining: Infinity, resetAt: "" };
  const now = Date.now();
  const resetTime = new Date(limit.lastReset).getTime() + limit.windowMs;
  if (now > resetTime) {
    limit.currentCount = 0;
    limit.lastReset = new Date().toISOString();
  }
  limit.currentCount++;
  const allowed = limit.currentCount <= limit.maxRequests;
  return {
    allowed,
    remaining: Math.max(0, limit.maxRequests - limit.currentCount),
    resetAt: new Date(
      new Date(limit.lastReset).getTime() + limit.windowMs
    ).toISOString(),
  };
}

// ─── 5. Webhook Retry with Exponential Backoff ──────────────────────────

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  url: string;
  payload: string;
  status: "pending" | "success" | "failed" | "dead_letter";
  attempts: number;
  maxAttempts: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  responseCode: number | null;
  responseBody: string | null;
  createdAt: string;
}

const webhookDeliveries: WebhookDelivery[] = [];
const deadLetterQueue: WebhookDelivery[] = [];

export function createWebhookDelivery(
  webhookId: string,
  url: string,
  payload: string
): WebhookDelivery {
  const delivery: WebhookDelivery = {
    id: `wd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    webhookId,
    url,
    payload,
    status: "pending",
    attempts: 0,
    maxAttempts: 5,
    lastAttemptAt: null,
    nextRetryAt: new Date().toISOString(),
    responseCode: null,
    responseBody: null,
    createdAt: new Date().toISOString(),
  };
  webhookDeliveries.push(delivery);
  return delivery;
}

export function processWebhookRetry(
  deliveryId: string,
  success: boolean,
  responseCode: number,
  responseBody: string
): WebhookDelivery | null {
  const delivery = webhookDeliveries.find(d => d.id === deliveryId);
  if (!delivery) return null;
  delivery.attempts++;
  delivery.lastAttemptAt = new Date().toISOString();
  delivery.responseCode = responseCode;
  delivery.responseBody = responseBody.slice(0, 1000);
  if (success) {
    delivery.status = "success";
    delivery.nextRetryAt = null;
  } else if (delivery.attempts >= delivery.maxAttempts) {
    delivery.status = "dead_letter";
    delivery.nextRetryAt = null;
    deadLetterQueue.push(delivery);
  } else {
    delivery.status = "failed";
    // Exponential backoff: 2^attempt * 1000ms (1s, 2s, 4s, 8s, 16s)
    const backoffMs = Math.pow(2, delivery.attempts) * 1000;
    const jitter = Math.random() * 1000;
    delivery.nextRetryAt = new Date(
      Date.now() + backoffMs + jitter
    ).toISOString();
  }
  return delivery;
}

export function listWebhookDeliveries(status?: string): WebhookDelivery[] {
  if (status) return webhookDeliveries.filter(d => d.status === status);
  return [...webhookDeliveries];
}

export function getDeadLetterQueue(): WebhookDelivery[] {
  return [...deadLetterQueue];
}

export function retryDeadLetter(deliveryId: string): WebhookDelivery | null {
  const idx = deadLetterQueue.findIndex(d => d.id === deliveryId);
  if (idx === -1) return null;
  const delivery = deadLetterQueue.splice(idx, 1)[0];
  delivery.status = "pending";
  delivery.attempts = 0;
  delivery.nextRetryAt = new Date().toISOString();
  return delivery;
}

// ─── 6. Agent Performance Scoring ───────────────────────────────────────

export interface AgentPerformanceScore {
  agentId: string;
  agentCode: string;
  overallScore: number; // 0-100
  breakdown: {
    transactionVolume: { score: number; weight: number; raw: number };
    successRate: { score: number; weight: number; raw: number };
    customerSatisfaction: { score: number; weight: number; raw: number };
    complianceAdherence: { score: number; weight: number; raw: number };
    uptimeReliability: { score: number; weight: number; raw: number };
    responseTime: { score: number; weight: number; raw: number };
  };
  rank: number;
  tier: "platinum" | "gold" | "silver" | "bronze";
  trend: "improving" | "declining" | "stable";
  period: string;
}

export function calculateAgentPerformance(
  agentId: string,
  agentCode: string,
  data: {
    txCount: number;
    txTarget: number;
    successRate: number;
    customerRating: number; // 1-5
    complianceScore: number; // 0-100
    uptimeHours: number;
    totalHours: number;
    avgResponseMs: number;
  }
): AgentPerformanceScore {
  const txScore = Math.min(
    100,
    (data.txCount / Math.max(1, data.txTarget)) * 100
  );
  const successScore = data.successRate;
  const csatScore = (data.customerRating / 5) * 100;
  const complianceScore = data.complianceScore;
  const uptimeScore = (data.uptimeHours / Math.max(1, data.totalHours)) * 100;
  const responseScore =
    data.avgResponseMs <= 1000
      ? 100
      : data.avgResponseMs <= 3000
        ? 75
        : data.avgResponseMs <= 5000
          ? 50
          : 25;

  const weights = {
    txVolume: 0.25,
    success: 0.2,
    csat: 0.15,
    compliance: 0.2,
    uptime: 0.1,
    response: 0.1,
  };
  const overall =
    txScore * weights.txVolume +
    successScore * weights.success +
    csatScore * weights.csat +
    complianceScore * weights.compliance +
    uptimeScore * weights.uptime +
    responseScore * weights.response;

  const tier =
    overall >= 90
      ? "platinum"
      : overall >= 75
        ? "gold"
        : overall >= 60
          ? "silver"
          : "bronze";

  return {
    agentId,
    agentCode,
    overallScore: Math.round(overall * 100) / 100,
    breakdown: {
      transactionVolume: {
        score: Math.round(txScore * 100) / 100,
        weight: weights.txVolume,
        raw: data.txCount,
      },
      successRate: {
        score: Math.round(successScore * 100) / 100,
        weight: weights.success,
        raw: data.successRate,
      },
      customerSatisfaction: {
        score: Math.round(csatScore * 100) / 100,
        weight: weights.csat,
        raw: data.customerRating,
      },
      complianceAdherence: {
        score: Math.round(complianceScore * 100) / 100,
        weight: weights.compliance,
        raw: data.complianceScore,
      },
      uptimeReliability: {
        score: Math.round(uptimeScore * 100) / 100,
        weight: weights.uptime,
        raw: data.uptimeHours,
      },
      responseTime: {
        score: Math.round(responseScore * 100) / 100,
        weight: weights.response,
        raw: data.avgResponseMs,
      },
    },
    rank: 0, // Set by caller after sorting all agents
    tier,
    trend: "stable",
    period: new Date().toISOString().slice(0, 7), // YYYY-MM
  };
}

// ─── 7. Transaction Dispute Auto-Resolution ─────────────────────────────

export interface DisputeAutoRule {
  id: string;
  name: string;
  condition: {
    field: string;
    operator: "eq" | "gt" | "lt" | "contains";
    value: string | number;
  };
  action:
    | "auto_refund"
    | "auto_reject"
    | "escalate_to_supervisor"
    | "request_evidence";
  maxAmount: number; // Auto-resolve only if amount <= this
  enabled: boolean;
  resolutionCount: number;
}

const disputeAutoRules: DisputeAutoRule[] = [
  {
    id: "dar-001",
    name: "Small amount auto-refund",
    condition: { field: "amount", operator: "lt", value: 5000 },
    action: "auto_refund",
    maxAmount: 5000,
    enabled: true,
    resolutionCount: 0,
  },
  {
    id: "dar-002",
    name: "Duplicate transaction auto-refund",
    condition: { field: "reason", operator: "contains", value: "duplicate" },
    action: "auto_refund",
    maxAmount: 50000,
    enabled: true,
    resolutionCount: 0,
  },
  {
    id: "dar-003",
    name: "High value escalation",
    condition: { field: "amount", operator: "gt", value: 100000 },
    action: "escalate_to_supervisor",
    maxAmount: Infinity,
    enabled: true,
    resolutionCount: 0,
  },
  {
    id: "dar-004",
    name: "Fraud-related evidence request",
    condition: { field: "reason", operator: "contains", value: "fraud" },
    action: "request_evidence",
    maxAmount: Infinity,
    enabled: true,
    resolutionCount: 0,
  },
];

export function listDisputeAutoRules(): DisputeAutoRule[] {
  return [...disputeAutoRules];
}

export function createDisputeAutoRule(
  input: Omit<DisputeAutoRule, "id" | "resolutionCount">
): DisputeAutoRule {
  const rule: DisputeAutoRule = {
    ...input,
    id: `dar-${Date.now().toString(36)}`,
    resolutionCount: 0,
  };
  disputeAutoRules.push(rule);
  return rule;
}

export function evaluateDispute(dispute: {
  amount: number;
  reason: string;
  category: string;
}): { action: DisputeAutoRule["action"]; rule: DisputeAutoRule } | null {
  for (const rule of disputeAutoRules) {
    if (!rule.enabled) continue;
    if (dispute.amount > rule.maxAmount) continue;
    let matches = false;
    const fieldValue = (dispute as any)[rule.condition.field];
    if (fieldValue === undefined) continue;
    switch (rule.condition.operator) {
      case "eq":
        matches = fieldValue === rule.condition.value;
        break;
      case "gt":
        matches =
          typeof fieldValue === "number" &&
          fieldValue > (rule.condition.value as number);
        break;
      case "lt":
        matches =
          typeof fieldValue === "number" &&
          fieldValue < (rule.condition.value as number);
        break;
      case "contains":
        matches =
          typeof fieldValue === "string" &&
          fieldValue
            .toLowerCase()
            .includes(String(rule.condition.value).toLowerCase());
        break;
    }
    if (matches) {
      rule.resolutionCount++;
      return { action: rule.action, rule };
    }
  }
  return null;
}

// ─── 8. KYC Document Verification Workflow ──────────────────────────────

export interface KycVerificationStep {
  id: string;
  agentId: string;
  documentType:
    | "national_id"
    | "passport"
    | "drivers_license"
    | "utility_bill"
    | "bank_statement"
    | "cac_certificate";
  documentUrl: string;
  status: "pending" | "under_review" | "approved" | "rejected" | "expired";
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  expiresAt: string | null;
  submittedAt: string;
  metadata: Record<string, string>;
}

const kycVerifications: KycVerificationStep[] = [];

export function submitKycDocument(
  agentId: string,
  documentType: KycVerificationStep["documentType"],
  documentUrl: string,
  metadata: Record<string, string> = {}
): KycVerificationStep {
  const step: KycVerificationStep = {
    id: `kyc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    agentId,
    documentType,
    documentUrl,
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    expiresAt: null,
    submittedAt: new Date().toISOString(),
    metadata,
  };
  kycVerifications.push(step);
  return step;
}

export function reviewKycDocument(
  verificationId: string,
  reviewerId: string,
  decision: "approved" | "rejected",
  rejectionReason?: string
): KycVerificationStep | null {
  const step = kycVerifications.find(v => v.id === verificationId);
  if (!step) return null;
  step.status = decision;
  step.reviewedBy = reviewerId;
  step.reviewedAt = new Date().toISOString();
  if (decision === "rejected" && rejectionReason) {
    step.rejectionReason = rejectionReason;
  }
  if (decision === "approved") {
    // Set expiry to 1 year from now
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 1);
    step.expiresAt = expiry.toISOString();
  }
  return step;
}

export function getAgentKycStatus(agentId: string): {
  documents: KycVerificationStep[];
  overallStatus: "complete" | "incomplete" | "expired" | "rejected";
  completionPercent: number;
} {
  const docs = kycVerifications.filter(v => v.agentId === agentId);
  const requiredTypes: KycVerificationStep["documentType"][] = [
    "national_id",
    "utility_bill",
  ];
  const approvedTypes = new Set(
    docs.filter(d => d.status === "approved").map(d => d.documentType)
  );
  const hasExpired = docs.some(
    d =>
      d.status === "approved" &&
      d.expiresAt &&
      new Date(d.expiresAt) < new Date()
  );
  const hasRejected = docs.some(d => d.status === "rejected");
  const completionPercent = Math.round(
    (requiredTypes.filter(t => approvedTypes.has(t)).length /
      requiredTypes.length) *
      100
  );

  let overallStatus: "complete" | "incomplete" | "expired" | "rejected" =
    "incomplete";
  if (hasExpired) overallStatus = "expired";
  else if (hasRejected && completionPercent < 100) overallStatus = "rejected";
  else if (completionPercent === 100) overallStatus = "complete";

  return { documents: docs, overallStatus, completionPercent };
}

export function listPendingKycReviews(): KycVerificationStep[] {
  return kycVerifications.filter(
    v => v.status === "pending" || v.status === "under_review"
  );
}
