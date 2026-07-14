// @ts-nocheck
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { eq, desc, sql, count } from "drizzle-orm";
import {
  apiKeys,
  apiKeyUsage,
  commissionRules,
  auditLog,
} from "@schema";
import { TRPCError } from "@trpc/server";

export const partnerSelfServiceRouter = router({
  getApiKeys: protectedProcedure
    .input(z.object({ partnerId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(apiKeys)
          .orderBy(desc(apiKeys.createdAt))
          .limit(20);
        return { apiKeys: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  createApiKey: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        permissions: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [key] = await db
          .insert(apiKeys)
          .values({
            name: input.name,
            key: "pk_" + crypto.randomUUID().replace(/-/g, ""),
            status: "active",
          } as any)
          .returning();
        await db.insert(auditLog).values({
          action: "partner_api_key_created",
          resource: "api_keys",
          resourceId: String(key.id),
          status: "success",
          metadata: { name: input.name },
        } as any);
        return key;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  revokeApiKey: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .update(apiKeys)
          .set({ status: "revoked" })
          .where(eq(apiKeys.id, input.id));
        await db.insert(auditLog).values({
          action: "partner_api_key_revoked",
          resource: "api_keys",
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
  getUsage: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(apiKeyUsage)
          .orderBy(desc(apiKeyUsage.createdAt))
          .limit(input?.limit ?? 50);
        return { usage: rows, total: rows.length };
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
    const [totalKeys] = await db
      .select({ value: count() })
      .from(apiKeys)
      .limit(100);
    const [activeKeys] = await db
      .select({ value: count() })
      .from(apiKeys)
      .where(eq(apiKeys.status, "active"))
      .limit(100);
    return {
      totalKeys: Number(totalKeys.value),
      activeKeys: Number(activeKeys.value),
    };
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
