import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../_core/trpc";

const notImplemented = () =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: "Partner onboarding is not implemented yet",
  });

export const partnerOnboardingRouter = router({
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

  addInsuranceRegion: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented();
    }),

  addFeeOverride: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented();
    }),

  completeOnboarding: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented();
    }),

  getBranding: protectedProcedure.query(async () => {
    throw notImplemented();
  }),

  listInsuranceRegions: protectedProcedure.query(async () => {
    throw notImplemented();
  }),

  listFees: protectedProcedure.query(async () => {
    throw notImplemented();
  }),

  registerTenant: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented();
    }),

  updateBranding: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented();
    }),
  validateInvite: protectedProcedure
    .input(z.object({ inviteCode: z.string() }))
    .query(async () => {
      throw notImplemented();
    }),
  getProgress: protectedProcedure
    .input(z.object({ tenantId: z.string().optional() }).default({}))
    .query(async () => {
      throw notImplemented();
    }),
  removeInsuranceRegion: protectedProcedure
    .input(z.object({ insurance_regionId: z.string() }))
    .mutation(async () => {
      throw notImplemented();
    }),
  removeFee: protectedProcedure
    .input(z.object({ feeId: z.string() }))
    .mutation(async () => {
      throw notImplemented();
    }),
});
