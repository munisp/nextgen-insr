/**
 * memberPhone.ts — R3 batch 6 member surface (2026-10-01, R3-b6)
 *
 * Member-scoped phone-ownership verification for the PWA
 * (customer-portal-full/client/src/services/memberPhoneApi.ts → mounted as
 * `memberPhone`). Source: phoneOwnership.requestOtp/verifyOtp
 * (server/routers/phoneOwnership.ts:19-47) over server/lib/phoneOtp.ts.
 *
 * Source-proc verification (2026-10-01, R3-b6):
 *   - requestOtp/verifyOtp take ONLY {phone} / {phone, otp} — they NEVER
 *     accept a userId/customerId (phoneOwnership.ts:20, :36), so there is
 *     no caller-identity smuggling surface. The OTP is delivered to the
 *     CLAIMED phone itself; possession of the phone is the proof.
 *   - OTP store is NOT in-memory: bcrypt-hashed codes persist in the real
 *     phone_verification_otps table (drizzle/schema.ts:5973, migration
 *     0078) with a 5-attempt lock that fails CLOSED (phoneOtp.ts:129-131).
 *   - Throttle: per-phone 5 requests/hour via a Redis counter
 *     (phoneOtp.ts:77-87). KNOWN LIMITATION (2026-10-01, R3-b6): the
 *     throttle counter and the post-verify proof marker are Redis-only —
 *     if Redis is down the hourly counter is skipped (the DB attempt lock
 *     still bounds guessing) and verifyPhoneOwnershipOtp's proof-marker
 *     write (phoneOtp.ts:151) rejects, so a correct OTP surfaces an error
 *     instead of a silent pass (fail-closed). Persisting the throttle/
 *     proof state is a separate persistence wave — do not "fix" it here.
 *   - SMS delivery is FAIL-LOUD: on Termii failure the unusable token is
 *     deleted and the error surfaced (phoneOtp.ts:100-107).
 *
 * Caller binding added here (member surface rule): both procs first resolve
 * + REQUIRE the caller's own customer profile (customers.keycloakSub =
 * String(ctx.user.id)) — the proof marker this flow plants is consumed by
 * the caller's own identity-merge path, so a session with no customer
 * profile has nothing to bind → NOT_FOUND (fail-closed, non-enumerating).
 * The member input schemas carry NO userId/customerId fields.
 *
 * PII rule: phone numbers are PII; responses are non-enumerating
 * (success/message only, never token state) and the phone is never echoed
 * back. The delegation keeps the OTP generate/throttle/lock logic in the
 * single real implementation (memberClaims.fileClaim delegation pattern).
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR; no profile → NOT_FOUND.
 */
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { customers } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import type { DrizzleDb } from "../lib/memberGuards";
import { phoneOwnershipRouter } from "./phoneOwnership";

async function db(): Promise<DrizzleDb> {
  const d = await getDb();
  if (!d)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable",
    });
  return d;
}

/**
 * Resolve + REQUIRE the session customer: customers.keycloakSub =
 * String(ctx.user.id) (memberSavings/memberQuotes requireSessionCustomer
 * pattern, 2026-10-01 R3-b6 copy). The phone proof binds to the caller's
 * own customer record — without a profile there is no caller scope →
 * NOT_FOUND (non-enumerating).
 */
async function requireSessionCustomer(d: DrizzleDb, userId: number) {
  const [customer] = await d
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.keycloakSub, String(userId)))
    .limit(1);
  if (!customer) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Customer profile not found for session user",
    });
  }
  return customer;
}

const phoneSchema = z.string().min(10).max(15);

export const memberPhoneRouter = router({
  /**
   * Step 1: send an ownership OTP to the claimed phone. Delegates to
   * phoneOwnership.requestOtp (per-phone throttle + fail-loud SMS + DB
   * token store stay in the one real implementation). Non-enumerating
   * response — the phone is not echoed back.
   */
  requestPhoneOtp: protectedProcedure
    .input(z.object({ phone: phoneSchema }))
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      await requireSessionCustomer(d, ctx.user.id);
      const caller = phoneOwnershipRouter.createCaller(ctx);
      return caller.requestOtp({ phone: input.phone });
    }),

  /**
   * Step 2: verify the OTP (single-use; 5-attempt fail-closed lock; on
   * success plants the short-lived proof marker consumed by the caller's
   * own merge path). Delegates to phoneOwnership.verifyOtp.
   */
  verifyPhoneOtp: protectedProcedure
    .input(z.object({ phone: phoneSchema, otp: z.string().length(6) }))
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      await requireSessionCustomer(d, ctx.user.id);
      const caller = phoneOwnershipRouter.createCaller(ctx);
      return caller.verifyOtp({ phone: input.phone, otp: input.otp });
    }),
});
