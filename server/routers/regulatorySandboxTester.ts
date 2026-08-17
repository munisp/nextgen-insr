import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../_core/trpc";

const notImplemented = () =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: "Regulatory sandbox tester is not implemented yet",
  });

export const regulatorySandboxTesterRouter = router({
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

  // F-12 (wave-4b): zero-payload getStats — no sandbox-tester store is delivered. Fail loud.
  getStats: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "getStats: no sandbox-tester store is delivered",
    });
  }),

  // F-12 (wave-4b): zero-payload listSandboxes — no sandbox-tester store is delivered. Fail loud.
  listSandboxes: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "listSandboxes: no sandbox-tester store is delivered",
    });
  }),

  runComplianceCheck: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented();
    }),
});
