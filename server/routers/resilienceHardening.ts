import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";

const notImplemented = () =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: "Resilience hardening configuration is not implemented yet",
  });

export const resilienceHardeningRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
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
      z.object({
        days: z.number().min(1).max(90).default(7),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async () => {
      throw notImplemented();
    }),
  getConnectionProfile: protectedProcedure.query(async () => {
    throw notImplemented();
  }),
  getWebSocketConfig: protectedProcedure.query(async () => {
    throw notImplemented();
  }),
  getOfflineQueueStatus: protectedProcedure.query(async () => {
    throw notImplemented();
  }),
  getCompressionConfig: protectedProcedure.query(async () => {
    throw notImplemented();
  }),
  getDegradationConfig: protectedProcedure.query(async () => {
    throw notImplemented();
  }),
  getResilienceMetrics: protectedProcedure.query(async () => {
    throw notImplemented();
  }),
  getServiceWorkerConfig: protectedProcedure.query(async () => {
    throw notImplemented();
  }),
});
