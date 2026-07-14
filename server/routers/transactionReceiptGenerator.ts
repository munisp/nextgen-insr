// @ts-check
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  eq,
  desc,
  and,
  sql,
  count,
  sum,
  isNull,
  gte,
  lte,
  or,
  asc,
} from "drizzle-orm";
import { transactions, auditLog, systemConfig } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

export const transactionReceiptGeneratorRouter = router({
  dashboard: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return {
        totalTemplates: 0,
        totalGenerated: 0,
        thermalReceipts: 0,
        emailReceipts: 0,
      };
    const rows = await db
      .select()
      .from(systemConfig)
      .where(sql`\${systemConfig.key} LIKE 'receipt_template_%'`)
      .limit(100);
    return {
      totalTemplates: rows.length,
      totalGenerated: 0,
      thermalReceipts: 0,
      emailReceipts: 0,
    };
  }),
  listTemplates: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { templates: [], total: 0 };
        const rows = await db
          .select()
          .from(systemConfig)
          .where(sql`\${systemConfig.key} LIKE 'receipt_template_%'`)
          .limit(input?.limit ?? 20);
        return {
          templates: rows.map(r => ({
            id: r.key.replace("receipt_template_", ""),
            ...JSON.parse(String(r.value ?? "{}")),
          })),
          total: rows.length,
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
  createTemplate: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        type: z.enum(["thermal", "email", "sms", "pdf"]),
        format: z.string().optional(),
        fields: z.array(z.string()),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const templateId = "TPL-" + crypto.randomUUID().toUpperCase();
        await db.insert(systemConfig).values({
          key: "receipt_template_" + templateId,
          value: JSON.stringify({
            ...input,
            active: true,
            usageCount: 0,
            createdAt: new Date().toISOString(),
          }),
        });
        return { success: true, templateId };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  generateReceipt: protectedProcedure
    .input(
      z.object({ transactionId: z.number(), templateId: z.string().optional() })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const txRows = await db
          .select()
          .from(transactions)
          .where(eq(transactions.id, input.transactionId))
          .limit(1);
        if (txRows.length === 0)
          return { success: false, error: "Transaction not found" };
        const tx = txRows[0];
        const receiptId = "RCT-" + crypto.randomUUID().toUpperCase();
        await db.insert(auditLog).values({
          action: "receipt_generated",
          resource: "receipts",
          resourceId: receiptId,
          status: "success",
          metadata: {
            transactionId: input.transactionId,
            amount: tx.amount,
            type: tx.type,
          },
        });
        return {
          success: true,
          receiptId,
          receipt: {
            id: receiptId,
            transactionId: input.transactionId,
            amount: tx.amount,
            type: tx.type,
            generatedAt: new Date().toISOString(),
          },
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

  getStats: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database)
      return {
        total: 0,
        active: 0,
        recent: 0,
        lastUpdated: new Date().toISOString(),
      };
    try {
      await database.execute(sql`SELECT 1 as ok`);
      return {
        total: 0,
        active: 0,
        recent: 0,
        lastUpdated: new Date().toISOString(),
      };
    } catch {
      return {
        total: 0,
        active: 0,
        recent: 0,
        lastUpdated: new Date().toISOString(),
      };
    }
  }),
});
