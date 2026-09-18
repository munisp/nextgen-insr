/**
 * Phone Ownership Router — G2 audit 2026-02 (finding #8)
 *
 * Onboarding (J01 createOrFetchCustomer) merges by phone match ONLY after
 * the caller proves ownership of that phone via this OTP flow. The verified
 * proof is a short-lived, server-side marker consumed by the merge path.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../_core/trpc";
import {
  requestPhoneOwnershipOtp,
  verifyPhoneOwnershipOtp,
} from "../lib/phoneOtp";

export const phoneOwnershipRouter = router({
  /** Step 1: send an ownership OTP to the phone (fail-loud on SMS outage). */
  requestOtp: protectedProcedure
    .input(z.object({ phone: z.string().min(10).max(15) }))
    .mutation(async ({ input }) => {
      try {
        await requestPhoneOwnershipOtp(input.phone);
        return { success: true, message: "Verification code sent by SMS" };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  /** Step 2: verify the OTP — plants the merge proof marker (single-use). */
  verifyOtp: protectedProcedure
    .input(z.object({ phone: z.string().min(10).max(15), otp: z.string().length(6) }))
    .mutation(async ({ input }) => {
      try {
        return await verifyPhoneOwnershipOtp(input.phone, input.otp);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
});
