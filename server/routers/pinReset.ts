/**
 * PIN Reset Router
 *
 * Flow:
 *   1. Agent submits their agent code + registered phone number
 *   2. Server verifies the phone matches the DB record
 *   3. A 6-digit OTP is generated, hashed, and stored in the otp_tokens table
 *   4. OTP is sent via Termii SMS (falls back to console.log when key absent)
 *   5. Agent submits the OTP + new PIN
 *   6. Server verifies OTP, hashes new PIN, updates agents table
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, and, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getDb } from "../db";
import { agents, otpTokens } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { sendSms } from "../termii";
import crypto from "crypto";
const OTP_EXPIRY_MINUTES = 10;
// SECURITY: Use crypto.randomInt for cryptographically secure OTP generation
function generateOtp(): string {
  // Generates a 6-digit OTP using CSPRNG (crypto.randomInt is uniform in [100000, 999999])
  return crypto.randomInt(100000, 1000000).toString();
}

export const pinResetRouter = router({
  /**
   * Step 1: Request OTP
   * Verifies agent code + phone, generates OTP, sends SMS.
   */
  requestOtp: protectedProcedure
    .input(
      z.object({
        agentCode: z.string().min(3),
        phone: z.string().min(10).max(15),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        // Find agent by code
        const agentRows = await db
          .select()
          .from(agents)
          .where(eq(agents.agentCode, input.agentCode))
          .limit(1);

        if (agentRows.length === 0) {
          // Return generic message to avoid agent code enumeration
          return {
            success: true,
            message: "If the details match, an OTP has been sent.",
          };
        }

        const agent = agentRows[0];

        // Verify phone matches (last 10 digits comparison for flexibility)
        const storedPhone = (agent.phone ?? "").replace(/\D/g, "").slice(-10);
        const inputPhone = input.phone.replace(/\D/g, "").slice(-10);

        if (storedPhone !== inputPhone) {
          return {
            success: true,
            message: "If the details match, an OTP has been sent.",
          };
        }

        // Invalidate any existing OTPs for this agent
        await db.delete(otpTokens).where(eq(otpTokens.agentId, agent.id));

        // Generate and hash OTP
        const otp = generateOtp();
        const hashedOtp = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

        await db.insert(otpTokens).values({
          agentId: agent.id,
          hashedOtp,
          expiresAt,
          used: false,
        });

        // Send SMS via shared Termii helper
        const smsResult = await sendSms(
          input.phone,
          `Your InsurePortal PIN reset code is: ${otp}. Valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share this code.`
        );
        if (!smsResult.success) {
          // Redact phone number in logs to avoid PII exposure
          const maskedPhone =
            input.phone.slice(0, 4) + "****" + input.phone.slice(-3);
          console.error(
            `[pinReset] SMS delivery failed for ${maskedPhone}: ${smsResult.error}`
          );
        } else {
          const maskedPhone =
            input.phone.slice(0, 4) + "****" + input.phone.slice(-3);
          console.info(
            `[pinReset] OTP SMS sent to ${maskedPhone} — messageId: ${smsResult.messageId}`
          );
        }

        return {
          success: true,
          message: "If the details match, an OTP has been sent.",
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  /**
   * Step 2: Verify OTP and set new PIN
   */
  resetPin: protectedProcedure
    .input(
      z.object({
        agentCode: z.string().min(3),
        otp: z.string().length(6),
        newPin: z.string().min(4).max(6),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        // Find agent
        const agentRows = await db
          .select()
          .from(agents)
          .where(eq(agents.agentCode, input.agentCode))
          .limit(1);

        if (agentRows.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid OTP or agent code",
          });
        }

        const agent = agentRows[0];

        // Find valid (unexpired, unused) OTP token
        const tokenRows = await db
          .select()
          .from(otpTokens)
          .where(
            and(
              eq(otpTokens.agentId, agent.id),
              eq(otpTokens.used, false),
              gt(otpTokens.expiresAt, new Date())
            )
          )
          .limit(1);

        if (tokenRows.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "OTP expired or not found. Please request a new one.",
          });
        }

        const token = tokenRows[0];

        // Verify OTP
        const valid = await bcrypt.compare(input.otp, token.hashedOtp);
        if (!valid) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid OTP" });
        }

        // Mark token as used
        await db
          .update(otpTokens)
          .set({ used: true })
          .where(eq(otpTokens.id, token.id));

        // Hash and update PIN
        const hashedPin = await bcrypt.hash(input.newPin, 12);
        await db
          .update(agents)
          .set({ pinHash: hashedPin })
          .where(eq(agents.id, agent.id));

        return {
          success: true,
          message: "PIN updated successfully. Please log in with your new PIN.",
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
});
