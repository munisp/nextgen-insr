import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";

const notImplemented = () =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: "Ransomware alerts are not implemented yet",
  });

export const ransomwareAlertsRouter = router({
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

  acknowledge: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented();
    }),

  getAlerts: protectedProcedure.query(async () => {
    throw notImplemented();
  }),

  getStats: protectedProcedure.query(async () => {
    throw notImplemented();
  }),

  investigate: protectedProcedure.query(async () => {
    throw notImplemented();
  }),

  resolve: protectedProcedure.query(async () => {
    throw notImplemented();
  }),
  getAlertDetail: protectedProcedure
    .input(z.object({ alertId: z.string() }))
    .query(async () => {
      throw notImplemented();
    }),
});
