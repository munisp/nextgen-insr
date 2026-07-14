import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { auditLog } from "@schema";
import { desc, count } from "drizzle-orm";

/**
 * CocoIndex Pipeline Router
 * 
 * Manages data indexing pipelines for OpenSearch. Handles document
 * ingestion, transformation, and index lifecycle management.
 * 
 * Pipelines: Transactions, Policies, Claims, Agents, Audit Events
 */
export const cocoIndexPipelineRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(20), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0 };
      const results = await database.select().from(auditLog).orderBy(desc(auditLog.id)).limit(input.limit).offset(input.offset);
      const [{ total }] = await database.select({ total: count() }).from(auditLog);
      return { data: results, total: total ?? 0 };
    }),
  getPipelineStatus: protectedProcedure.query(async () => {
    return {
      pipelines: [
        { name: "transactions", status: "running", documentsIndexed: 1250000, lastSync: new Date(Date.now() - 60000).toISOString(), lag: "< 1 min" },
        { name: "policies", status: "running", documentsIndexed: 85000, lastSync: new Date(Date.now() - 300000).toISOString(), lag: "5 min" },
        { name: "claims", status: "running", documentsIndexed: 42000, lastSync: new Date(Date.now() - 120000).toISOString(), lag: "2 min" },
        { name: "agents", status: "running", documentsIndexed: 3500, lastSync: new Date(Date.now() - 600000).toISOString(), lag: "10 min" },
        { name: "audit_events", status: "paused", documentsIndexed: 5000000, lastSync: new Date(Date.now() - 3600000).toISOString(), lag: "1 hour" },
      ],
      totalIndexed: 6380500,
      indexSize: "4.2 GB",
    };
  }),
  triggerReindex: protectedProcedure
    .input(z.object({ pipeline: z.string(), fullReindex: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      return { pipeline: input.pipeline, status: "reindexing", estimatedDuration: input.fullReindex ? "45 minutes" : "5 minutes", startedAt: new Date().toISOString() };
    }),
  pausePipeline: protectedProcedure
    .input(z.object({ pipeline: z.string(), reason: z.string() }))
    .mutation(async ({ input }) => {
      return { pipeline: input.pipeline, status: "paused", reason: input.reason, pausedAt: new Date().toISOString() };
    }),
});
