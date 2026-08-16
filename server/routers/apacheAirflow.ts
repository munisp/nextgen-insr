import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, protectedProcedure, router } from "../_core/trpc";

const notImplemented = () =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: "Apache Airflow integration is not implemented yet",
  });

export const apacheAirflowRouter = router({
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

  dashboard: protectedProcedure.query(async (): Promise<{ overview: { activeDags: number; totalTaskInstances: number; avgSuccessRate: number; failedTasks24h: number }; dagsByTag: Array<Record<string, unknown>>; recentFailures: Array<Record<string, unknown>>; dags: Array<Record<string, unknown>> }> => {
      throw notImplemented();
    }),
  listDags: protectedProcedure.query(async (): Promise<{ dags: Array<Record<string, unknown>> }> => {
      throw notImplemented();
    }),
  triggerDag: publicProcedure
    .input(z.object({ dagId: z.string() }))
    .mutation(async () => {
      throw notImplemented();
    }),
  getDag: protectedProcedure
    .input(z.object({ id: z.string().optional() }).default({}))
    .query(async () => {
      throw notImplemented();
    }),
  toggleDag: protectedProcedure
    .input(z.object({ id: z.string().optional() }).default({}))
    .mutation(async () => {
      throw notImplemented();
    }),
  listTaskInstances: protectedProcedure
    .input(z.object({ id: z.string().optional() }).default({}))
    .query(async () => {
      throw notImplemented();
    }),
  platformValue: protectedProcedure
    .input(z.object({ id: z.string().optional() }).default({}))
    .query(async () => {
      throw notImplemented();
    }),
});
