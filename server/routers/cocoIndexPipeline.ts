import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../_core/trpc";

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
    .query(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "Indexing pipeline management is not implemented yet",
      });
    }),
  getPipelineStatus: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "Indexing pipeline status is not implemented yet",
    });
  }),
  triggerReindex: protectedProcedure
    .input(z.object({ pipeline: z.string(), fullReindex: z.boolean().default(false) }))
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "Reindexing is not implemented yet",
      });
    }),
  pausePipeline: protectedProcedure
    .input(z.object({ pipeline: z.string(), reason: z.string() }))
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "Pipeline pausing is not implemented yet",
      });
    }),
});
