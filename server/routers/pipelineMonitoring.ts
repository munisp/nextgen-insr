import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";

const notImplemented = () =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: "Pipeline monitoring is not implemented yet",
  });

export const pipelineMonitoringRouter = router({
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

  dashboard: protectedProcedure.query(
    async (): Promise<{
      healthScore: number;
      activeAlerts: number;
      resolvedToday: number;
      slaBreaches: number;
      services: Array<{ name: string; status: string; [k: string]: unknown }>;
    }> => {
      throw notImplemented();
    }
  ),

  getStats: protectedProcedure.query(async () => {
    throw notImplemented();
  }),

  activeAlerts: protectedProcedure.query(
    async (): Promise<{ alerts: Array<Record<string, unknown>> }> => {
      throw notImplemented();
    }
  ),

  slaStatus: protectedProcedure.query(async () => {
    throw notImplemented();
  }),
});
