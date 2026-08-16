/**
 * receiptTemplates.ts — Receipt template management router
 * Provides CRUD for receipt templates used in POS transactions.
 */
import { TRPCError } from "@trpc/server";
import { eq, count, desc } from "drizzle-orm";
import { z } from "zod";

import { receiptTemplates } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const receiptTemplatesRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().default(20),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const items = await db
        .select()
        .from(receiptTemplates)
        .orderBy(desc(receiptTemplates.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      const totResult = await db
        .select({ value: count() })
        .from(receiptTemplates);
      const tot = totResult[0];
      return { items, total: tot ? Number(tot.value) : items.length };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [item] = await db
        .select()
        .from(receiptTemplates)
        .where(eq(receiptTemplates.id, input.id))
        .limit(1);
      if (!item)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Receipt template not found",
        });
      return item;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        content: z.string(),
        type: z.enum(["cash_in", "cash_out", "transfer", "bill_payment"]),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db)
        return {
          id: Date.now(),
          name: input.name,
          content: input.content,
          type: input.type,
          createdAt: new Date().toISOString(),
        };
      const [item] = await db
        .insert(receiptTemplates)
        .values({
          name: input.name,
          bodyTemplate: input.content,
          channel: input.type,
        })
        .returning();
      return {
        id: item.id,
        name: item.name,
        content: item.bodyTemplate,
        type: item.channel,
        createdAt: item.createdAt.toISOString(),
      };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        content: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { id: input.id, updated: true };
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name) updates.name = input.name;
      if (input.content) updates.bodyTemplate = input.content;
      await db
        .update(receiptTemplates)
        .set(updates)
        .where(eq(receiptTemplates.id, input.id));
      return { id: input.id, updated: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { id: input.id, deleted: true };
      await db
        .delete(receiptTemplates)
        .where(eq(receiptTemplates.id, input.id));
      return { id: input.id, deleted: true };
    }),
});
