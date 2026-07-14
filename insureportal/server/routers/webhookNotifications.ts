import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { eq, desc, and, sql, count } from "drizzle-orm";
import {
  webhookEndpoints,
  webhookDeliveries,
  auditLog,
} from "@schema";
import { TRPCError } from "@trpc/server";

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
    const db = (await getDb())!;
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
  getDeliveryLog: protectedProcedure
    .input(
      z
        .object({
          webhookId: z.string().optional(),
          limit: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return {
        deliveries: [] as Array<{
          id: string;
          webhookId: string;
          status: string;
          responseCode: number;
          timestamp: string;
        }>,
        total: 0,
      };
    }),
  getSupportedEvents: protectedProcedure.query(async () => {
    return {
      events: [] as Array<{
        name: string;
        description: string;
        category: string;
      }>,
    };
  }),
  ingest: protectedProcedure
    .input(
      z.object({
        source: z.string(),
        event: z.string(),
        payload: z.record(z.string(), z.any()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      return { received: true, eventId: `evt-${Date.now()}` };
    }),
  listConfigs: protectedProcedure.query(async () => {
    return {
      configs: [] as Array<{
        id: string;
        url: string;
        events: string[];
        active: boolean;
        createdAt: string;
      }>,
      total: 0,
    };
  }),
  toggleWebhook: protectedProcedure
    .input(z.object({ webhookId: z.string(), active: z.boolean() }))
    .mutation(async ({ input }) => {
      return {
        success: true,
        webhookId: input.webhookId,
        active: input.active,
      };
    }),
});
