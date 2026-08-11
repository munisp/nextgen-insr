import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

const notImplemented = () =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: "Live billing dashboard is not implemented yet",
  });

export const liveBillingDashboardRouter = router({
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

  getFinancialModelData: protectedProcedure
    .input(
      z.object({
        clientId: z.string(),
        billingModel: z.string(),
        projectionYears: z.number(),
      })
    )
    .query(async () => {
      throw notImplemented();
    }),

  getRevenueStream: protectedProcedure
    .input(
      z.object({
        clientId: z.string(),
        intervalSeconds: z.number().optional(),
      })
    )
    .query(async () => {
      throw notImplemented();
    }),

  exportForFinancialModel: protectedProcedure
    .input(
      z.object({
        clientId: z.string(),
        format: z.string().default("json"),
      })
    )
    .query(async () => {
      throw notImplemented();
    }),
});
