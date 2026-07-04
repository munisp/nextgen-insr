// TypeScript enabled — Sprint 96 security audit
import { getDb } from "../db";
import { auditLog } from "../../drizzle/schema";
import { logger } from '../_core/logger';

interface AuditSnapshot {
  agentId: number;
  agentId: string;
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
      agentId: entry.agentId,
      agentId: entry.agentId,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      status: entry.status as "success" | "warning" | "failure",
      metadata: changeDetails,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    });
  } catch (err) {
    logger.error("[AuditEnhanced] Write failed:: " + (err as Error).message);
  }
}
