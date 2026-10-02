/**
 * webhookHandler.ts — Paystack premium-payment webhook (W7-B6, 2026-10-03)
 *
 * Registered BEFORE express.json() in server/_core/index.ts so the raw body
 * is available for HMAC-SHA512 signature verification
 * (server/lib/premiumPaymentGateway.ts verifyWebhookSignature). FAIL-CLOSED:
 * no PAYSTACK_SECRET_KEY → 503; bad signature → 401; unknown/unrelated
 * events → 200 acknowledged without effect.
 *
 * Only `charge.success` events whose reference matches a pending
 * premium_payments row are credited — via the SAME replay-safe
 * creditPremiumPayment helper the member-facing verify procedure uses
 * (server/routers/memberPayments.ts), so webhook and verify can never
 * double-credit. Amount is checked against the recorded row (kobo-exact)
 * before any credit.
 */
import type { Request, Response } from "express";

import { logger } from "../_core/logger";
import { getDb } from "../db";
import { verifyWebhookSignature } from "../lib/premiumPaymentGateway";
import { creditPremiumPayment } from "../routers/memberPayments";

export async function handlePaystackWebhook(
  req: Request,
  res: Response
): Promise<Response> {
  const raw = (req as { rawBody?: Buffer }).rawBody;
  if (!raw || raw.length === 0) {
    return res.status(400).json({ error: "Missing raw webhook body" });
  }
  const signature = req.headers["x-paystack-signature"] as string | undefined;
  if (!verifyWebhookSignature(raw, signature)) {
    // Covers both unconfigured secret (fail-closed) and bad signatures.
    if (!(process.env.PAYSTACK_SECRET_KEY ?? "").trim()) {
      logger.error(
        "[Paystack Webhook] PAYSTACK_SECRET_KEY not set — rejecting (fail-closed)"
      );
      return res.status(503).json({
        error:
          "Payment gateway webhook secret is not configured (fail-closed)",
      });
    }
    logger.warn("[Paystack Webhook] invalid signature — rejected");
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  let event: { event?: string; data?: { reference?: string; amount?: number } };
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid webhook payload" });
  }

  if (event.event !== "charge.success" || !event.data?.reference) {
    // Acknowledged honestly — verified but not a premium-credit event.
    return res.json({ received: true, credited: false });
  }
  const reference = String(event.data.reference);
  const amountKobo = Number(event.data.amount ?? NaN);

  const db = await getDb();
  if (!db) {
    return res.status(503).json({ error: "DB unavailable" });
  }

  // Only references this server issued (PP- prefix, member premium payments)
  // are creditable here; anything else is acknowledged without effect.
  if (!reference.startsWith("PP-")) {
    return res.json({ received: true, credited: false });
  }

  try {
    const { premiumPayments } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select()
      .from(premiumPayments)
      .where(eq(premiumPayments.paymentReference, reference))
      .limit(1);
    if (!row) {
      // Unknown reference: acknowledge (the gateway will stop retrying) but
      // never credit — the reference space is server-derived, so an unknown
      // one cannot correspond to a member initiation.
      return res.json({ received: true, credited: false });
    }
    if (amountKobo !== Math.round(Number(row.amount) * 100)) {
      logger.error(
        `[Paystack Webhook] amount mismatch for ${reference}: gateway=${amountKobo} recorded=${row.amount} — credit refused`
      );
      return res
        .status(409)
        .json({ error: "Amount mismatch — credit refused" });
    }
    const credited = await creditPremiumPayment(db, reference, {
      gatewayTransactionId: (event.data as { id?: number }).id,
      channel: (event.data as { channel?: string }).channel,
    });
    logger.info(
      `[Paystack Webhook] ${reference} ${credited.alreadyCredited ? "already credited (replay-safe)" : "credited"}`
    );
    return res.json({
      received: true,
      credited: !credited.alreadyCredited,
      alreadyCredited: credited.alreadyCredited,
    });
  } catch (err) {
    logger.error("[Paystack Webhook] credit error: " + String(err));
    return res.status(500).json({ error: "Credit processing failed" });
  }
}
