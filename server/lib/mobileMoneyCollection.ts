/**
 * mobileMoneyCollection.ts — Q-wave Q1 (2026-09-25)
 *
 * Airtime / mobile-money premium collection adapter for the embedded partner
 * factory freemium-upgrade path (MicroEnsure-style small-ticket premiums are
 * collected via airtime deduction or mobile-money debit, not card rails).
 *
 * REAL HTTP ADAPTER — no mocks/stubs on the production path:
 *   • Config-gated: EMBEDDED_MM_COLLECT_URL + EMBEDDED_MM_API_KEY must both be
 *     set. When unconfigured the adapter FAILS CLOSED (success:false,
 *     reason:"not_configured") — a premium is never treated as collected
 *     without a real provider ack. Disclosure: production rollout requires the
 *     aggregator (e.g. MNO airtime API / MoMo aggregator) credentials; until
 *     then freemium upgrades correctly refuse to activate paid cover.
 *   • Bounded: hard timeout (EMBEDDED_MM_TIMEOUT_MS, default 10000ms).
 *   • Fail-closed: network errors, timeouts, non-2xx, or a provider response
 *     without an explicit success flag all return success:false; callers must
 *     NOT activate paid cover on anything but success:true.
 *   • No card/PAN data ever transits this adapter (MSISDN + amount only).
 */
import axios from "axios";

import { logger } from "../_core/logger";

const MM_COLLECT_URL = process.env.EMBEDDED_MM_COLLECT_URL;
const MM_API_KEY = process.env.EMBEDDED_MM_API_KEY;
const MM_TIMEOUT_MS = Number(process.env.EMBEDDED_MM_TIMEOUT_MS ?? 10_000);

export interface MobileMoneyCollectRequest {
  /** Customer MSISDN, E.164 (e.g. "+2348012345678"). */
  msisdn: string;
  amount: number;
  currency: string; // e.g. "NGN"
  reference: string; // idempotency key (server-generated)
  channel: "airtime" | "mobile_money";
  narration?: string;
}

export interface MobileMoneyCollectResult {
  success: boolean;
  reason?: "not_configured" | "provider_error" | "timeout" | "declined";
  providerRef?: string;
  message?: string;
}

/**
 * Attempt a premium collection against the configured airtime/mobile-money
 * aggregator. NEVER throws for provider-side failure — returns a typed
 * fail-closed result so the caller can keep the enrollment on the free tier.
 */
export async function collectMobileMoneyPremium(
  req: MobileMoneyCollectRequest
): Promise<MobileMoneyCollectResult> {
  if (!MM_COLLECT_URL || !MM_API_KEY) {
    logger.warn(
      { reference: req.reference, channel: req.channel },
      "[MobileMoney] Collection requested but adapter is not configured — fail-closed (no premium collected)"
    );
    return {
      success: false,
      reason: "not_configured",
      message:
        "Mobile-money collection is not configured (EMBEDDED_MM_COLLECT_URL/EMBEDDED_MM_API_KEY) — premium NOT collected",
    };
  }
  if (!(req.amount > 0) || !Number.isFinite(req.amount)) {
    return { success: false, reason: "declined", message: "amount must be positive" };
  }

  try {
    const res = await axios.post(
      MM_COLLECT_URL,
      {
        msisdn: req.msisdn,
        amount: req.amount,
        currency: req.currency,
        reference: req.reference,
        channel: req.channel,
        narration: req.narration ?? "Insurance premium collection",
      },
      {
        timeout: Number.isFinite(MM_TIMEOUT_MS) && MM_TIMEOUT_MS > 0 ? MM_TIMEOUT_MS : 10_000,
        headers: {
          Authorization: `Bearer ${MM_API_KEY}`,
          "Content-Type": "application/json",
        },
        // Only 2xx is a candidate success; everything else is handled below.
        validateStatus: () => true,
      }
    );

    if (res.status < 200 || res.status >= 300) {
      logger.warn(
        { status: res.status, reference: req.reference },
        "[MobileMoney] Provider returned non-2xx — fail-closed"
      );
      return { success: false, reason: "provider_error", message: `provider HTTP ${res.status}` };
    }

    const body = (res.data ?? {}) as Record<string, unknown>;
    // The provider must EXPLICITLY confirm collection. Any ambiguous body
    // shape is treated as not-collected (fail-closed for funds).
    if (body.success !== true || typeof body.providerRef !== "string") {
      logger.warn(
        { reference: req.reference, body },
        "[MobileMoney] Provider response lacked explicit success confirmation — fail-closed"
      );
      return { success: false, reason: "declined", message: "provider did not confirm collection" };
    }

    return { success: true, providerRef: body.providerRef };
  } catch (err) {
    const isTimeout =
      (err as { code?: string })?.code === "ECONNABORTED" ||
      /timeout/i.test((err as Error)?.message ?? "");
    logger.error(
      { err: (err as Error)?.message, reference: req.reference },
      "[MobileMoney] Collection call failed — fail-closed"
    );
    return {
      success: false,
      reason: isTimeout ? "timeout" : "provider_error",
      message: (err as Error)?.message ?? "collection call failed",
    };
  }
}
