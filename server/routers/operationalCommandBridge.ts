import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../_core/trpc";

const notImplemented = () =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: "Operational command bridge is not implemented yet",
  });

export const operationalCommandBridgeRouter = router({
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

  // F-12 (wave-4b): zero-payload createIncident — no command-bridge store is
  // delivered. Fail loud.
  createIncident: protectedProcedure.mutation(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "createIncident: no command-bridge store is delivered",
    });
  }),

  // F-12 (wave-4b): zero-payload getStats — no command-bridge store is
  // delivered. Fail loud.
  getStats: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getStats: no command-bridge store is delivered",
    });
  }),

  // F-12 (wave-4b): zero-payload listIncidents — no command-bridge store is
  // delivered. Fail loud.
  listIncidents: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "listIncidents: no command-bridge store is delivered",
    });
  }),
});
