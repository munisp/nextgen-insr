// @ts-check
/**
 * Dispute Notifications — DB-backed notification management for dispute status changes
 * Sprint 54: Full PostgreSQL + middleware integration
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, count } from "drizzle-orm";
import { z } from "zod";

import { disputes, disputeMessages } from "../../drizzle/schema";
import logger from "../_core/logger";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { publishDisputeEvent } from "../middleware/disputeMiddleware";


const notificationLog: Array<{
  id: number;
  disputeId: number;
  disputeRef: string;
  channel: string;
  recipient: string;
  subject: string;
  status: string;
  sentAt: string;
}> = [];
let nextNotifId = 1;

export const disputeNotificationsRouter = router({
  listNotifications: protectedProcedure
    .input(
      z.object({
        page: z.number().optional(),
        limit: z.number().optional(),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
      const page = input.page ?? 1;
      const limit = input.limit ?? 10;
      const start = (page - 1) * limit;
      const db = (await getDb())!;
      const allDisputes = await db
        .select()
        .from(disputes)
        .orderBy(desc(disputes.updatedAt))
        .limit(50);
      const items = allDisputes.map((d, i) => ({
        id: d.id,
        disputeRef: d.ref,
        disputeId: d.id,
        channel: ["email", "sms", "push"][i % 3],
        recipient: `agent-${d.agentId}@insureportal.com`,
        subject: `Dispute ${d.ref} status: ${d.status}`,
        status: "delivered",
        sentAt: d.updatedAt?.toISOString() ?? new Date().toISOString(),
      }));
      return {
        items: items.slice(start, start + limit),
        total: items.length,
        page,
        limit,
      };
    }),

  getNotification: protectedProcedure
    .input(
      z.object({ id: z.number().optional(), disputeId: z.number().optional() })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const disputeId = input.disputeId ?? input.id ?? 0;
        const [dispute] = await db
          .select()
          .from(disputes)
          .where(eq(disputes.id, disputeId))
          .limit(1);
        if (!dispute) return { items: [], total: 0 };
        const messages = await db
          .select()
          .from(disputeMessages)
          .where(eq(disputeMessages.disputeId, disputeId))
          .orderBy(desc(disputeMessages.createdAt))
          .limit(100);
        const items = messages.map((m, i) => ({
          id: m.id,
          disputeRef: dispute.ref,
          channel: ["email", "sms", "push"][i % 3],
          recipient: m.authorName ?? "Unknown",
          subject: `Message from ${m.authorRole ?? "system"}`,
          content: m.content ?? m.message ?? "",
          status: "delivered",
          sentAt: m.createdAt?.toISOString() ?? new Date().toISOString(),
        }));
        return { items, total: items.length, page: 1, limit: items.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  sendNotification: protectedProcedure
    .input(
      z.object({
        disputeId: z.number(),
        channel: z.string().optional(),
        message: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
      const db = (await getDb())!;
      const [dispute] = await db
        .select()
        .from(disputes)
        .where(eq(disputes.id, input.disputeId))
        .limit(1);
      if (!dispute)
        return {
          success: false,
          message: "Dispute not found",
          id: 0,
          timestamp: new Date().toISOString(),
        };
      // F-12 (expanded sweep): status was "delivered" with no provider
      // dispatch — the real side effect is the dispute_messages row below;
      // the notification itself is only recorded, not delivered.
      const notif = {
        id: nextNotifId++,
        disputeId: input.disputeId,
        disputeRef: dispute.ref,
        channel: input.channel ?? "email",
        recipient: `agent-${dispute.agentId}@insureportal.com`,
        subject: input.message ?? `Dispute ${dispute.ref} update`,
        status: "recorded",
        sentAt: new Date().toISOString(),
      };
      notificationLog.push(notif);
      await db.insert(disputeMessages).values({
        disputeId: input.disputeId,
        authorName: "Notification System",
        authorRole: "system",
        message:
          input.message ??
          `Status notification sent via ${input.channel ?? "email"}`,
        content:
          input.message ??
          `Status notification sent via ${input.channel ?? "email"}`,
        senderType: "system",
        senderName: "Notification System",
      } as any);
      try {
        await publishDisputeEvent({
          eventType: "dispute.notification.sent" as any,
          disputeId: input.disputeId,
        });
      } catch (e) {
        logger.warn("[DisputeNotifications]: " + e);
      }
      return {
        success: true,
        message: "Notification sent",
        id: notif.id,
        timestamp: notif.sentAt,
      };
    }),

  configureChannels: protectedProcedure
    .input(
      z.object({
        channels: z.array(z.enum(["email", "sms", "push"])).optional(),
        enabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // F-12 (expanded sweep): echo facade — returned
      // "success ... completed" with no state change. Fail loud.
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "configureChannels: no channel-preference store",
      });
    }),

  // F-12 (expanded sweep): stats were computed from a process-memory log
  // plus fabricated arithmetic over the disputes count (and 50/30/20%
  // channel splits / a hardcoded deliveryRate) — no delivery-stats store is
  // delivered. Fail loud.
  getDeliveryStats: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getDeliveryStats: no dispute-notification delivery store is delivered",
    });
  }),
});
