import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { z } from "zod";

import {
  webhookEndpoints,
  webhookDeliveries,
  auditLog,
} from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const webhookNotificationsRouter = router({
  listEndpoints: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(webhookEndpoints)
          .orderBy(desc(webhookEndpoints.createdAt))
          .limit(input?.limit ?? 50);
        return { endpoints: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  createEndpoint: protectedProcedure
    .input(
      z.object({
        url: z.string().url(),
        events: z.array(z.string()),
        secret: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [endpoint] = await db
          .insert(webhookEndpoints)
          .values({
            url: input.url,
            events: input.events,
            status: "active",
          } as any)
          .returning();
        await db.insert(auditLog).values({
          action: "webhook_endpoint_created",
          resource: "webhook_endpoints",
          resourceId: String(endpoint.id),
          status: "success",
          metadata: { url: input.url, events: input.events },
        } as any);
        return endpoint;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  deleteEndpoint: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .delete(webhookEndpoints)
          .where(eq(webhookEndpoints.id, input.id));
        await db.insert(auditLog).values({
          action: "webhook_endpoint_deleted",
          resource: "webhook_endpoints",
          resourceId: String(input.id),
          status: "success",
          metadata: {},
        });
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  listDeliveries: protectedProcedure
    .input(
      z
        .object({
          endpointId: z.number().optional(),
          limit: z.number().default(50),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = input?.endpointId
          ? await db
              .select()
              .from(webhookDeliveries)
              .where(eq(webhookDeliveries.endpointId, input.endpointId))
              .orderBy(desc(webhookDeliveries.createdAt))
              .limit(input?.limit ?? 50)
          : await db
              .select()
              .from(webhookDeliveries)
              .orderBy(desc(webhookDeliveries.createdAt))
              .limit(input?.limit ?? 50);
        return { deliveries: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  retryDelivery: protectedProcedure
    .input(z.object({ deliveryId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .update(webhookDeliveries)
          .set({ status: "retrying" })
          .where(eq(webhookDeliveries.id, input.deliveryId));
        await db.insert(auditLog).values({
          action: "webhook_delivery_retried",
          resource: "webhook_deliveries",
          resourceId: String(input.deliveryId),
          status: "success",
          metadata: {},
        });
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getStats: protectedProcedure.query(async () => {
    // F-12 (wave-4b): removed the non-null assertion — honest empty on
    // unavailable db instead of a crash.
    const db = await getDb();
    if (!db) return { totalEndpoints: 0, totalDeliveries: 0 };
    const [totalEndpoints] = await db
      .select({ value: count() })
      .from(webhookEndpoints)
      .limit(100);
    const [totalDeliveries] = await db
      .select({ value: count() })
      .from(webhookDeliveries)
      .limit(100);
    return {
      totalEndpoints: Number(totalEndpoints.value),
      totalDeliveries: Number(totalDeliveries.value),
    };
  }),
  // F-12 (wave-4b): real list from the delivered webhook_deliveries table.
  getDeliveryLog: protectedProcedure
    .input(
      z
        .object({
          endpointId: z.union([z.number(), z.string()]).optional(),
          limit: z.number().min(1).max(100).default(50),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { deliveries: [] };
      const conditions = [];
      if (input?.endpointId != null) {
        conditions.push(eq(webhookDeliveries.endpointId, Number(input.endpointId)));
      }
      const rows = await db
        .select()
        .from(webhookDeliveries)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(webhookDeliveries.id))
        .limit(input?.limit ?? 50);
      return {
        deliveries: rows.map(r => ({
          id: r.id,
          endpointId: r.endpointId,
          eventType: r.eventType,
          status: r.status,
          statusCode: r.statusCode ?? r.responseCode,
          responseTime: r.responseTime,
          attemptCount: r.attemptCount,
          deliveredAt: r.deliveredAt,
          createdAt: r.createdAt,
        })),
      };
    }),
  // F-12 (wave-4b): the honest catalog is the dispatcher's WebhookEventType
  // union — mirrored here so it can never drift from delivery reality.
  // F-12 (wave-4b): real activate/deactivate on webhook_endpoints
  // (own endpoints only).
  toggleWebhook: protectedProcedure
    .input(z.object({ id: z.union([z.number(), z.string()]) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "database unavailable" });
      }
      const [row] = await db
        .select()
        .from(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.id, Number(input.id)),
            eq(webhookEndpoints.createdBy, ctx.user.id)
          )
        )
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "webhook endpoint not found" });
      }
      await db
        .update(webhookEndpoints)
        .set({ isActive: !row.isActive })
        .where(eq(webhookEndpoints.id, row.id));
      return { success: true, isActive: !row.isActive };
    }),

  getSupportedEvents: protectedProcedure.query(async () => {
    const events = [
      "transaction.completed", "transaction.failed", "transaction.reversed",
      "float.low", "float.topup.approved", "float.topup.rejected",
      "kyc.approved", "kyc.rejected", "kyc.document_uploaded",
      "dispute.raised", "dispute.resolved",
      "agent.activated", "agent.suspended", "agent.deactivated",
      "fraud.alert", "settlement.completed",
      "commission.payout.approved", "commission.payout.completed",
    ].map(name => ({ name, category: name.split(".")[0] ?? "other" }));
    return { events };
  }),

  // F-12 (wave-4b): facade (returned a fake evt-id without persisting) —
  // no inbound webhook-ingestion pipeline is delivered. Fail loud.
  ingest: protectedProcedure
    .input(
      z.object({
        source: z.string(),
        event: z.string(),
        payload: z.record(z.string(), z.any()).optional(),
      })
    )
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "ingest: inbound webhook ingestion is not delivered on this platform",
      });
    }),
  // F-12 (wave-4b): real list from the delivered webhook_endpoints table
  // (own endpoints only).
  listConfigs: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { configs: [] };
    const rows = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.createdBy, ctx.user.id))
      .orderBy(desc(webhookEndpoints.id))
      .limit(100);
    return {
      configs: rows.map(r => ({
        id: String(r.id),
        name: r.name,
        url: r.url,
        events: r.events,
        isActive: r.isActive,
        failureCount: r.failureCount,
        lastDeliveryAt: r.lastDeliveryAt,
        lastStatusCode: r.lastStatusCode,
        createdAt: r.createdAt,
      })),
    };
  }),
});
