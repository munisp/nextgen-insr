import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

const notImplemented = () =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: "Revenue reconciliation is not implemented yet",
  });

export const revenueReconciliationRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().default(20),
        offset: z.number().default(0),
        search: z.string().optional(),
      })
    )
    .query(async () => {
      throw notImplemented();
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async () => {
      throw notImplemented();
    }),

  getSummary: protectedProcedure.query(async () => {
    throw notImplemented();
  }),

  getRecent: protectedProcedure
    .input(
      z.object({ days: z.number().default(7), limit: z.number().default(10) })
    )
    .query(async () => {
      throw notImplemented();
    }),

  runReconciliation: protectedProcedure
    .input(
      z.object({
        clientId: z.string(),
        source: z.string(),
        target: z.string(),
        periodHours: z.number(),
      })
    )
    .mutation(async () => {
      throw notImplemented();
    }),

  getBatches: protectedProcedure
    .input(
      z.object({
        clientId: z.string().optional(),
        limit: z.number().default(10),
      })
    )
    .query(async () => {
      throw notImplemented();
    }),

  getDiscrepancies: protectedProcedure
    .input(
      z.object({
        batchId: z.string(),
        page: z.number().default(1),
        pageSize: z.number().default(10),
      })
    )
    .query(async () => {
      throw notImplemented();
    }),

  resolveDiscrepancy: protectedProcedure
    .input(
      z.object({
        entryId: z.string(),
        resolution: z.string(),
        note: z.string().optional(),
      })
    )
    .mutation(async () => {
      throw notImplemented();
    }),

  getMetrics: protectedProcedure
    .input(z.object({}).optional())
    .query(async () => {
      throw notImplemented();
    }),

  getSettlementFileStatus: protectedProcedure
    .input(z.object({ switchProvider: z.string() }))
    .query(async () => {
      throw notImplemented();
    }),
});
