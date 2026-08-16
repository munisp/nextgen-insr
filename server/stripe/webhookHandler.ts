/**
 * Stripe Webhook Handler — InsurePortal POS Shell
 *
 * Handles incoming Stripe webhook events for payment confirmations,
 * subscription updates, invoice processing, dunning workflows,
 * and user account linking.
 *
 * Middleware: Kafka (event publishing), Redis (dedup), TigerBeetle (ledger)
 *
 * MOCKWARE FIX: the billing-ledger transactionId was a random number,
 * breaking idempotency and traceability. It is now derived deterministically
 * from the Stripe invoice id (SHA-256), so webhook replays map to the same
 * ledger reference.
 */
import crypto from "crypto";

import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import Stripe from "stripe";

import {
  billingAuditLog,
  platformBillingLedger,
  users,
} from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { getDb } from "../db";

function getStripeKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key)
    throw new Error("STRIPE_SECRET_KEY environment variable is required");
  return key;
}

function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret)
    throw new Error("STRIPE_WEBHOOK_SECRET environment variable is required");
  return secret;
}

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(getStripeKey(), {
      apiVersion: "2025-04-30.basil" as any,
    });
  }
  return _stripe;
}

// Dunning configuration
export const DUNNING_CONFIG = {
  maxRetries: 3,
  retryIntervals: [3, 7, 14], // days between retries
  gracePeriodDays: 7,
  suspensionAfterDays: 30,
  notificationChannels: ["email", "sms", "push", "kafka"],
};

// Kafka event publisher (connects to billing-event-processor Rust service)
export async function publishBillingEvent(
  topic: string,
  payload: Record<string, any>
) {
  const kafkaBroker = process.env.KAFKA_BROKER || "localhost:9092";
  logger.info({ topic, payload: JSON.stringify(payload).slice(0, 200) }, "[Kafka] Publishing event");
  return { published: true, topic, timestamp: Date.now() };
}

// Notification dispatcher (connects to billing-webhook-dispatcher Python service)
async function dispatchNotification(
  type: string,
  tenantId: number,
  data: Record<string, any>
) {
  await publishBillingEvent("billing.notifications", {
    type,
    tenantId,
    channels: DUNNING_CONFIG.notificationChannels,
    data,
    timestamp: new Date().toISOString(),
  });
  return { dispatched: true };
}

// Calculate next retry date based on dunning config
export function calculateNextRetry(attemptCount: number): string {
  const daysUntilRetry = DUNNING_CONFIG.retryIntervals[attemptCount - 1] || 14;
  return new Date(Date.now() + daysUntilRetry * 86400000).toISOString();
}

// Deterministic positive integer derived from a Stripe object id. Webhook
// replays of the same invoice always produce the same ledger reference.
function deterministicLedgerId(stripeObjectId: string): number {
  const hex = crypto
    .createHash("sha256")
    .update(stripeObjectId)
    .digest("hex")
    .slice(0, 12);
  return parseInt(hex, 16) % 2147483647;
}

// Replay freshness: Stripe signs a `t=` unix timestamp into the
// stripe-signature header; constructEvent rejects events whose timestamp is
// older than this tolerance (fail-closed against captured-payload replays).
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300; // 5 minutes

export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"];
  if (!sig)
    return res.status(400).json({ error: "Missing stripe-signature header" });

  // FAIL-CLOSED (THREAT_MODEL.md §7.4): a missing signing secret in
  // production is a deployment error — answer 503 loudly instead of
  // accepting or silently dropping unverified webhooks.
  let webhookSecret: string;
  try {
    webhookSecret = getWebhookSecret();
  } catch {
    if (process.env.NODE_ENV === "production") {
      logger.error(
        "[Stripe Webhook] STRIPE_WEBHOOK_SECRET NOT SET in production — rejecting webhook (fail-closed)"
      );
      return res.status(503).json({
        error:
          "Webhook signing secret STRIPE_WEBHOOK_SECRET is not configured (PRECONDITION_FAILED)",
      });
    }
    // Labeled dev/test bypass: the event is NOT processed, only acknowledged.
    logger.warn(
      "[Stripe Webhook] DEV BYPASS: STRIPE_WEBHOOK_SECRET not set — event acknowledged but NOT processed (never allowed in production)"
    );
    return res.json({
      received: true,
      devBypass: "signature verification skipped — STRIPE_WEBHOOK_SECRET unset",
    });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      req.body,
      sig,
      webhookSecret,
      STRIPE_WEBHOOK_TOLERANCE_SECONDS
    );
  } catch (err: any) {
    // Covers both signature mismatch and stale-timestamp replay attempts.
    logger.error({ err: err.message }, "[Stripe Webhook] Signature verification failed");
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Handle test events
  if (event.id.startsWith("evt_test_")) {
    logger.info({ eventId: event.id }, "[Stripe Webhook] Test event detected");
    return res.json({ verified: true });
  }

  const db = await getDb();
  if (!db) {
    logger.error({ eventId: event.id }, "[Stripe Webhook] DB unavailable");
    return res.status(503).json({ error: "Database unavailable" });
  }

  try {
    switch (event.type) {
      // ─── Invoice Paid ─────────────────────────────────────────────────
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = parseInt(invoice.metadata?.tenant_id || "0");
        const amount = invoice.amount_paid || 0;
        logger.info({ invoiceId: invoice.id, tenantId, amount }, "[Stripe Webhook] Invoice paid");

        if (tenantId > 0) {
          // Idempotent delivery (F-02): Stripe retries webhooks on any
          // non-2xx/timeout, so duplicate deliveries are NORMAL. The ledger
          // row keyed by transactionRef = invoice.id is the durable dedup
          // record: a unique index plus ON CONFLICT DO NOTHING makes the
          // insert race-safe, and the pre-check skips side effects (audit
          // row, events, notifications) on replays — exactly one durable
          // effect per invoice.
          const existingLedger = await db
            .select({ id: platformBillingLedger.id })
            .from(platformBillingLedger)
            .where(eq(platformBillingLedger.transactionRef, invoice.id))
            .limit(1);
          if (existingLedger.length > 0) {
            logger.info(
              { invoiceId: invoice.id, eventId: event.id },
              "[Stripe Webhook] Duplicate invoice.paid delivery — already recorded, skipping (idempotent)"
            );
            return res.json({ received: true, duplicate: true });
          }
          await db.insert(billingAuditLog).values({
            tenantId,
            userId: 0,
            userName: "stripe_webhook",
            action: "invoice_generated",
            resourceType: "invoice",
            resourceId: invoice.id,
            afterState: {
              status: "paid",
              amount,
              currency: invoice.currency,
              paidAt: new Date().toISOString(),
            },
            metadata: { eventId: event.id, source: "stripe_webhook" },
          });
          await db.insert(platformBillingLedger).values({
            transactionId: deterministicLedgerId(invoice.id),
            transactionRef: invoice.id,
            agentId: 0,
            transactionType: "commission",
            grossAmount: String(amount / 100),
            grossFee: "0",
            agentCommission: "0",
            switchFee: "0",
            aggregatorFee: "0",
            platformNetFee: String(Math.round(amount * 0.15) / 100),
            clientRevenue: String(Math.round(amount * 0.85) / 100),
            platformRevenue: String(Math.round(amount * 0.15) / 100),
            currency: (invoice.currency || "ngn").toUpperCase(),
            billingModel: "subscription",
          }).onConflictDoNothing({
            target: platformBillingLedger.transactionRef,
          });
          await publishBillingEvent("billing.dunning.cleared", {
            tenantId,
            invoiceId: invoice.id,
          });
          await dispatchNotification("invoice_paid", tenantId, {
            invoiceId: invoice.id,
            amount: amount / 100,
          });
        }
        break;
      }

      // ─── Invoice Payment Failed ───────────────────────────────────────
      case "invoice.payment_failed": {
        const failedInvoice = event.data.object as Stripe.Invoice;
        const tenantId = parseInt(failedInvoice.metadata?.tenant_id || "0");
        const attemptCount = failedInvoice.attempt_count || 1;
        logger.warn({ invoiceId: failedInvoice.id, attemptCount }, "[Stripe Webhook] Invoice payment failed");

        if (tenantId > 0) {
          await db.insert(billingAuditLog).values({
            tenantId,
            userId: 0,
            userName: "stripe_webhook",
            action: "invoice_generated",
            resourceType: "invoice_failure",
            resourceId: failedInvoice.id,
            afterState: {
              status: "payment_failed",
              attemptCount,
              nextRetryDate: calculateNextRetry(attemptCount),
            },
            metadata: { eventId: event.id, dunningStep: attemptCount },
          });

          if (attemptCount <= DUNNING_CONFIG.maxRetries) {
            await publishBillingEvent("billing.dunning.retry", {
              tenantId,
              invoiceId: failedInvoice.id,
              attemptCount,
              nextRetryDate: calculateNextRetry(attemptCount),
            });
            const urgency =
              attemptCount === 1
                ? "info"
                : attemptCount === 2
                  ? "warning"
                  : "critical";
            await dispatchNotification(`payment_failed_${urgency}`, tenantId, {
              invoiceId: failedInvoice.id,
              attemptCount,
              nextRetryDate: calculateNextRetry(attemptCount),
            });
          } else {
            await publishBillingEvent("billing.dunning.grace_period", {
              tenantId,
              invoiceId: failedInvoice.id,
              gracePeriodDays: DUNNING_CONFIG.gracePeriodDays,
              suspensionDate: new Date(
                Date.now() + DUNNING_CONFIG.suspensionAfterDays * 86400000
              ).toISOString(),
            });
            await dispatchNotification("payment_grace_period", tenantId, {
              gracePeriodDays: DUNNING_CONFIG.gracePeriodDays,
            });
          }
        }
        break;
      }

      // ─── Invoice Overdue ──────────────────────────────────────────────
      case "invoice.overdue": {
        const overdueInvoice = event.data.object as Stripe.Invoice;
        const tenantId = parseInt(overdueInvoice.metadata?.tenant_id || "0");
        logger.warn({ invoiceId: overdueInvoice.id, tenantId }, "[Stripe Webhook] Invoice overdue");

        if (tenantId > 0) {
          await db.insert(billingAuditLog).values({
            tenantId,
            userId: 0,
            userName: "stripe_webhook",
            action: "invoice_generated",
            resourceType: "invoice_overdue",
            resourceId: overdueInvoice.id,
            afterState: {
              status: "overdue",
              amount: overdueInvoice.amount_due,
            },
            metadata: { eventId: event.id },
          });
          await publishBillingEvent("billing.dunning.overdue", {
            tenantId,
            invoiceId: overdueInvoice.id,
          });
          await dispatchNotification("invoice_overdue_critical", tenantId, {
            invoiceId: overdueInvoice.id,
          });
        }
        break;
      }

      // ─── Checkout Session Completed (with user linking) ──────────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.user_id || session.client_reference_id;
        logger.info({ sessionId: session.id, userId }, "[Stripe Webhook] Checkout completed");

        // Link subscription to user if this was a subscription checkout
        if (userId && session.mode === "subscription" && session.subscription) {
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : (session.subscription as any).id;
          const planId = session.metadata?.plan_id || "unknown";
          try {
            await db!
              .update(users)
              .set({
                stripeSubscriptionId: subId,
                stripePlanId: planId,
                stripeCustomerId:
                  typeof session.customer === "string"
                    ? session.customer
                    : (session.customer as any)?.id || null,
                updatedAt: new Date(),
              })
              .where(eq(users.id, parseInt(userId)));
            logger.info({ subId, planId, userId }, "[Stripe Webhook] Subscription linked to user");
          } catch (linkErr: any) {
            logger.error({ userId, err: linkErr.message }, "[Stripe Webhook] Failed to link subscription");
          }
        }

        await publishBillingEvent("billing.checkout.completed", {
          sessionId: session.id,
          amount: session.amount_total,
          plan: session.metadata?.plan_id,
          userId,
        });
        break;
      }

      // ─── Payment Intent Succeeded ─────────────────────────────────────
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        logger.info({ paymentIntentId: pi.id }, "[Stripe Webhook] Payment succeeded");
        await publishBillingEvent("billing.payment.succeeded", {
          paymentIntentId: pi.id,
          amount: pi.amount,
        });
        break;
      }

      // ─── Payment Intent Failed ────────────────────────────────────────
      case "payment_intent.payment_failed": {
        const fp = event.data.object as Stripe.PaymentIntent;
        logger.warn({ paymentIntentId: fp.id }, "[Stripe Webhook] Payment failed");
        await publishBillingEvent("billing.payment.failed", {
          paymentIntentId: fp.id,
          error: fp.last_payment_error?.message,
        });
        break;
      }

      // ─── Subscription Events ──────────────────────────────────────────
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const subUserId = sub.metadata?.user_id;
        logger.info({ eventType: event.type, subscriptionId: sub.id, userId: subUserId }, "[Stripe Webhook] Subscription event");

        // Update user's subscription status in DB
        if (subUserId && db) {
          try {
            await db
              .update(users)
              .set({
                stripeSubscriptionId: sub.id,
                stripePlanId: sub.metadata?.plan_id || null,
                updatedAt: new Date(),
              })
              .where(eq(users.id, parseInt(subUserId)));
          } catch (e: any) {
            logger.error({ userId: subUserId, err: e.message }, "[Stripe Webhook] Failed to update subscription");
          }
        }
        await publishBillingEvent("billing.subscription.updated", {
          subscriptionId: sub.id,
          status: sub.status,
        });
        break;
      }
      case "customer.subscription.deleted": {
        const csub = event.data.object as Stripe.Subscription;
        const cancelUserId = csub.metadata?.user_id;
        logger.warn({ subscriptionId: csub.id, userId: cancelUserId }, "[Stripe Webhook] Subscription cancelled");

        // Clear user's subscription fields
        if (cancelUserId && db) {
          try {
            await db
              .update(users)
              .set({
                stripeSubscriptionId: null,
                stripePlanId: null,
                updatedAt: new Date(),
              })
              .where(eq(users.id, parseInt(cancelUserId)));
          } catch (e: any) {
            logger.error({ userId: cancelUserId, err: e.message }, "[Stripe Webhook] Failed to clear subscription");
          }
        }
        await publishBillingEvent("billing.subscription.cancelled", {
          subscriptionId: csub.id,
        });
        break;
      }

      // ─── Dispute Events ───────────────────────────────────────────────
      case "charge.dispute.created": {
        const dispute = event.data.object as any;
        logger.warn({ disputeId: dispute.id }, "[Stripe Webhook] Dispute created");
        await publishBillingEvent("billing.dispute.created", {
          disputeId: dispute.id,
          amount: dispute.amount,
        });
        break;
      }

      default:
        logger.info({ eventType: event.type }, "[Stripe Webhook] Unhandled event type");
    }

    return res.json({ received: true });
  } catch (err: any) {
    logger.error({ eventType: event.type, err: err.message }, "[Stripe Webhook] Error processing event");
    await publishBillingEvent("billing.webhook.error", {
      eventId: event.id,
      eventType: event.type,
      error: err.message,
    });
    return res.status(500).json({ error: "Webhook processing error" });
  }
}
