// @ts-check
import { TRPCError } from "@trpc/server";
/**
 * F03: Multi-Channel Notification Orchestrator
 * SMS/Email/Push/WhatsApp unified dispatch, delivery tracking, template engine, retry logic
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { notificationDispatchLog } from "../../drizzle/schema";
import { eq, desc, and, gte, count, sql } from "drizzle-orm";

const MAX_RETRIES = 3;
const RETRY_DELAYS = [60, 300, 900]; // seconds: 1min, 5min, 15min

// Notification templates
const TEMPLATES: Record<string, { subject: string; body: string }> = {
  tx_success: {
    subject: "Transaction Successful",
    body: "Your transaction of {{amount}} was successful. Ref: {{ref}}",
  },
  tx_failed: {
    subject: "Transaction Failed",
    body: "Your transaction of {{amount}} failed. Reason: {{reason}}",
  },
  float_low: {
    subject: "Low Float Alert",
    body: "Your float balance is {{balance}}. Please top up.",
  },
  kyc_approved: {
    subject: "KYC Approved",
    body: "Your KYC verification has been approved.",
  },
  loan_disbursed: {
    subject: "Loan Disbursed",
    body: "Your loan of {{amount}} has been disbursed.",
  },
  commission_paid: {
    subject: "Commission Credited",
    body: "Commission of {{amount}} credited to your account.",
  },
  security_alert: {
    subject: "Security Alert",
    body: "Unusual activity detected on your account. {{details}}",
  },
  welcome: {
    subject: "Welcome to POS Shell",
    body: "Welcome {{name}}! Your account is ready.",
  },
};

export const notificationOrchestratorRouter = router({
  // List notifications with filtering
  list: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        channel: z
          .enum(["sms", "email", "push", "whatsapp", "in_app"])
          .optional(),
        status: z
          .enum(["queued", "sent", "delivered", "failed", "bounced"])
          .optional(),
        recipientType: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { items: [], total: 0 };
        const conditions = [];
        if (input.channel)
          conditions.push(eq(notificationDispatchLog.channel, input.channel));
        if (input.status)
          conditions.push(eq(notificationDispatchLog.status, input.status));
        if (input.recipientType)
          conditions.push(
            eq(notificationDispatchLog.recipientType, input.recipientType)
          );
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const items = await db
          .select()
          .from(notificationDispatchLog)
          .where(where)
          .orderBy(desc(notificationDispatchLog.createdAt))
          .limit(input.limit)
          .offset((input.page - 1) * input.limit);
        const [{ total }] = await db
          .select({ total: count() })
          .from(notificationDispatchLog)
          .where(where)
          .limit(100);
        return { items, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Send notification via specified channel
  send: protectedProcedure
    .input(
      z.object({
        recipientId: z.number(),
        recipientType: z.enum(["agent", "customer", "merchant", "admin"]),
        channel: z.enum(["sms", "email", "push", "whatsapp", "in_app"]),
        templateId: z.string().optional(),
        subject: z.string().optional(),
        body: z.string(),
        // @ts-expect-error auto-fix
        metadata: z.record(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        let subject = input.subject;
        let body = input.body;
        // Apply template if specified
        if (input.templateId && TEMPLATES[input.templateId]) {
          const tmpl = TEMPLATES[input.templateId];
          subject = tmpl.subject;
          body = tmpl.body;
          if (input.metadata) {
            for (const [key, value] of Object.entries(input.metadata)) {
              // @ts-expect-error auto-fix
              body = body.replace(`{{${key}}}`, value);
              // @ts-expect-error auto-fix
              subject = subject.replace(`{{${key}}}`, value);
            }
          }
        }
        const [notification] = await db
          .insert(notificationDispatchLog)
          .values({
            recipientId: input.recipientId,
            recipientType: input.recipientType,
            channel: input.channel,
            templateId: input.templateId,
            subject,
            body,
            status: "queued",
            maxRetries: MAX_RETRIES,
            metadata: input.metadata ? JSON.stringify(input.metadata) : null,
          } as any)
          .returning();
        return { notification, queued: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Bulk send notifications
  bulkSend: protectedProcedure
    .input(
      z.object({
        recipientIds: z.array(z.number()),
        recipientType: z.enum(["agent", "customer", "merchant", "admin"]),
        channel: z.enum(["sms", "email", "push", "whatsapp", "in_app"]),
        templateId: z.string(),
        // @ts-expect-error auto-fix
        metadata: z.record(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        const tmpl = TEMPLATES[input.templateId];
        if (!tmpl) throw new Error(`Template ${input.templateId} not found`);
        const records = input.recipientIds.map(recipientId => ({
          recipientId,
          recipientType: input.recipientType,
          channel: input.channel,
          templateId: input.templateId,
          subject: tmpl.subject,
          body: tmpl.body,
          status: "queued" as const,
          maxRetries: MAX_RETRIES,
          metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        }));
        await db.insert(notificationDispatchLog).values(records as any);
        return { queued: records.length, template: input.templateId };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Retry failed notification
  retry: protectedProcedure
    .input(z.object({ notificationId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        const [notif] = await db
          .select()
          .from(notificationDispatchLog)
          .where(eq(notificationDispatchLog.id, input.notificationId))
          .limit(100);
        if (!notif) throw new Error("Notification not found");
        if ((notif.retryCount || 0) >= MAX_RETRIES)
          throw new Error("Max retries exceeded");
        const retryDelay = RETRY_DELAYS[notif.retryCount || 0] || 900;
        await db
          .update(notificationDispatchLog)
          .set({
            status: "queued",
            retryCount: (notif.retryCount || 0) + 1,
            nextRetryAt: new Date(Date.now() + retryDelay * 1000),
            failureReason: null,
          })
          .where(eq(notificationDispatchLog.id, input.notificationId));
        return { success: true, nextRetryIn: retryDelay };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Delivery statistics
  deliveryStats: protectedProcedure
    .input(z.object({ period: z.enum(["24h", "7d", "30d"]).default("7d") }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          return { byChannel: [], byStatus: [], deliveryRate: 0, totalSent: 0 };
        const periodHours = { "24h": 24, "7d": 168, "30d": 720 };
        const since = new Date(
          Date.now() - periodHours[input.period] * 3600000
        );
        const byChannel = await db
          .select({
            channel: notificationDispatchLog.channel,
            count: count(),
          })
          .from(notificationDispatchLog)
          .where(gte(notificationDispatchLog.createdAt, since))
          .groupBy(notificationDispatchLog.channel);
        const byStatus = await db
          .select({
            status: notificationDispatchLog.status,
            count: count(),
          })
          .from(notificationDispatchLog)
          .where(gte(notificationDispatchLog.createdAt, since))
          .groupBy(notificationDispatchLog.status);
        const totalSent = byStatus.reduce(
          (sum: any, s: any) => sum + s.count,
          0
        );
        const delivered =
          byStatus.find(s => s.status === "delivered")?.count || 0;
        return {
          byChannel,
          byStatus,
          deliveryRate: totalSent > 0 ? (delivered / totalSent) * 100 : 0,
          totalSent,
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

  // List available templates
  templates: protectedProcedure.query(() => {
    return Object.entries(TEMPLATES).map(([id, tmpl]) => ({ id, ...tmpl }));
  }),
});
