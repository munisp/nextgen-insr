import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, protectedProcedure, router } from "../_core/trpc";

const notImplemented = () =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: "OpenTelemetry tracing is not implemented yet",
  });

export const openTelemetryRouter = router({
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

  dashboard: protectedProcedure.query(async () => {
    throw notImplemented();
  }),
  traceSearch: publicProcedure
    .input(z.object({ query: z.string().optional() }).optional())
    .query(async () => {
      throw notImplemented();
    }),
  serviceMap: protectedProcedure.query(async () => {
    throw notImplemented();
  }),

  searchTraces: protectedProcedure.query(async () => {
    throw notImplemented();
  }),

  serviceHealth: protectedProcedure.query(async () => {
    throw notImplemented();
  }),
});
