// @ts-check
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  publicProcedure as openProcedure,
  protectedProcedure,
  router,
} from "../_core/trpc";

const notImplemented = () =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: "Middleware service manager is not implemented yet",
  });

export const middlewareServiceManagerRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().default(20),
          offset: z.number().default(0),
        })
        .default({})
    )
    .query(async () => {
      throw notImplemented();
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async () => {
      throw notImplemented();
    }),

  getStats: openProcedure.query(async () => {
    throw notImplemented();
  }),

  testConnection: protectedProcedure
    .input(z.object({ serviceId: z.string() }))
    .mutation(async () => {
      throw notImplemented();
    }),

  updateUrl: protectedProcedure
    .input(z.object({ serviceId: z.string(), url: z.string().url() }))
    .mutation(async () => {
      throw notImplemented();
    }),
});
