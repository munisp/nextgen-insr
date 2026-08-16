/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PROTOCOL-FAITHFUL LOCAL SIMULATOR — TEST CODE ONLY — NOT EVIDENCE OF
 * PROVIDER BEHAVIOR.
 *
 * stripeSimulator.ts — local, protocol-faithful Stripe webhook DELIVERY
 * simulator. It reproduces Stripe's documented webhook wire protocol:
 *
 *   - the event JSON document shape ({id, object:"event", type, data.object})
 *   - the `Stripe-Signature` header computed with the REAL algorithm:
 *       t=<unix-ts>,v1=HMAC_SHA256(secret, "<t>.<raw-payload>")
 *     exactly as verified by stripe-node's constructEvent (the same code the
 *     production handler runs), including the signed-timestamp freshness
 *     window.
 *
 * Framework rule: official sandboxes are preferred; this simulator exists
 * ONLY because no Stripe sandbox is reachable from the test environment.
 * It is a documented gap (THREAT_MODEL.md §F-02) and is NOT evidence of
 * Stripe-specific behavior — only of OUR handler's verification, idempotency,
 * and ordering semantics against the documented protocol.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import crypto from "node:crypto";

export interface SimulatedStripeDelivery {
  payload: string;
  signatureHeader: string;
  eventId: string;
  timestamp: number;
}

let eventCounter = 0;

/** Build a Stripe-shaped event document. */
export function buildStripeEvent(
  type: string,
  object: Record<string, unknown>,
  opts?: { id?: string }
): Record<string, unknown> {
  const id = opts?.id ?? `evt_sim_${Date.now()}_${eventCounter++}`;
  return {
    id,
    object: "event",
    api_version: "2025-04-30.basil",
    created: Math.floor(Date.now() / 1000),
    type,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object },
  };
}

/**
 * Sign a raw payload with the REAL Stripe signature algorithm and return a
 * ready-to-deliver simulated webhook (payload string + Stripe-Signature
 * header value).
 */
export function signStripePayload(
  payload: string,
  secret: string,
  timestamp?: number
): SimulatedStripeDelivery {
  const t = timestamp ?? Math.floor(Date.now() / 1000);
  const v1 = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${payload}`, "utf8")
    .digest("hex");
  let eventId = "evt_sim_unknown";
  try {
    eventId = String(JSON.parse(payload).id ?? eventId);
  } catch {
    /* payload not JSON — delivery will fail verification downstream */
  }
  return { payload, signatureHeader: `t=${t},v1=${v1}`, eventId, timestamp: t };
}

/** Convenience: build + sign an invoice.paid event for a tenant. */
export function deliverableInvoicePaid(opts: {
  invoiceId: string;
  tenantId: number;
  amountPaid: number;
  currency?: string;
  secret: string;
  timestamp?: number;
}): SimulatedStripeDelivery {
  const event = buildStripeEvent("invoice.paid", {
    id: opts.invoiceId,
    object: "invoice",
    amount_paid: opts.amountPaid,
    amount_due: opts.amountPaid,
    currency: opts.currency ?? "ngn",
    status: "paid",
    metadata: { tenant_id: String(opts.tenantId) },
  });
  return signStripePayload(JSON.stringify(event), opts.secret, opts.timestamp);
}

/** Express-shaped request stub carrying the raw body exactly as Stripe would. */
export function asExpressRequest(delivery: SimulatedStripeDelivery): any {
  return {
    headers: { "stripe-signature": delivery.signatureHeader },
    body: Buffer.from(delivery.payload, "utf8"),
  };
}
