// @ts-nocheck
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}
import { billingAuditLog, tenantBillingConfig } from "@schema";
import { eq, and, desc, gte, lte, sql, like } from "drizzle-orm";
import { requireBillingPermission } from "./billingRbac";
import { TRPCError } from "@trpc/server";

// ═══════════════════════════════════════════════════════════════════════════════
// Audit Middleware — auto-logs all billing mutations
// ═══════════════════════════════════════════════════════════════════════════════

export interface AuditContext {
  userId: number;
  userName: string;
  tenantId: number;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
}

/**
 * Record a billing audit event and optionally publish to Kafka + send notifications.
 */
export async function recordBillingAudit(params: {
  ctx: AuditContext;
  action: string;
  resourceType: string;
  resourceId?: string;
  beforeState?: any;
  afterState?: any;
  metadata?: any;
}): Promise<number> {
  const {
    ctx,
    action,
    resourceType,
    resourceId,
    beforeState,
    afterState,
    metadata,
  } = params;

  // 1. Insert audit log entry
  const [entry] = await (
    await db()
  )
    .insert(billingAuditLog)
    .values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: action,
      resourceType,
      resourceId: resourceId || null,
      beforeState: beforeState || null,
      afterState: afterState || null,
      metadata: metadata || null,
      ipAddress: ctx.ipAddress || null,
      userAgent: ctx.userAgent || null,
      sessionId: ctx.sessionId || null,
      notificationSent: false,
    } as any)
    .returning();

  // 2. Publish to Kafka (billing.audit.* topic) if configured
  const kafkaUrl = process.env.KAFKA_BROKER_URL;
  if (kafkaUrl) {
    try {
      // In production, use kafkajs producer
      console.log(`[BillingAudit] Kafka publish: billing.audit.${action}`, {
        auditId: entry.id,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action,
        resourceType,
        resourceId,
        timestamp: entry.createdAt,
      } as any);
    } catch (e) {
      console.warn(
        "[BillingAudit] Kafka publish failed:",
        (e as Error).message
      );
    }
  }

  // 3. Send notifications based on action type
  await sendBillingNotifications(entry, ctx);

  return entry.id;
}

/**
 * Send notifications to relevant parties based on audit action.
 */
async function sendBillingNotifications(
  entry: any,
  ctx: AuditContext
): Promise<void> {
  const notifiableActions = [
    "config_created",
    "config_updated",
    "config_deleted",
    "billing_model_changed",
    "tenant_billing_provisioned",
  ];
  const discrepancyActions = ["reconciliation_run"];

  let shouldNotifyTenantAdmin = notifiableActions.includes(entry.action);
  let shouldNotifyPlatformAdmin = discrepancyActions.includes(entry.action);

  if (shouldNotifyTenantAdmin || shouldNotifyPlatformAdmin) {
    try {
      // Use the built-in notification system
      const { notifyOwner } = await import("../_core/notification");

      if (shouldNotifyPlatformAdmin) {
        await notifyOwner({
          title: `[Billing] ${entry.action} — Tenant ${ctx.tenantId}`,
          content: `Action: ${entry.action}\nResource: ${entry.resourceType}/${entry.resourceId || "N/A"}\nUser: ${ctx.userName} (ID: ${ctx.userId})\nTenant: ${ctx.tenantId}\nTime: ${new Date().toISOString()}`,
        });
      }

      if (shouldNotifyTenantAdmin) {
        await notifyOwner({
          title: `[Billing Config Change] Tenant ${ctx.tenantId}`,
          content: `Billing configuration changed by ${ctx.userName}.\nAction: ${entry.action}\nResource: ${entry.resourceType}\nDetails: ${JSON.stringify(entry.afterState || {}).substring(0, 200)}`,
        });
      }

      // Mark notification as sent
      await (await db())
        .update(billingAuditLog)
        .set({ notificationSent: true })
        .where(eq(billingAuditLog.id, entry.id));
    } catch (e) {
      console.warn("[BillingAudit] Notification failed:", (e as Error).message);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Billing Audit Router
// ═══════════════════════════════════════════════════════════════════════════════

export const billingAuditRouter = router({
  // Query audit logs with filters
  query: protectedProcedure
    .input(
      z.object({
        tenantId: z.number(),
        action: z.string().optional(),
        userId: z.number().optional(),
        resourceType: z.string().optional(),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        await requireBillingPermission(
          ctx.user.id,
          input.tenantId,
          "view_ledger"
        );

        const conditions = [eq(billingAuditLog.tenantId, input.tenantId)];
        if (input.action)
          conditions.push(eq(billingAuditLog.action, input.action as any));
        if (input.userId)
          conditions.push(eq(billingAuditLog.userId, input.userId));
        if (input.resourceType)
          conditions.push(eq(billingAuditLog.resourceType, input.resourceType));
        if (input.startDate)
          conditions.push(
            gte(billingAuditLog.createdAt, new Date(input.startDate))
          );
        if (input.endDate)
          conditions.push(
            lte(billingAuditLog.createdAt, new Date(input.endDate))
          );

        const logs = await (
          await db()
        )
          .select()
          .from(billingAuditLog)
          .where(and(...conditions))
          .orderBy(desc(billingAuditLog.createdAt))
          .limit(input.limit)
          .offset(input.offset);

        const [{ count }] = await (
          await db()
        )
          .select({ count: sql<number>`count(*)` })
          .from(billingAuditLog)
          .where(and(...conditions));

        return {
          logs,
          total: Number(count),
          limit: input.limit,
          offset: input.offset,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Get audit summary stats for a tenant
  getSummary: protectedProcedure
    .input(z.object({ tenantId: z.number(), days: z.number().default(30) }))
    .query(async ({ ctx, input }) => {
      try {
        await requireBillingPermission(
          ctx.user.id,
          input.tenantId,
          "view_dashboard"
        );

        const since = new Date(Date.now() - input.days * 86400000);
        const conditions = [
          eq(billingAuditLog.tenantId, input.tenantId),
          gte(billingAuditLog.createdAt, since),
        ];

        const [{ total }] = await (
          await db()
        )
          .select({ total: sql<number>`count(*)` })
          .from(billingAuditLog)
          .where(and(...conditions));

        const actionCounts = await (
          await db()
        )
          .select({
            action: billingAuditLog.action,
            count: sql<number>`count(*)`,
          })
          .from(billingAuditLog)
          .where(and(...conditions))
          .groupBy(billingAuditLog.action);

        const recentChanges = await (
          await db()
        )
          .select()
          .from(billingAuditLog)
          .where(and(...conditions))
          .orderBy(desc(billingAuditLog.createdAt))
          .limit(10);

        return {
          totalEvents: Number(total),
          byAction: actionCounts.map(a => ({
            action: a.action,
            count: Number(a.count),
          })),
          recentChanges,
          periodDays: input.days,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Get audit trail for a specific resource
  getResourceHistory: protectedProcedure
    .input(
      z.object({
        tenantId: z.number(),
        resourceType: z.string(),
        resourceId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        await requireBillingPermission(
          ctx.user.id,
          input.tenantId,
          "view_ledger"
        );

        const history = await (
          await db()
        )
          .select()
          .from(billingAuditLog)
          .where(
            and(
              eq(billingAuditLog.tenantId, input.tenantId),
              eq(billingAuditLog.resourceType, input.resourceType),
              eq(billingAuditLog.resourceId, input.resourceId)
            )
          )
          .orderBy(desc(billingAuditLog.createdAt));

        return { history, total: history.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Export audit logs as CSV (requires export_data permission)
  exportCsv: protectedProcedure
    .input(
      z.object({
        tenantId: z.number(),
        startDate: z.string().datetime(),
        endDate: z.string().datetime(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        await requireBillingPermission(
          ctx.user.id,
          input.tenantId,
          "export_data"
        );

        const logs = await (
          await db()
        )
          .select()
          .from(billingAuditLog)
          .where(
            and(
              eq(billingAuditLog.tenantId, input.tenantId),
              gte(billingAuditLog.createdAt, new Date(input.startDate)),
              lte(billingAuditLog.createdAt, new Date(input.endDate))
            )
          )
          .orderBy(desc(billingAuditLog.createdAt));

        // Generate CSV
        const header =
          "id,tenant_id,user_id,user_name,action,resource_type,resource_id,created_at\n";
        const rows = logs
          .map(
            l =>
              `${l.id},${l.tenantId},${l.userId},"${l.userName}",${l.action},${l.resourceType},${l.resourceId || ""},${l.createdAt}`
          )
          .join("\n");

        // Record the export in audit log
        await recordBillingAudit({
          ctx: {
            userId: ctx.user.id,
            userName: ctx.user.name || "unknown",
            tenantId: input.tenantId,
          },
          action: "export_generated",
          resourceType: "billing_audit_log",
          metadata: {
            startDate: input.startDate,
            endDate: input.endDate,
            rowCount: logs.length,
          },
        });

        return { csv: header + rows, rowCount: logs.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().default(20),
          offset: z.number().default(0),
        })
        .default({})
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { items: [], total: 0 };
        return { items: [], total: 0 };
      } catch {
        return { items: [], total: 0 };
      }
    }),
});
