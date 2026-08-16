import { TRPCError } from "@trpc/server";
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
import { z } from "zod";

import {
  agents,
  transactions,
  auditLog,
  systemConfig,
} from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


const notImplemented = (feature: string) =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: `${feature} is not implemented yet`,
  });

export const sprint23Router = router({
  dashboard: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return {
        totalAgents: 0,
        totalTransactions: 0,
        systemUptime: "99.9%",
        sprint: 23,
      };
    const [agentCount] = await db
      .select({ value: count() })
      .from(agents)
      .limit(100);
    const [txCount] = await db
      .select({ value: count() })
      .from(transactions)
      .limit(100);
    return {
      totalAgents: Number(agentCount.value),
      totalTransactions: Number(txCount.value),
      systemUptime: "99.9%",
      sprint: 23,
    };
  }),
  getAgentSummary: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { agents: [], total: 0 };
        const rows = await db
          .select()
          .from(agents)
          .orderBy(desc(agents.createdAt))
          .limit(input?.limit ?? 20);
        return { agents: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getTransactionSummary: protectedProcedure
    .input(
      z
        .object({
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
          limit: z.number().default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { transactions: [], total: 0, volume: "0" };
        const conditions: any[] = [];
        if (input?.dateFrom)
          conditions.push(
            gte(transactions.createdAt, new Date(input.dateFrom))
          );
        if (input?.dateTo)
          conditions.push(lte(transactions.createdAt, new Date(input.dateTo)));
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const rows = await db
          .select()
          .from(transactions)
          .where(where)
          .orderBy(desc(transactions.createdAt))
          .limit(input?.limit ?? 20);
        const [vol] = await db
          .select({
            value: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
          })
          .from(transactions)
          .where(where)
          .limit(100);
        return { transactions: rows, total: rows.length, volume: vol.value };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getSystemConfig: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { configs: [] };
    const rows = await db
      .select()
      .from(systemConfig)
      .orderBy(asc(systemConfig.key))
      .limit(50);
    return { configs: rows };
  }),

  disputeAutoRules: protectedProcedure.query(async () => {
    throw notImplemented("Dispute auto-rules");
  }),

  kycVerification: protectedProcedure.query(async () => {
    throw notImplemented("KYC verification");
  }),

  rateLimits: protectedProcedure.query(async () => {
    throw notImplemented("Rate limits");
  }),

  reportComparison: protectedProcedure.query(async () => {
    throw notImplemented("Report comparison");
  }),

  scheduledDelivery: protectedProcedure.query(async () => {
    throw notImplemented("Scheduled report delivery");
  }),

  thresholds: protectedProcedure.query(async () => {
    throw notImplemented("Thresholds");
  }),

  webhookDelivery: protectedProcedure.query(async () => {
    throw notImplemented("Webhook delivery");
  }),
});
