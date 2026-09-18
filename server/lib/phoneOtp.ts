/**
 * phoneOtp.ts — G2 audit 2026-02 (finding #8): phone-ownership proof for
 * identity merges.
 *
 * createOrFetchCustomer (J01) previously merged ANY matching phone into the
 * existing customer record with no proof of ownership — onboarding with a
 * victim's phone silently attached new KYC data to their record. Now a merge
 * requires a verified phone-ownership OTP:
 *
 *   1. requestPhoneOwnershipOtp(phone) — CSPRNG 6-digit code, bcrypt at rest
 *      (phone_verification_otps table, migration 0078), delivered via the
 *      shared Termii helper. SMS failure is FAIL-LOUD: the unusable token is
 *      deleted and the error is surfaced (never fail-silent).
 *   2. verifyPhoneOwnershipOtp(phone, code) — attempt-limited (5, then the
 *      token locks fail-closed); on success marks the token used and sets a
 *      short-lived Redis proof marker consumed by the merge path.
 *   3. consumePhoneOwnershipProof(phone) — called by createOrFetchCustomer;
 *      single-use.
 */
import crypto from "crypto";

import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";

import { phoneVerificationOtps } from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { getDb } from "../db";
import { getRedisClient } from "./redisClient";
import { sendSms } from "../termii";

const OTP_EXPIRY_MINUTES = 10;
export const PHONE_OTP_MAX_ATTEMPTS = 5;
/** How long a successful verification may be used to merge (single-use). */
const PROOF_TTL_SECONDS = 30 * 60;
/** Per-phone resend throttle: max requests per hour (SMS-bombing guard). */
const PHONE_OTP_MAX_PER_HOUR = 5;

function generateOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

function proofKey(phone: string): string {
  return `phoneown:verified:${phone}`;
}

function rateKey(phone: string): string {
  return `phoneown:rate:${phone}`;
}

/** True when a verified (unconsumed) ownership proof exists for the phone. */
export async function hasPhoneOwnershipProof(phone: string): Promise<boolean> {
  try {
    const v = await getRedisClient().get(proofKey(phone));
    return v === "1";
  } catch {
    // Fail-closed: without the proof store we cannot prove ownership.
    return false;
  }
}

/** Consume (single-use) the ownership proof. Returns false when absent. */
export async function consumePhoneOwnershipProof(phone: string): Promise<boolean> {
  try {
    const removed = await getRedisClient().del(proofKey(phone));
    return removed > 0;
  } catch {
    return false;
  }
}

/** Request an ownership OTP. Throws (fail-loud) when SMS delivery fails. */
export async function requestPhoneOwnershipOtp(phone: string): Promise<{ sent: true }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Per-phone throttle (not just per-IP): rotating IPs must not SMS-bomb a victim.
  try {
    const redis = getRedisClient();
    const n = await redis.incr(rateKey(phone));
    if (n === 1) await redis.expire(rateKey(phone), 3600);
    if (n > PHONE_OTP_MAX_PER_HOUR) {
      throw new Error("Too many verification codes requested for this phone — try again later");
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Too many")) throw err;
    // Redis unavailable → continue (DB attempt lock still bounds abuse).
  }

  await db.delete(phoneVerificationOtps).where(eq(phoneVerificationOtps.phone, phone));

  const otp = generateOtp();
  const hashedOtp = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
  await db.insert(phoneVerificationOtps).values({ phone, hashedOtp, expiresAt });

  const sms = await sendSms(
    phone,
    `Your InsurePortal phone verification code is: ${otp}. Valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share this code.`
  );
  if (!sms.success) {
    // FAIL-LOUD (G2 #20 discipline): a stored-but-undeliverable OTP is an
    // availability trap — remove it and surface the error.
    await db.delete(phoneVerificationOtps).where(eq(phoneVerificationOtps.phone, phone));
    const masked = phone.slice(0, 4) + "****" + phone.slice(-3);
    logger.error(`[phoneOtp] SMS delivery failed for ${masked}: ${sms.error}`);
    throw new Error("Could not deliver the verification code by SMS — please try again later");
  }
  return { sent: true };
}

/** Verify an ownership OTP; on success plants the merge proof marker. */
export async function verifyPhoneOwnershipOtp(phone: string, code: string): Promise<{ verified: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [token] = await db
    .select()
    .from(phoneVerificationOtps)
    .where(
      and(
        eq(phoneVerificationOtps.phone, phone),
        eq(phoneVerificationOtps.used, false),
        gt(phoneVerificationOtps.expiresAt, new Date())
      )
    )
    .limit(1);
  if (!token) throw new Error("Verification code expired or not found — please request a new one");

  if ((token.attempts ?? 0) >= PHONE_OTP_MAX_ATTEMPTS) {
    throw new Error("Too many incorrect attempts. This code is locked — please request a new one");
  }

  const valid = await bcrypt.compare(code, token.hashedOtp);
  if (!valid) {
    const attempts = (token.attempts ?? 0) + 1;
    await db
      .update(phoneVerificationOtps)
      .set({ attempts })
      .where(eq(phoneVerificationOtps.id, token.id));
    throw new Error(
      attempts >= PHONE_OTP_MAX_ATTEMPTS
        ? "Too many incorrect attempts. This code is locked — please request a new one"
        : "Invalid verification code"
    );
  }

  await db
    .update(phoneVerificationOtps)
    .set({ used: true, usedAt: new Date() })
    .where(eq(phoneVerificationOtps.id, token.id));
  await getRedisClient().set(proofKey(phone), "1", "EX", PROOF_TTL_SECONDS);
  return { verified: true };
}
