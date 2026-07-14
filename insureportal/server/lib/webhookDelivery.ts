// @ts-check
// TypeScript enabled — Sprint 96 security audit
/**
 * Webhook Delivery Service
 *
 * Delivers outbound webhook events to registered endpoints with:
 * - HMAC-SHA256 signature (X-InsurePortal-Signature header)
 * - Exponential backoff retry (up to 3 attempts)
 * - Delivery log persisted to webhook_deliveries table
 * - Configurable per-endpoint event filtering
 *
 * Usage:
 *   import { dispatchWebhookEvent } from "./lib/webhookDelivery";
 *   await dispatchWebhookEvent("transaction.completed", { ref: "TX001", amount: 5000 });
 */
import crypto from "crypto";
import { getDb } from "../db";
import { webhookEndpoints, webhookDeliveries } from "@schema";
import { eq, and, lte } from "drizzle-orm";
import { logger } from '../_core/logger';

export type WebhookEventType =
  | "transaction.completed"
  | "transaction.failed"
  | "transaction.reversed"
  | "float.low"
  | "float.topup.approved"
  | "float.topup.rejected"
  | "kyc.approved"
  | "kyc.rejected"
  | "kyc.document_uploaded"
  | "dispute.raised"
  | "dispute.resolved"
  | "agent.activated"
  | "agent.suspended"
  | "agent.deactivated"
  | "fraud.alert"
  | "settlement.completed"
  | "commission.payout.approved"
  | "commission.payout.completed";

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string; // ISO 8601
  data: Record<string, unknown>;
}

/**
 * Sign a webhook payload using HMAC-SHA256.
 * Returns the hex digest prefixed with "sha256=".
 */
export function signPayload(secret: string, body: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(body);
  return `sha256=${hmac.digest("hex")}`;
}

/**
 * Dispatch a webhook event to all active endpoints that subscribe to it.
 * Fire-and-forget: errors are logged but not thrown.
 */
export async function dispatchWebhookEvent(
  eventType: WebhookEventType,
  data: Record<string, unknown>
): Promise<void> {
  const db = (await getDb())!;
  if (!db) return;

  // Find all active endpoints that subscribe to this event type
  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.isActive, true));

  const subscribedEndpoints = endpoints.filter(
    ep =>
      Array.isArray(ep.events) &&
      (ep.events.includes(eventType) || ep.events.includes("*"))
  );

  if (subscribedEndpoints.length === 0) return;

  const payload: WebhookPayload = {
    event: eventType,
    timestamp: new Date().toISOString(),
    data,
  };
  const body = JSON.stringify(payload);

  for (const endpoint of subscribedEndpoints) {
    // Create a delivery record
    const [delivery] = await db
      .insert(webhookDeliveries)
      .values({
        endpointId: endpoint.id,
        eventType,
        payload: payload as unknown as Record<string, unknown>,
        status: "pending",
        attemptCount: 0,
        maxAttempts: 3,
      })
      .returning();

    // Attempt delivery (non-blocking)
    attemptDelivery(endpoint, delivery.id, body, endpoint.secret).catch(err =>
      logger.error(`[Webhook] Delivery error for endpoint ${endpoint.id}:: ` + err)
    );
  }
}

/**
 * Attempt to deliver a webhook with retry logic.
 */
async function attemptDelivery(
  endpoint: typeof webhookEndpoints.$inferSelect,
  deliveryId: number,
  body: string,
  secret: string,
  attempt = 1
): Promise<void> {
  const db = (await getDb())!;
  if (!db) return;

  const signature = signPayload(secret, body);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-InsurePortal-Signature": signature,
        "X-InsurePortal-Event": body ? JSON.parse(body).event : "",
        "X-InsurePortal-Delivery": String(deliveryId),
        "User-Agent": "InsurePortal-Webhook/1.0",
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseBody = await response.text().catch(() => "");
    const success = response.status >= 200 && response.status < 300;

    await db
      .update(webhookDeliveries)
      .set({
        status: success ? "delivered" : attempt < 3 ? "retrying" : "failed",
        statusCode: response.status,
        responseBody: responseBody.substring(0, 1000),
        attemptCount: attempt,
        deliveredAt: success ? new Date() : undefined,
        nextRetryAt:
          !success && attempt < 3
            ? new Date(Date.now() + Math.pow(2, attempt) * 5000)
            : undefined,
      })
      .where(eq(webhookDeliveries.id, deliveryId));

    // Update endpoint stats
    await db
      .update(webhookEndpoints)
      .set({
        lastDeliveryAt: new Date(),
        lastStatusCode: response.status,
        failureCount: success ? 0 : endpoint.failureCount + 1,
      })
      .where(eq(webhookEndpoints.id, endpoint.id));

    if (!success && attempt < 3) {
      const delay = Math.pow(2, attempt) * 5000;
      setTimeout(
        () => attemptDelivery(endpoint, deliveryId, body, secret, attempt + 1),
        delay
      );
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await db
      .update(webhookDeliveries)
      .set({
        status: attempt < 3 ? "retrying" : "failed",
        responseBody: errMsg.substring(0, 1000),
        attemptCount: attempt,
        nextRetryAt:
          attempt < 3
            ? new Date(Date.now() + Math.pow(2, attempt) * 5000)
            : undefined,
      })
      .where(eq(webhookDeliveries.id, deliveryId));

    if (attempt < 3) {
      const delay = Math.pow(2, attempt) * 5000;
      setTimeout(
        () => attemptDelivery(endpoint, deliveryId, body, secret, attempt + 1),
        delay
      );
    }
  }
}

/**
 * Retry all pending/retrying deliveries whose nextRetryAt has passed.
 * Called by a cron job every 5 minutes.
 */
export async function retryPendingDeliveries(): Promise<number> {
  const db = (await getDb())!;
  if (!db) return 0;

  const now = new Date();
  const pending = await db
    .select({
      delivery: webhookDeliveries,
      endpoint: webhookEndpoints,
    })
    .from(webhookDeliveries)
    .innerJoin(
      webhookEndpoints,
      eq(webhookDeliveries.endpointId, webhookEndpoints.id)
    )
    .where(
      and(
        eq(webhookDeliveries.status, "retrying"),
        lte(webhookDeliveries.nextRetryAt, now)
      )
    )
    .limit(50);

  for (const { delivery, endpoint } of pending) {
    const body = JSON.stringify(delivery.payload);
    attemptDelivery(
      endpoint,
      delivery.id,
      body,
      endpoint.secret,
      delivery.attemptCount + 1
    ).catch(err => logger.error(`[Webhook] Retry error:: ` + String(err)));
  }

  return pending.length;
}
