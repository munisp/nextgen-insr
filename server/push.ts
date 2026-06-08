// TypeScript enabled — Sprint 96 security audit
/**
 * VAPID Web Push Notification Service
 * Sends push notifications to agents and admins via the Web Push Protocol.
 * Supports: failover alerts, fraud alerts, float top-up approvals, settlement completions.
 */
import webpush from "web-push";
import { getDb } from "./db";
import { agentPushSubscriptions } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// VAPID keys — unified with server/_core/env.ts defaults.
// Override via VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY environment variables in production.
const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ||
  "BE4Tbbh5r0IGPRlQ_0ePL0AEJfiWJynWxxM0UDmffgbenp87U4upzpn0aNysgCVQdT8IUfNSG3Dx6_k2Wn6lRgA";
const VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY ||
  "vBqalBipE6mu4a592N8c1wucdpun-RaKemy8gZDa99M";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:ops@insureportal.ng";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

export { VAPID_PUBLIC_KEY };

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
  actions?: Array<{ action: string; title: string }>;
}

/**
 * Send a push notification to a specific agent by agentCode.
 * Sends to all active subscriptions for that agent.
 */
export async function sendPushToAgent(
  agentCode: string,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  const db = await getDb();
  if (!db) return { sent: 0, failed: 0 };

  const subs = await db
    .select()
    .from(agentPushSubscriptions)
    .where(eq(agentPushSubscriptions.agentCode, agentCode));

  let sent = 0;
  let failed = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dhKey,
            auth: sub.authKey,
          },
        },
        JSON.stringify(payload),
        {
          TTL: 86400, // 24 hours
          urgency: "high",
        }
      );
      sent++;
    } catch (err: unknown) {
      failed++;
      // If subscription is expired/invalid (410 Gone), remove it
      if (
        err &&
        typeof err === "object" &&
        "statusCode" in err &&
        (err as { statusCode: number }).statusCode === 410
      ) {
        await db
          .delete(agentPushSubscriptions)
          .where(eq(agentPushSubscriptions.id, sub.id));
      }
    }
  }

  return { sent, failed };
}

/**
 * Notify agent of SIM failover event.
 */
export async function notifySimFailover(params: {
  agentCode: string;
  fromSlot: number;
  toSlot: number;
  reason: string;
  transactionRef?: string;
}): Promise<void> {
  await sendPushToAgent(params.agentCode, {
    title: "⚠️ SIM Failover Triggered",
    body: `Network switched from SIM ${params.fromSlot} to SIM ${params.toSlot}: ${params.reason}`,
    tag: "sim-failover",
    icon: "/icons/sim-alert.png",
    data: {
      type: "sim_failover",
      fromSlot: params.fromSlot,
      toSlot: params.toSlot,
      transactionRef: params.transactionRef,
    },
    actions: [
      { action: "view", title: "View Details" },
      { action: "dismiss", title: "Dismiss" },
    ],
  });
}

/**
 * Notify agent of fraud alert.
 */
export async function notifyFraudAlert(params: {
  agentCode: string;
  transactionRef: string;
  riskScore: number;
  reason: string;
}): Promise<void> {
  await sendPushToAgent(params.agentCode, {
    title: "🚨 Fraud Alert",
    body: `Transaction ${params.transactionRef} flagged (score: ${params.riskScore}): ${params.reason}`,
    tag: "fraud-alert",
    icon: "/icons/fraud-alert.png",
    data: {
      type: "fraud_alert",
      transactionRef: params.transactionRef,
      riskScore: params.riskScore,
    },
  });
}

/**
 * Notify agent of float top-up approval.
 */
export async function notifyFloatApproval(params: {
  agentCode: string;
  amount: number;
  newBalance: number;
}): Promise<void> {
  await sendPushToAgent(params.agentCode, {
    title: "✅ Float Top-Up Approved",
    body: `₦${params.amount.toLocaleString()} added to your float. New balance: ₦${params.newBalance.toLocaleString()}`,
    tag: "float-topup",
    icon: "/icons/float-approved.png",
    data: {
      type: "float_approval",
      amount: params.amount,
      newBalance: params.newBalance,
    },
  });
}

/**
 * Notify agent of settlement completion.
 */
export async function notifySettlementComplete(params: {
  agentCode: string;
  batchId: string;
  totalAmount: number;
  txCount: number;
}): Promise<void> {
  await sendPushToAgent(params.agentCode, {
    title: "💰 Settlement Complete",
    body: `Batch ${params.batchId}: ${params.txCount} transactions totalling ₦${params.totalAmount.toLocaleString()} settled.`,
    tag: "settlement",
    icon: "/icons/settlement.png",
    data: {
      type: "settlement_complete",
      batchId: params.batchId,
      totalAmount: params.totalAmount,
      txCount: params.txCount,
    },
  });
}

/**
 * Register a push subscription for an agent.
 */
export async function registerPushSubscription(params: {
  agentCode: string;
  endpoint: string;
  p256dhKey: string;
  authKey: string;
  userAgent?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .insert(agentPushSubscriptions)
    .values({
      agentCode: params.agentCode,
      endpoint: params.endpoint,
      p256dhKey: params.p256dhKey,
      authKey: params.authKey,
      userAgent: params.userAgent,
    })
    .onConflictDoUpdate({
      target: agentPushSubscriptions.endpoint,
      set: {
        p256dhKey: params.p256dhKey,
        authKey: params.authKey,
        updatedAt: new Date(),
      },
    });
}
