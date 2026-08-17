import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../_core/trpc";

const notImplemented = () =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: "Apache NiFi integration is not implemented yet",
  });

export const apacheNifiRouter = router({
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

  // F-12 (wave-4b): zero-payload dashboard (fake health check then
  // unconditional zeros) — no NiFi integration is delivered. Fail loud.
  dashboard: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "dashboard: no NiFi integration is delivered",
    });
  }),
  listProcessGroups: protectedProcedure
    .input(z.object({ id: z.string().optional() }).default({}))
    .query(async () => {
      throw notImplemented();
    }),
  instantiateTemplate: protectedProcedure
    .input(z.object({ id: z.string().optional() }).default({}))
    .mutation(async () => {
      throw notImplemented();
    }),
  startProcessGroup: protectedProcedure
    .input(z.object({ id: z.string().optional() }).default({}))
    .mutation(async () => {
      throw notImplemented();
    }),
  stopProcessGroup: protectedProcedure
    .input(z.object({ id: z.string().optional() }).default({}))
    .mutation(async () => {
      throw notImplemented();
    }),
  platformIntegration: protectedProcedure
    .input(z.object({ id: z.string().optional() }).default({}))
    .query(async () => {
      throw notImplemented();
    }),
});
