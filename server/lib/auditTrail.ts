// @ts-check
/**
 * Enhanced Audit Trail Middleware
 *
 * Logs all significant actions with:
 * - User identity (who)
 * - Action type (what)
 * - Resource affected (where)
 * - Timestamp (when)
 * - IP address and user agent (context)
 * - Before/after state for mutations (diff)
 */
import { logger, auditLog as structuredAuditLog } from "../_core/logger";

export interface AuditEntry {
  id: string;
  timestamp: Date;
  userId: string | null;
  userRole: string;
  action:
    | "CREATE"
    | "READ"
    | "UPDATE"
    | "DELETE"
    | "LOGIN"
    | "LOGOUT"
    | "EXPORT"
    | "APPROVE"
    | "REJECT"
    | "ESCALATE";
  resource: string;
  resourceId: string | null;
  description: string;
  ipAddress: string;
  userAgent: string;
  metadata?: Record<string, unknown>;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  severity: "low" | "medium" | "high" | "critical";
  category: "auth" | "data" | "config" | "financial" | "compliance" | "system";
}

// In-memory audit log (production would use DB)
const auditLog: AuditEntry[] = [];
let nextId = 1;

/**
 * Log an audit entry
 */
export function logAudit(
  entry: Omit<AuditEntry, "id" | "timestamp">
): AuditEntry {
  const auditEntry: AuditEntry = {
    ...entry,
    id: `AUD-${String(nextId++).padStart(8, "0")}`,
    timestamp: new Date(),
  };
  auditLog.push(auditEntry);

  // Keep last 10,000 entries in memory
  if (auditLog.length > 10000) {
    auditLog.splice(0, auditLog.length - 10000);
  }

  // Log critical actions with structured logger
  if (entry.severity === "critical" || entry.severity === "high") {
    logger.warn(
      {
        audit: true,
        severity: entry.severity,
        action: entry.action,
        resource: entry.resource,
        userId: entry.userId,
        description: entry.description,
      },
      `[AUDIT:${entry.severity.toUpperCase()}] ${entry.action} ${entry.resource} by ${entry.userId || "anonymous"}: ${entry.description}`
    );
    // Also log to structured audit trail
    structuredAuditLog({
      actor: entry.userId || "anonymous",
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? undefined,
      ip: entry.ipAddress,
      metadata: { description: entry.description, category: entry.category },
    });
  }

  return auditEntry;
}

/**
 * Query audit entries with filters
 */
export function queryAuditLog(filters: {
  userId?: string;
  action?: AuditEntry["action"];
  resource?: string;
  severity?: AuditEntry["severity"];
  category?: AuditEntry["category"];
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}): { entries: AuditEntry[]; total: number } {
  let filtered = [...auditLog];

  if (filters.userId)
    filtered = filtered.filter(e => e.userId === filters.userId);
  if (filters.action)
    filtered = filtered.filter(e => e.action === filters.action);
  if (filters.resource)
    filtered = filtered.filter(e => e.resource === filters.resource);
  if (filters.severity)
    filtered = filtered.filter(e => e.severity === filters.severity);
  if (filters.category)
    filtered = filtered.filter(e => e.category === filters.category);
  if (filters.startDate)
    filtered = filtered.filter(e => e.timestamp >= filters.startDate!);
  if (filters.endDate)
    filtered = filtered.filter(e => e.timestamp <= filters.endDate!);

  // Sort by newest first
  filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const total = filtered.length;
  const offset = filters.offset || 0;
  const limit = filters.limit || 50;
  const entries = filtered.slice(offset, offset + limit);

  return { entries, total };
}

/**
 * Get audit statistics
 */
export function getAuditStats() {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const recent24h = auditLog.filter(e => e.timestamp >= last24h);
  const recent7d = auditLog.filter(e => e.timestamp >= last7d);

  return {
    total: auditLog.length,
    last24h: recent24h.length,
    last7d: recent7d.length,
    bySeverity: {
      critical: auditLog.filter(e => e.severity === "critical").length,
      high: auditLog.filter(e => e.severity === "high").length,
      medium: auditLog.filter(e => e.severity === "medium").length,
      low: auditLog.filter(e => e.severity === "low").length,
    },
    byCategory: {
      auth: auditLog.filter(e => e.category === "auth").length,
      data: auditLog.filter(e => e.category === "data").length,
      config: auditLog.filter(e => e.category === "config").length,
      financial: auditLog.filter(e => e.category === "financial").length,
      compliance: auditLog.filter(e => e.category === "compliance").length,
      system: auditLog.filter(e => e.category === "system").length,
    },
    byAction: {
      CREATE: auditLog.filter(e => e.action === "CREATE").length,
      READ: auditLog.filter(e => e.action === "READ").length,
      UPDATE: auditLog.filter(e => e.action === "UPDATE").length,
      DELETE: auditLog.filter(e => e.action === "DELETE").length,
      LOGIN: auditLog.filter(e => e.action === "LOGIN").length,
      LOGOUT: auditLog.filter(e => e.action === "LOGOUT").length,
      EXPORT: auditLog.filter(e => e.action === "EXPORT").length,
      APPROVE: auditLog.filter(e => e.action === "APPROVE").length,
      REJECT: auditLog.filter(e => e.action === "REJECT").length,
      ESCALATE: auditLog.filter(e => e.action === "ESCALATE").length,
    },
  };
}

/**
 * Export audit log as CSV
 */
export function exportAuditCsv(entries: AuditEntry[]): string {
  const headers = [
    "ID",
    "Timestamp",
    "User ID",
    "Role",
    "Action",
    "Resource",
    "Resource ID",
    "Description",
    "Severity",
    "Category",
    "IP Address",
  ];
  const rows = entries.map(e => [
    e.id,
    e.timestamp.toISOString(),
    e.userId || "",
    e.userRole,
    e.action,
    e.resource,
    e.resourceId || "",
    `"${e.description.replace(/"/g, '""')}"`,
    e.severity,
    e.category,
    e.ipAddress,
  ]);
  return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
}

// Seed some initial audit entries
function seedAuditEntries() {
  const actions: AuditEntry["action"][] = [
    "CREATE",
    "UPDATE",
    "LOGIN",
    "APPROVE",
    "REJECT",
    "EXPORT",
  ];
  const resources = [
    "agent",
    "transaction",
    "kyc_document",
    "settlement_batch",
    "fraud_alert",
    "commission_rule",
  ];
  const severities: AuditEntry["severity"][] = [
    "low",
    "medium",
    "high",
    "critical",
  ];
  const categories: AuditEntry["category"][] = [
    "auth",
    "data",
    "financial",
    "compliance",
    "system",
  ];

  for (let i = 0; i < 100; i++) {
    const action = actions[i % actions.length];
    const resource = resources[i % resources.length];
    logAudit({
      userId: `user-${(i % 10) + 1}`,
      userRole: i % 5 === 0 ? "admin" : "agent",
      action,
      resource,
      resourceId: `${resource}-${i + 1}`,
      description: `${action} ${resource} #${i + 1}`,
      ipAddress: `192.168.1.${(i % 254) + 1}`,
      userAgent: "Mozilla/5.0",
      severity: severities[i % severities.length],
      category: categories[i % categories.length],
    });
  }
}

seedAuditEntries();
