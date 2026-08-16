// TypeScript enabled — Sprint 96 security audit
import { auditLog } from "../../drizzle/schema";
import { logger } from '../_core/logger';
import { getDb } from "../db";

interface AuditSnapshot {
  agentId: number | string; // numeric FK or string agent code
  action: string;
  resource: string;
  resourceId?: string;
  status: string;
  before?: Record<string, any>;
  after?: Record<string, any>;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Enhanced audit logging with before/after snapshots for change tracking.
 */
export async function writeEnhancedAuditLog(
  entry: AuditSnapshot
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    const changeDetails: Record<string, any> = {
      ...(entry.metadata ?? {}),
    };

    // Calculate diff if before/after provided
    if (entry.before && entry.after) {
      const changes: Record<string, { from: any; to: any }> = {};
      const allKeys = new Set([
        ...Object.keys(entry.before),
        ...Object.keys(entry.after),
      ]);
      for (const key of allKeys) {
        if (
          JSON.stringify(entry.before[key]) !== JSON.stringify(entry.after[key])
        ) {
          changes[key] = { from: entry.before[key], to: entry.after[key] };
        }
      }
      changeDetails.changes = changes;
      changeDetails.changedFields = Object.keys(changes);
    }

    await db.insert(auditLog).values({
      // audit_log.agentId is a numeric FK; string agent codes go to metadata
      agentId: typeof entry.agentId === "number" ? entry.agentId : null,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      status: entry.status as "success" | "warning" | "failure",
      metadata: { ...changeDetails, userAgent: entry.userAgent ?? null, ...(typeof entry.agentId === "string" ? { agentCode: entry.agentId } : {}) },
      ipAddress: entry.ipAddress ?? null,
    });
  } catch (err) {
    logger.error("[AuditEnhanced] Write failed:: " + (err as Error).message);
  }
}
