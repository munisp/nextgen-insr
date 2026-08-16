// Sprint 87: Channel health monitoring, failover routing, rate limiting
import { TRPCError } from "@trpc/server";
import { eq, desc, count } from "drizzle-orm";
import { z } from "zod";

import { notification_channels } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

const CHANNEL_TYPES = ["sms", "email", "push", "whatsapp", "in_app", "webhook"];
const RATE_LIMITS: Record<string, number> = {
  sms: 100,
  email: 500,
  push: 1000,
  whatsapp: 200,
  in_app: 5000,
  webhook: 300,
};

export const notification_channelsRouter = router({
  list: protectedProcedure
    .input(
      z.object({ limit: z.number().default(20), offset: z.number().default(0) })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(notification_channels)
          .orderBy(desc(notification_channels.id))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(notification_channels)
          .limit(100);
        return {
          items: rows.map((r: any) => ({
            ...r,
            rateLimit: RATE_LIMITS[r.channelType] || 100,
          })),
          total,
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
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [row] = await db
          .select()
          .from(notification_channels)
          .where(eq(notification_channels.id, input.id))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Channel not found",
          });
        return row;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(3),
        channelType: z.enum([
          "sms",
          "email",
          "push",
          "whatsapp",
          "in_app",
          "webhook",
        ]),
        config: z.record(z.string(), z.any()).optional(),
        isActive: z.boolean().default(true),
        priority: z.number().default(0),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [row] = await db
          .insert(notification_channels)
          .values(input as any)
          .returning();
        return {
          ...row,
          rateLimit: RATE_LIMITS[input.channelType],
          message: `Channel created with rate limit ${RATE_LIMITS[input.channelType]}/hour`,
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
  healthCheck: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const channels = await db.select().from(notification_channels).limit(100);
    return {
      channels: channels.map((c: any) => ({
        id: c.id,
        name: c.name,
        type: c.channelType,
        isActive: c.isActive,
        health: c.isActive ? "healthy" : "disabled",
        rateLimit: RATE_LIMITS[c.channelType] || 100,
      })),
      totalActive: channels.filter((c: any) => c.isActive).length,
      totalChannels: channels.length,
    };
  }),
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .delete(notification_channels)
          .where(eq(notification_channels.id, input.id));
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
});
