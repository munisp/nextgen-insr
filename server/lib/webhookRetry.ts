// @ts-check

// TypeScript enabled — Sprint 96 security audit
interface WebhookAttempt {
  attemptNumber: number;
  statusCode: number;
  responseTimeMs: number;
  success: boolean;
  error?: string;
  timestamp: Date;
}

interface WebhookDeliveryRecord {
  id: string;
  url: string;
  eventType: string;
  payload: any;
  maxRetries: number;
  status: "pending" | "delivered" | "retrying" | "dead_letter";
  attempts: WebhookAttempt[];
  createdAt: Date;
  updatedAt: Date;
}

let deadLetterQueue: WebhookDeliveryRecord[] = [];

export function createDeliveryRecord(
  url: string,
  eventType: string,
  payload: any,
  maxRetries: number = 5
): WebhookDeliveryRecord {
  return {
    id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    url,
    eventType,
    payload,
    maxRetries,
    status: "pending",
    attempts: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export function recordAttempt(
  record: WebhookDeliveryRecord,
  statusCode: number,
  responseTimeMs: number,
  error?: string
): void {
  const success = statusCode >= 200 && statusCode < 300;
  record.attempts.push({
    attemptNumber: record.attempts.length + 1,
    statusCode,
    responseTimeMs,
    success,
    error,
    timestamp: new Date(),
  });
  record.updatedAt = new Date();
  if (success) {
    record.status = "delivered";
  } else if (record.attempts.length >= record.maxRetries) {
    record.status = "dead_letter";
    deadLetterQueue.push(record);
  } else {
    record.status = "retrying";
  }
}

export function calculateBackoffDelay(
  attempt: number,
  jitter: boolean = false
): number {
  const base = 1000 * Math.pow(2, attempt);
  const delay = Math.min(base, 300000);
  if (jitter) {
    return Math.round(delay + delay * 0.25 * (Math.random() * 2 - 1));
  }
  return delay;
}

export function getDeadLetterQueue(): WebhookDeliveryRecord[] {
  return [...deadLetterQueue];
}
export function clearDeadLetterQueue(): void {
  deadLetterQueue = [];
}

export async function deliverWebhook(delivery: {
  webhookId: number;
  url: string;
  payload: any;
  attempt: number;
  maxAttempts: number;
}): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(delivery.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-ID": String(delivery.webhookId),
        "X-Webhook-Attempt": String(delivery.attempt),
      },
      body: JSON.stringify(delivery.payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (response.ok) return { success: true, statusCode: response.status };
    if (response.status >= 500 && delivery.attempt < delivery.maxAttempts) {
      await new Promise(r =>
        setTimeout(r, calculateBackoffDelay(delivery.attempt, true))
      );
      return deliverWebhook({ ...delivery, attempt: delivery.attempt + 1 });
    }
    return {
      success: false,
      statusCode: response.status,
      error: `HTTP ${response.status}`,
    };
  } catch (err) {
    if (delivery.attempt < delivery.maxAttempts) {
      await new Promise(r =>
        setTimeout(r, calculateBackoffDelay(delivery.attempt, true))
      );
      return deliverWebhook({ ...delivery, attempt: delivery.attempt + 1 });
    }
    return { success: false, error: (err as Error).message };
  }
}
