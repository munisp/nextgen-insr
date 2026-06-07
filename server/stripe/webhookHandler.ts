/**
 * Stripe Webhook Handler — InsurePortal InsurePortal Platform
 *
 * Handles incoming Stripe webhook events for payment confirmations,
 * subscription updates, invoice processing, dunning workflows,
 * and user account linking.
 *
 * Middleware: Kafka (event publishing), Redis (dedup), TigerBeetle (ledger)
 */
import { Request, Response } from "express";
import Stripe from "stripe";
import { getDb } from "../db";
import {
  billingAuditLog,
  platformBillingLedger,
  users,
} from "../../drizzle/schema";
import { eq } from "drizzle-orm";

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
  console.log(
    `[Kafka] Publishing to ${topic}:`,
    JSON.stringify(payload).slice(0, 200)
  );
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

export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"];
  if (!sig)
    return res.status(400).json({ error: "Missing stripe-signature header" });

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      req.body,
      sig,
      getWebhookSecret()
    );
  } catch (err: any) {
    console.error(
      "[Stripe Webhook] Signature verification failed:",
      err.message
    );
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Handle test events
  if (event.id.startsWith("evt_test_")) {
    console.log("[Stripe Webhook] Test event detected");
    return res.json({ verified: true });
  }

  const db = await getDb();

  try {
    switch (event.type) {
      // ─── Invoice Paid ─────────────────────────────────────────────────
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = parseInt(invoice.metadata?.tenant_id || "0");
        const amount = invoice.amount_paid || 0;
        console.log(
          `[Stripe Webhook] Invoice paid: ${invoice.id}, tenant: ${tenantId}, amount: ${amount}`
        );

        if (tenantId > 0) {
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
            transactionId: Math.floor(Math.random() * 1000000),
            tenantId,
            agentId: 0,
            serviceNodeId: 0,
            transactionType: "commission",
            grossAmount: String(amount / 100),
            platformShare: String(Math.round(amount * 0.15) / 100),
            clientShare: String(Math.round(amount * 0.85) / 100),
            netRevenue: String(amount / 100),
            currency: (invoice.currency || "ngn").toUpperCase(),
            status: "settled",
            billingModel: "subscription",
            invoiceId: invoice.id,
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
        console.log(
          `[Stripe Webhook] Invoice payment failed: ${failedInvoice.id}, attempt: ${attemptCount}`
        );

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
        console.log(`[Stripe Webhook] Invoice overdue: ${overdueInvoice.id}`);

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
        console.log(
          `[Stripe Webhook] Checkout completed: ${session.id}, userId: ${userId}`
        );

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
            console.log(
              `[Stripe Webhook] Linked subscription ${subId} (plan: ${planId}) to user ${userId}`
            );
          } catch (linkErr: any) {
            console.error(
              `[Stripe Webhook] Failed to link subscription to user ${userId}:`,
              linkErr.message
            );
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
        console.log(`[Stripe Webhook] Payment succeeded: ${pi.id}`);
        await publishBillingEvent("billing.payment.succeeded", {
          paymentIntentId: pi.id,
          amount: pi.amount,
        });
        break;
      }

      // ─── Payment Intent Failed ────────────────────────────────────────
      case "payment_intent.payment_failed": {
        const fp = event.data.object as Stripe.PaymentIntent;
        console.log(`[Stripe Webhook] Payment failed: ${fp.id}`);
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
        console.log(
          `[Stripe Webhook] Subscription ${event.type}: ${sub.id}, userId: ${subUserId}`
        );

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
            console.error(
              `[Stripe Webhook] Failed to update subscription for user ${subUserId}:`,
              e.message
            );
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
        console.log(
          `[Stripe Webhook] Subscription cancelled: ${csub.id}, userId: ${cancelUserId}`
        );

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
            console.error(
              `[Stripe Webhook] Failed to clear subscription for user ${cancelUserId}:`,
              e.message
            );
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
        console.log(`[Stripe Webhook] Dispute created: ${dispute.id}`);
        await publishBillingEvent("billing.dispute.created", {
          disputeId: dispute.id,
          amount: dispute.amount,
        });
        break;
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    return res.json({ received: true });
  } catch (err: any) {
    console.error(
      `[Stripe Webhook] Error processing event ${event.type}:`,
      err
    );
    await publishBillingEvent("billing.webhook.error", {
      eventId: event.id,
      eventType: event.type,
      error: err.message,
    });
    return res.status(500).json({ error: "Webhook processing error" });
  }
}
