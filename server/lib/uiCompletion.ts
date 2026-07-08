// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * Sprint 65 F11-F15: UI/UX Completion Backend Support
 * - F11: Global notification center with bell icon and unread count
 * - F12: User activity audit log page
 * - F13: System health dashboard with real-time service status
 * - F14: Bulk operations (bulk approve agents, bulk settle transactions)
 * - F15: Export functionality for all list views (CSV/Excel)
 */

// ============================================================
// F11: Global Notification Center
// ============================================================

export type NotificationType =
  | "info"
  | "warning"
  | "error"
  | "success"
  | "system";
export type NotificationChannel = "in_app" | "email" | "sms" | "push";

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  channel: NotificationChannel;
  read: boolean;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  readAt?: Date;
  expiresAt?: Date;
}

export interface NotificationSummary {
  total: number;
  unread: number;
  byType: Record<NotificationType, number>;
  latestUnread: AppNotification[];
}

export function createNotification(params: {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  channel?: NotificationChannel;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
  expiresInHours?: number;
}): AppNotification {
  const now = new Date();
  return {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: params.userId,
    type: params.type,
    title: params.title,
    message: params.message,
    channel: params.channel || "in_app",
    read: false,
    actionUrl: params.actionUrl,
    metadata: params.metadata,
    createdAt: now,
    expiresAt: params.expiresInHours
      ? new Date(now.getTime() + params.expiresInHours * 60 * 60 * 1000)
      : undefined,
  };
}

export function summarizeNotifications(
  notifications: AppNotification[]
): NotificationSummary {
  const active = notifications.filter(
    n => !n.expiresAt || n.expiresAt > new Date()
  );
  const unread = active.filter(n => !n.read);

  const byType: Record<NotificationType, number> = {
    info: 0,
    warning: 0,
    error: 0,
    success: 0,
    system: 0,
  };
  for (const n of unread) {
    byType[n.type]++;
  }

  return {
    total: active.length,
    unread: unread.length,
    byType,
    latestUnread: unread.slice(0, 10),
  };
}

// ============================================================
// F12: User Activity Audit Log
// ============================================================

export type AuditAction =
  | "login"
  | "logout"
  | "create"
  | "read"
  | "update"
  | "delete"
  | "approve"
  | "reject"
  | "export"
  | "import"
  | "configure"
  | "escalate"
  | "assign"
  | "transfer"
  | "settle"
  | "reverse";

export interface AuditEntry {
  id: string;
  userId: string;
  userName: string;
  action: AuditAction;
  resource: string;
  resourceId?: string;
  details: string;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
  duration?: number;
  status: "success" | "failure" | "partial";
  metadata?: Record<string, unknown>;
}

export function createAuditEntry(params: {
  userId: string;
  userName: string;
  action: AuditAction;
  resource: string;
  resourceId?: string;
  details: string;
  ipAddress?: string;
  userAgent?: string;
  status?: "success" | "failure" | "partial";
  metadata?: Record<string, unknown>;
}): AuditEntry {
  return {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: params.userId,
    userName: params.userName,
    action: params.action,
    resource: params.resource,
    resourceId: params.resourceId,
    details: params.details,
    ipAddress: params.ipAddress || "0.0.0.0",
    userAgent: params.userAgent || "unknown",
    timestamp: new Date(),
    status: params.status || "success",
    metadata: params.metadata,
  };
}

export function filterAuditLog(
  entries: AuditEntry[],
  filters: {
    userId?: string;
    action?: AuditAction;
    resource?: string;
    startDate?: Date;
    endDate?: Date;
    status?: string;
    search?: string;
  }
): AuditEntry[] {
  return entries.filter(e => {
    if (filters.userId && e.userId !== filters.userId) return false;
    if (filters.action && e.action !== filters.action) return false;
    if (filters.resource && e.resource !== filters.resource) return false;
    if (filters.startDate && e.timestamp < filters.startDate) return false;
    if (filters.endDate && e.timestamp > filters.endDate) return false;
    if (filters.status && e.status !== filters.status) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      return (
        e.details.toLowerCase().includes(q) ||
        e.userName.toLowerCase().includes(q) ||
        e.resource.toLowerCase().includes(q)
      );
    }
    return true;
  });
}

// ============================================================
// F13: System Health Dashboard
// ============================================================

export type ServiceStatus = "healthy" | "degraded" | "down" | "unknown";

export interface ServiceHealth {
  name: string;
  status: ServiceStatus;
  latency: number;
  lastChecked: Date;
  uptime: number;
  details?: string;
  version?: string;
}

export interface SystemHealthReport {
  overall: ServiceStatus;
  services: ServiceHealth[];
  checkedAt: Date;
  uptimeSeconds: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
  };
  cpuUsage: { user: number; system: number };
}

export function aggregateHealthStatus(
  services: ServiceHealth[]
): ServiceStatus {
  if (services.some(s => s.status === "down")) return "down";
  if (services.some(s => s.status === "degraded")) return "degraded";
  if (services.every(s => s.status === "healthy")) return "healthy";
  return "unknown";
}

export function generateHealthReport(
  services: ServiceHealth[]
): SystemHealthReport {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();

  return {
    overall: aggregateHealthStatus(services),
    services,
    checkedAt: new Date(),
    uptimeSeconds: process.uptime(),
    memoryUsage: {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: mem.rss,
      external: mem.external,
    },
    cpuUsage: {
      user: cpu.user / 1000000,
      system: cpu.system / 1000000,
    },
  };
}

// ============================================================
// F14: Bulk Operations
// ============================================================

export interface BulkOperationResult<T = unknown> {
  totalRequested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: Array<{
    id: string;
    status: "success" | "failure" | "skipped";
    error?: string;
    data?: T;
  }>;
  completedAt: Date;
  durationMs: number;
}

export async function executeBulkOperation<T>(
  ids: string[],
  operation: (id: string) => Promise<T>,
  options: { concurrency?: number; skipOnError?: boolean } = {}
): Promise<BulkOperationResult<T>> {
  const startTime = Date.now();
  const concurrency = options.concurrency || 5;
  const skipOnError = options.skipOnError !== false;

  const results: BulkOperationResult<T>["results"] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  // Process in batches
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async id => {
        const data = await operation(id);
        return { id, data };
      })
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push({
          id: result.value.id,
          status: "success",
          data: result.value.data,
        });
        succeeded++;
      } else {
        const errorMsg =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        if (skipOnError) {
          results.push({
            id: batch[batchResults.indexOf(result)],
            status: "failure",
            error: errorMsg,
          });
          failed++;
        } else {
          results.push({
            id: batch[batchResults.indexOf(result)],
            status: "skipped",
            error: errorMsg,
          });
          skipped++;
        }
      }
    }
  }

  return {
    totalRequested: ids.length,
    succeeded,
    failed,
    skipped,
    results,
    completedAt: new Date(),
    durationMs: Date.now() - startTime,
  };
}

// ============================================================
// F15: Export Functionality for All List Views
// ============================================================

export type ExportFormat = "csv" | "json" | "xlsx_csv";

export interface ExportConfig {
  format: ExportFormat;
  columns: Array<{
    key: string;
    label: string;
    formatter?: (value: unknown) => string;
  }>;
  filename: string;
  includeHeaders: boolean;
  dateFormat: string;
}

export function exportToCsv<T extends Record<string, unknown>>(
  data: T[],
  config: ExportConfig
): string {
  const rows: string[] = [];

  if (config.includeHeaders) {
    rows.push(config.columns.map(c => `"${c.label}"`).join(","));
  }

  for (const item of data) {
    const row = config.columns.map(col => {
      const value = item[col.key];
      if (col.formatter) return `"${col.formatter(value)}"`;
      if (value === null || value === undefined) return '""';
      if (value instanceof Date) return `"${value.toISOString()}"`;
      if (typeof value === "string") return `"${value.replace(/"/g, '""')}"`;
      return `"${String(value)}"`;
    });
    rows.push(row.join(","));
  }

  return rows.join("\n");
}

export function exportToJson<T>(data: T[], pretty: boolean = true): string {
  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
}

export function getExportFilename(
  baseName: string,
  format: ExportFormat
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const ext = format === "xlsx_csv" ? "csv" : format;
  return `${baseName}_${timestamp}.${ext}`;
}

// Standard export configs for common entities
export const EXPORT_CONFIGS = {
  transactions: {
    format: "csv" as ExportFormat,
    columns: [
      { key: "ref", label: "Reference" },
      { key: "type", label: "Type" },
      { key: "amount", label: "Amount" },
      { key: "fee", label: "Fee" },
      { key: "commission", label: "Commission" },
      { key: "customer", label: "Customer" },
      { key: "status", label: "Status" },
      { key: "channel", label: "Channel" },
      { key: "createdAt", label: "Date" },
    ],
    filename: "transactions",
    includeHeaders: true,
    dateFormat: "YYYY-MM-DD HH:mm:ss",
  },
  agents: {
    format: "csv" as ExportFormat,
    columns: [
      { key: "agentId", label: "Agent Code" },
      { key: "name", label: "Name" },
      { key: "tier", label: "Tier" },
      { key: "role", label: "Role" },
      { key: "premiumReserve", label: "Float Balance" },
      { key: "commissionBalance", label: "Commission" },
      { key: "isActive", label: "Active" },
      { key: "createdAt", label: "Joined" },
    ],
    filename: "agents",
    includeHeaders: true,
    dateFormat: "YYYY-MM-DD",
  },
  disputes: {
    format: "csv" as ExportFormat,
    columns: [
      { key: "id", label: "Dispute ID" },
      { key: "transactionRef", label: "Transaction Ref" },
      { key: "type", label: "Type" },
      { key: "amount", label: "Amount" },
      { key: "status", label: "Status" },
      { key: "filedBy", label: "Filed By" },
      { key: "createdAt", label: "Filed Date" },
      { key: "resolvedAt", label: "Resolved Date" },
    ],
    filename: "disputes",
    includeHeaders: true,
    dateFormat: "YYYY-MM-DD HH:mm:ss",
  },
  auditLog: {
    format: "csv" as ExportFormat,
    columns: [
      { key: "timestamp", label: "Timestamp" },
      { key: "userName", label: "User" },
      { key: "action", label: "Action" },
      { key: "resource", label: "Resource" },
      { key: "details", label: "Details" },
      { key: "ipAddress", label: "IP Address" },
      { key: "status", label: "Status" },
    ],
    filename: "audit_log",
    includeHeaders: true,
    dateFormat: "YYYY-MM-DD HH:mm:ss",
  },
};
