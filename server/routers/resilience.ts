// @ts-nocheck
/**
 * resilience router
 *
 * Thin tRPC proxy that bridges the three Nigeria-resilience microservices
 * into the existing POS tRPC API surface:
 *
 *   Go  resilience-agent  :8031  → probe, carrier, retry
 *   Rust offline-queue    :8032  → queue CRUD, USSD encode
 *   Python analytics      :8033  → success-rate stats
 *
 * All calls are wrapped with a 3-second timeout and return safe fallbacks
 * so the POS UI never crashes when a sidecar is not running.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { notifyOwner } from "../_core/notification";
import { ENV } from "../_core/env";
import { getFluvioStatus } from "../lib/fluvioClient";
import { redisIsHealthy } from "../redisClient";
import { getDb } from "../db";
import { and, count, desc, eq, gte, isNull, lt, or } from "drizzle-orm";
import {
  agentPushSubscriptions,
  connectivityLog,
  dlqMessages,
  erpSyncLog,
  mqttBridgeConfig,
} from "../../drizzle/schema";
import webpush from "web-push";
import { TRPCError } from "@trpc/server";

// Configure VAPID keys for Web Push
// SECURITY: Guard against empty VAPID keys (test/dev environments may not have them set)
if (ENV.vapidPublicKey && ENV.vapidPrivateKey) {
  webpush.setVapidDetails(
    ENV.vapidSubject,
    ENV.vapidPublicKey,
    ENV.vapidPrivateKey
  );
} else {
  console.warn(
    "[WebPush] VAPID keys not configured — push notifications disabled. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in production."
  );
}

const RESILIENCE_URL = ENV.resilienceAgentUrl;
const OFFLINE_URL = ENV.offlineQueueUrl;
const ANALYTICS_URL = ENV.analyticsServiceUrl;
const TIMEOUT_MS = 3_000;

async function safeFetch<T>(
  url: string,
  init?: RequestInit,
  fallback?: T
): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return fallback ?? null;
    return (await res.json()) as T;
  } catch {
    return fallback ?? null;
  }
}

export const resilienceRouter = router({
  // ── Go: connection probe ──────────────────────────────────────────────────
  probe: protectedProcedure.query(async () => {
    const result = await safeFetch<{
      quality: string;
      latency_ms: number;
      timestamp: string;
      error?: string;
    }>(`${RESILIENCE_URL}/probe`);
    return (
      result ?? {
        quality: "Unknown",
        latency_ms: null,
        timestamp: new Date().toISOString(),
      }
    );
  }),

  // ── Go: carrier detection ─────────────────────────────────────────────────
  detectCarrier: protectedProcedure
    .input(z.object({ phone: z.string() }))
    .query(async ({ input }) => {
      try {
        const result = await safeFetch<{
          name: string;
          code: string;
          ussd: string;
          color: string;
        }>(`${RESILIENCE_URL}/carrier/${encodeURIComponent(input.phone)}`);
        return (
          result ?? {
            name: "Unknown",
            code: "unknown",
            ussd: "",
            color: "#888888",
          }
        );
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Rust: USSD encode ─────────────────────────────────────────────────────
  encodeUssd: protectedProcedure
    .input(
      z.object({
        txType: z.string(),
        amount: z.number().positive(),
        destinationAccount: z.string().optional(),
        destinationBank: z.string().optional(),
        customerPhone: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await safeFetch<{
          ussd_string: string;
          instructions: string;
          carrier_hint: string | null;
        }>(`${OFFLINE_URL}/ussd/encode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tx_type: input.txType,
            amount: input.amount,
            destination_account: input.destinationAccount,
            destination_bank: input.destinationBank,
            customer_phone: input.customerPhone,
          }),
        });
        return (
          result ?? {
            ussd_string: `*966*${Math.round(input.amount)}#`,
            instructions: `Dial *966*${Math.round(input.amount)}# to pay via USSD.`,
            carrier_hint: null,
          }
        );
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Rust: offline queue count ─────────────────────────────────────────────
  queueCount: protectedProcedure.query(async () => {
    const result = await safeFetch<{ pending: number }>(
      `${OFFLINE_URL}/queue/count`
    );
    return { pending: result?.pending ?? 0 };
  }),

  // ── Rust: enqueue offline transaction ────────────────────────────────────
  enqueueOffline: protectedProcedure
    .input(
      z.object({
        txType: z.string(),
        amount: z.number().positive(),
        customerName: z.string().optional(),
        customerPhone: z.string().optional(),
        destinationBank: z.string().optional(),
        destinationAccount: z.string().optional(),
        channel: z.string().optional(),
        payloadJson: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await safeFetch<{ id: string; queued_at: string }>(
          `${OFFLINE_URL}/queue/enqueue`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tx_type: input.txType,
              amount: input.amount,
              customer_name: input.customerName,
              customer_phone: input.customerPhone,
              destination_bank: input.destinationBank,
              destination_account: input.destinationAccount,
              channel: input.channel,
              payload_json: input.payloadJson,
            }),
          }
        );
        return result ?? { id: "unknown", queued_at: new Date().toISOString() };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Rust: dequeue (pop) one item from the offline queue ───────────────────
  dequeueOffline: protectedProcedure
    .input(z.object({ id: z.string().optional() }))
    .mutation(async ({ input }) => {
      try {
        // If a specific id is provided, dequeue that item; otherwise list pending
        // and dequeue the oldest one
        if (input.id) {
          const result = await safeFetch<{ success: boolean }>(
            `${OFFLINE_URL}/queue/dequeue/${input.id}`,
            { method: "POST" }
          );
          return { item: null, dequeued: result?.success ?? false };
        }
        // Pop the oldest pending item: list → take first → dequeue it
        const pending = await safeFetch<
          Array<{
            id: string;
            tx_type: string;
            amount: number;
            customer_name?: string;
            customer_phone?: string;
            destination_bank?: string;
            destination_account?: string;
            channel?: string;
            payload_json?: string;
          }>
        >(`${OFFLINE_URL}/queue/pending`);
        if (!pending || pending.length === 0)
          return { item: null, dequeued: false };
        const oldest = pending[0];
        await safeFetch(`${OFFLINE_URL}/queue/dequeue/${oldest.id}`, {
          method: "POST",
        });
        return { item: oldest, dequeued: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Python: bulk per-agent success rates ────────────────────────────────────────────
  agentSuccessRates: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(90).default(7) }))
    .query(async ({ input }) => {
      try {
        const result = await safeFetch<{
          agents: Array<{
            agent_code: string;
            agent_name: string;
            agent_status: string;
            success_rate_pct: number | null;
            tier: string | null;
            total_transactions: number;
            success_count: number;
            failed_count: number;
            volume_ngn: number;
            total_commission_ngn: number;
          }>;
          period_days: number;
          computed_at: string;
        }>(`${ANALYTICS_URL}/stats/all-agents?days=${input.days}`);
        return (
          result ?? {
            agents: [],
            period_days: input.days,
            computed_at: new Date().toISOString(),
          }
        );
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Python: 7-day success rate ────────────────────────────────────────────
  successRate: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(90).default(7) }))
    .query(async ({ input }) => {
      try {
        const result = await safeFetch<{
          success_rate_pct: number;
          tier: string;
          total_transactions: number;
          success_count: number;
          failed_count: number;
          reversed_count: number;
          daily_series: Array<{
            day: string;
            success_count: number;
            total_count: number;
            rate: number;
          }>;
          computed_at: string;
        }>(`${ANALYTICS_URL}/stats/success-rate?days=${input.days}`);
        return (
          result ?? {
            success_rate_pct: 0,
            tier: "Unknown",
            total_transactions: 0,
            success_count: 0,
            failed_count: 0,
            reversed_count: 0,
            daily_series: [],
            computed_at: new Date().toISOString(),
          }
        );
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Aggregated system status: Fluvio + Redis + ERP + email + MQTT + Go agent ──
  systemStatus: protectedProcedure.query(async () => {
    // Fluvio (in-process)
    const fluvio = getFluvioStatus();

    // Redis health (async, safe)
    let redisHealthy = false;
    let redisMode: "direct" | "proxy" | "unavailable" = "unavailable";
    try {
      redisHealthy = await redisIsHealthy();
      redisMode = ENV.redisUrl ? "direct" : "proxy";
    } catch {
      /* unavailable */
    }

    // ERP retry queue: last 5 failed entries from DB
    let erpPending = 0;
    let erpDeadLetter = 0;
    let erpLastRetry: string | null = null;
    try {
      const db = (await getDb())!;
      if (db) {
        const pendingRows = await db
          .select()
          .from(erpSyncLog)
          .where(eq(erpSyncLog.status, "pending"))
          .orderBy(desc(erpSyncLog.createdAt))
          .limit(100);
        erpPending = pendingRows.length;
        const failedRows = await db
          .select()
          .from(erpSyncLog)
          .where(eq(erpSyncLog.status, "failed"))
          .orderBy(desc(erpSyncLog.createdAt))
          .limit(5);
        erpDeadLetter = failedRows.length;
        if (failedRows.length > 0) {
          erpLastRetry = failedRows[0].createdAt?.toISOString() ?? null;
        }
        if (pendingRows.length > 0) {
          const nextRetry = pendingRows[0].nextRetryAt;
          if (nextRetry) erpLastRetry = nextRetry.toISOString();
        }
      }
    } catch {
      /* DB unavailable */
    }

    // Go resilience-agent retry history
    const retryHistory = await safeFetch<
      Array<{
        attempt: number;
        status: string;
        latency_ms: number;
        timestamp: string;
      }>
    >(`${RESILIENCE_URL}/retry/history`);

    // MQTT bridge status from DB config
    let mqttStatus = "unconfigured";
    let mqttBroker = "";
    let mqttQos = "1";
    let mqttTopicCount = 0;
    try {
      const db = (await getDb())!;
      if (db) {
        const rows = await db.select().from(mqttBridgeConfig).limit(1);
        if (rows.length > 0) {
          const cfg = rows[0];
          mqttStatus = cfg.enabled
            ? (cfg.lastTestStatus ?? "unknown")
            : "disabled";
          mqttBroker = cfg.brokerUrl ?? "";
          mqttQos = cfg.qos ?? "1";
          const mappings = (cfg.topicMappings as Array<unknown>) ?? [];
          mqttTopicCount = mappings.length;
        }
      }
    } catch {
      /* unavailable */
    }

    // Rust offline queue pending list
    const pendingItems = await safeFetch<
      Array<{
        id: string;
        tx_type: string;
        amount: number;
        customer_name?: string;
        customer_phone?: string;
        channel?: string;
        queued_at?: string;
      }>
    >(`${OFFLINE_URL}/queue/pending`);

    return {
      fluvio: {
        connected: fluvio.connected,
        mode: fluvio.mode,
        bufferedEvents: fluvio.bufferedEvents,
        topicCount: fluvio.topics.length,
        endpoint: fluvio.endpoint,
      },
      redis: {
        healthy: redisHealthy,
        mode: redisMode,
      },
      erp: {
        pendingCount: erpPending,
        deadLetterCount: erpDeadLetter,
        lastRetryAt: erpLastRetry,
        nextRetryAt: null,
      },
      mqtt: {
        status: mqttStatus,
        broker: mqttBroker,
        qos: mqttQos,
        topicCount: mqttTopicCount,
      },
      goAgent: {
        retryHistory: retryHistory ?? [],
      },
      rustQueue: {
        pendingItems: pendingItems ?? [],
      },
      checkedAt: new Date().toISOString(),
    };
  }),

  // ── Rust: list all pending offline queue items ────────────────────────────
  listPendingOffline: protectedProcedure.query(async () => {
    const result = await safeFetch<
      Array<{
        id: string;
        tx_type: string;
        amount: number;
        customer_name?: string;
        customer_phone?: string;
        destination_bank?: string;
        destination_account?: string;
        channel?: string;
        queued_at?: string;
      }>
    >(`${OFFLINE_URL}/queue/pending`);
    return result ?? [];
  }),

  // ── Rust: discard a specific offline queue item ───────────────────────────
  discardOfflineItem: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const result = await safeFetch<{ success: boolean }>(
          `${OFFLINE_URL}/queue/discard/${input.id}`,
          { method: "DELETE" }
        );
        // Fallback: try dequeue if discard endpoint doesn't exist
        if (!result) {
          await safeFetch(`${OFFLINE_URL}/queue/dequeue/${input.id}`, {
            method: "POST",
          });
        }
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Web Push: save push subscription for an agent ───────────────────────
  savePushSubscription: protectedProcedure
    .input(
      z.object({
        agentCode: z.string(),
        endpoint: z.string().url(),
        p256dhKey: z.string(),
        authKey: z.string(),
        userAgent: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { ok: false };
        await db
          .insert(agentPushSubscriptions)
          .values({
            agentCode: input.agentCode,
            endpoint: input.endpoint,
            p256dhKey: input.p256dhKey,
            authKey: input.authKey,
            userAgent: input.userAgent,
          })
          .onConflictDoUpdate({
            target: agentPushSubscriptions.endpoint,
            set: {
              agentCode: input.agentCode,
              p256dhKey: input.p256dhKey,
              authKey: input.authKey,
              userAgent: input.userAgent,
              updatedAt: new Date(),
            },
          });
        return { ok: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Web Push: notify agent of pending offline items ───────────────────────
  notifyPendingSync: protectedProcedure
    .input(
      z.object({
        agentCode: z.string(),
        pendingCount: z.number().int().min(1),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { sent: 0, failed: 0 };
        const subs = await db
          .select()
          .from(agentPushSubscriptions)
          .where(eq(agentPushSubscriptions.agentCode, input.agentCode));

        if (subs.length === 0) return { sent: 0, failed: 0 };

        const payload = JSON.stringify({
          title: "InsurePortal — Offline Sync Pending",
          body: `You have ${input.pendingCount} offline transaction${input.pendingCount > 1 ? "s" : ""} waiting to sync. Open the app to complete them.`,
          tag: "offline-sync-pending",
          url: "/pos?screen=offline-resilience",
          icon: "/favicon.ico",
        });

        let sent = 0;
        let failed = 0;
        const staleEndpoints: string[] = [];

        await Promise.allSettled(
          subs.map(async (sub: typeof agentPushSubscriptions.$inferSelect) => {
            try {
              await webpush.sendNotification(
                {
                  endpoint: sub.endpoint,
                  keys: { p256dh: sub.p256dhKey, auth: sub.authKey },
                },
                payload,
                { TTL: 3600 }
              );
              sent++;
            } catch (err: unknown) {
              const status = (err as { statusCode?: number }).statusCode;
              if (status === 410 || status === 404)
                staleEndpoints.push(sub.endpoint);
              failed++;
            }
          })
        );

        if (staleEndpoints.length > 0) {
          await Promise.allSettled(
            staleEndpoints.map((ep: any) =>
              db
                .delete(agentPushSubscriptions)
                .where(eq(agentPushSubscriptions.endpoint, ep))
            )
          );
        }

        return { sent, failed };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── POS Printer: print USSD fallback receipt via Rust ESC/POS sidecar ─────────
  printUssdReceipt: protectedProcedure
    .input(
      z.object({
        agentCode: z.string(),
        txType: z.string(),
        amount: z.number().positive(),
        ussdString: z.string(),
        instructions: z.string(),
        customerName: z.string().optional(),
        ref: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const printerUrl = ENV.posPrinterUrl;
        const receiptPayload = {
          receipt_type: "ussd_fallback",
          agent_code: input.agentCode,
          tx_type: input.txType,
          amount: input.amount,
          ussd_string: input.ussdString,
          instructions: input.instructions,
          customer_name: input.customerName ?? "Customer",
          ref: input.ref ?? `USSD-${Date.now()}`,
          printed_at: new Date().toISOString(),
        };
        const result = await safeFetch<{ job_id: string; status: string }>(
          `${printerUrl}/print/receipt`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(receiptPayload),
          }
        );
        // Graceful fallback: if printer is offline, return success with a note
        return result ?? { job_id: "offline", status: "queued_for_print" };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Python: by-type breakdown ─────────────────────────────────────────────
  statsByType: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(90).default(7) }))
    .query(async ({ input }) => {
      try {
        const result = await safeFetch<{
          breakdown: Array<{
            type: string;
            success_count: number;
            failed_count: number;
            total_count: number;
            total_volume_ngn: number;
            success_rate_pct: number;
          }>;
        }>(`${ANALYTICS_URL}/stats/by-type?days=${input.days}`);
        return result ?? { breakdown: [] };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── ERP: retry all dead-letter / failed items ─────────────────────────────
  retryDeadLetter: protectedProcedure.mutation(async () => {
    const db = (await getDb())!;
    if (!db) return { requeued: 0 };
    // Reset failed items back to pending so the exponential-backoff worker picks them up
    const result = await db
      .update(erpSyncLog)
      .set({
        status: "pending" as const,
        retryCount: 0,
        nextRetryAt: new Date(),
        errorMessage: null,
      })
      .where(eq(erpSyncLog.status, "failed"));
    return { requeued: result.rowCount ?? 0 };
  }),

  // ── Connectivity log: record a probe result ───────────────────────────────
  logConnectivity: protectedProcedure
    .input(
      z.object({
        agentCode: z.string(),
        quality: z.enum(["Excellent", "Good", "Poor", "Offline"]),
        latencyMs: z.number().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { logged: false };
        await db.insert(connectivityLog).values({
          agentCode: input.agentCode,
          quality: input.quality,
          latencyMs: input.latencyMs ?? undefined,
          recordedAt: new Date(),
        });
        return { logged: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Connectivity log: fetch last N hours of history ───────────────────────
  getConnectivityHistory: protectedProcedure
    .input(
      z.object({
        agentCode: z.string(),
        hours: z.number().int().min(1).max(168).default(24),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { rows: [], uptimePct: 100, avgLatencyMs: 0 };
        const since = new Date(Date.now() - input.hours * 3_600_000);
        const rows = await db
          .select()
          .from(connectivityLog)
          .where(
            and(
              eq(connectivityLog.agentCode, input.agentCode),
              gte(connectivityLog.recordedAt, since)
            )
          )
          .orderBy(connectivityLog.recordedAt)
          .limit(500);

        const total = rows.length;
        const online = rows.filter(r => r.quality !== "Offline").length;
        const uptimePct = total > 0 ? Math.round((online / total) * 100) : 100;
        const latencyRows = rows.filter(r => r.latencyMs !== null);
        const avgLatencyMs =
          latencyRows.length > 0
            ? Math.round(
                latencyRows.reduce(
                  (s: any, r: any) => s + (r.latencyMs ?? 0),
                  0
                ) / latencyRows.length
              )
            : 0;

        return { rows, uptimePct, avgLatencyMs };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Connectivity alert: VAPID push + owner notification when uptime < 80% ──
  alertOnPoorConnectivity: protectedProcedure
    .input(z.object({ agentCode: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { alerted: false, reason: "db_unavailable" as const };

        const since = new Date(Date.now() - 3_600_000);
        const rows = await db
          .select()
          .from(connectivityLog)
          .where(
            and(
              eq(connectivityLog.agentCode, input.agentCode),
              gte(connectivityLog.recordedAt, since)
            )
          )
          .limit(200);

        if (rows.length < 3) {
          return {
            alerted: false,
            reason: "insufficient_data" as const,
            probes: rows.length,
          };
        }

        const online = rows.filter(r => r.quality !== "Offline").length;
        const uptimePct = Math.round((online / rows.length) * 100);

        if (uptimePct >= 80) {
          return { alerted: false, reason: "uptime_ok" as const, uptimePct };
        }

        // ── Alert throttling: skip if ALL subscriptions were alerted within the last 30 min ──
        const throttleWindow = new Date(Date.now() - 30 * 60_000);
        const allSubs = await db
          .select()
          .from(agentPushSubscriptions)
          .where(eq(agentPushSubscriptions.agentCode, input.agentCode))
          .limit(50);
        if (allSubs.length > 0) {
          const eligibleSubs = allSubs.filter(
            s => !s.lastAlertedAt || s.lastAlertedAt < throttleWindow
          );
          if (eligibleSubs.length === 0) {
            console.log(
              `[alertOnPoorConnectivity] Agent ${input.agentCode}: throttled — all subs alerted within 30 min`
            );
            return { alerted: false, reason: "throttled" as const, uptimePct };
          }
        }

        const alertTitle = `[InsurePortal] Poor connectivity — Agent ${input.agentCode}`;
        const alertContent =
          `Agent ${input.agentCode} has had ${uptimePct}% uptime in the last hour ` +
          `(${online}/${rows.length} probes online). Immediate attention may be required.`;

        const ownerNotified = await notifyOwner({
          title: alertTitle,
          content: alertContent,
        }).catch(() => false);

        let pushCount = 0;
        try {
          const subs = await db
            .select()
            .from(agentPushSubscriptions)
            .where(eq(agentPushSubscriptions.agentCode, input.agentCode))
            .limit(50);

          const payload = JSON.stringify({
            title: `Poor Connectivity (${uptimePct}% uptime)`,
            body: `Agent ${input.agentCode}: only ${uptimePct}% uptime in the last hour.`,
            tag: `connectivity-alert-${input.agentCode}`,
            data: { agentCode: input.agentCode, uptimePct },
          });

          const results = await Promise.allSettled(
            subs.map(sub =>
              webpush.sendNotification(
                {
                  endpoint: sub.endpoint,
                  keys: { p256dh: sub.p256dhKey, auth: sub.authKey },
                },
                payload,
                { TTL: 3600 }
              )
            )
          );
          pushCount = results.filter(r => r.status === "fulfilled").length;
          // Update lastAlertedAt for all subscriptions to enforce throttle window
          if (pushCount > 0) {
            const now = new Date();
            await db
              .update(agentPushSubscriptions)
              .set({ lastAlertedAt: now, updatedAt: now })
              .where(eq(agentPushSubscriptions.agentCode, input.agentCode));
          }
        } catch (err) {
          console.warn("[alertOnPoorConnectivity] VAPID push error:", err);
        }

        console.log(
          `[alertOnPoorConnectivity] Agent ${input.agentCode}: ${uptimePct}% uptime — ` +
            `ownerNotified=${ownerNotified}, pushCount=${pushCount}`
        );

        return { alerted: true, uptimePct, ownerNotified, pushCount };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Dead Letter Queue (DLQ) CRUD ─────────────────────────────────────────────────────
  listDlqMessages: protectedProcedure
    .input(
      z.object({
        topic: z.string().optional(),
        status: z.string().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { items: [], total: 0 };
        const conditions = [];
        if (input.topic) conditions.push(eq(dlqMessages.topic, input.topic));
        if (input.status) conditions.push(eq(dlqMessages.status, input.status));
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const [items, [{ total }]] = await Promise.all([
          db
            .select()
            .from(dlqMessages)
            .where(where)
            .orderBy(desc(dlqMessages.createdAt))
            .limit(input.limit)
            .offset(input.offset),
          db.select({ total: count() }).from(dlqMessages).where(where),
        ]);
        return { items, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  createDlqMessage: protectedProcedure
    .input(
      z.object({
        topic: z.string().min(1).max(128),
        partition: z.number().int().default(0),
        offset: z.string().default("0"),
        errorMessage: z.string(),
        payload: z.string().default("{}"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database connection unavailable");
        const [row] = await db
          .insert(dlqMessages)
          .values({
            topic: input.topic,
            partition: input.partition,
            offset: input.offset,
            errorMessage: input.errorMessage,
            payload: input.payload,
            status: "pending_retry",
          })
          .returning();
        return row;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  resolveDlqMessage: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("DB unavailable");
        await db
          .update(dlqMessages)
          .set({ status: "resolved", resolvedAt: new Date() })
          .where(eq(dlqMessages.id, input.id));
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  retryDlqMessage: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("DB unavailable");
        const [existing] = await db
          .select({ retryCount: dlqMessages.retryCount })
          .from(dlqMessages)
          .where(eq(dlqMessages.id, input.id))
          .limit(1);
        if (!existing) throw new Error("DLQ message not found");
        const [row] = await db
          .update(dlqMessages)
          .set({
            status: "pending_retry",
            retryCount: (existing.retryCount ?? 0) + 1,
          })
          .where(eq(dlqMessages.id, input.id))
          .returning();
        return row;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── List push subscriptions for the dashboard panel (shows lastAlertedAt) ────────────────────────
  getPushSubscriptions: protectedProcedure
    .input(z.object({ agentCode: z.string().min(1).max(32) }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { subscriptions: [] };
        const subs = await db
          .select()
          .from(agentPushSubscriptions)
          .where(eq(agentPushSubscriptions.agentCode, input.agentCode))
          .orderBy(agentPushSubscriptions.createdAt);
        return {
          subscriptions: subs.map(s => ({
            id: s.id,
            endpoint: s.endpoint,
            createdAt: s.createdAt,
            lastAlertedAt: s.lastAlertedAt ?? null,
          })),
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

  // ── Sprint 73: Adaptive Network & Graceful Degradation ─────────────────────

  /**
   * Get adaptive feature flags for a given network tier.
   * Client calls this after detecting network quality to know which features to enable/disable.
   */
  getAdaptiveFlags: protectedProcedure
    .input(
      z.object({
        tier: z.enum([
          "2g_gprs",
          "2g_edge",
          "3g",
          "4g_lte",
          "5g_wifi",
          "offline",
        ]),
      })
    )
    .query(({ input }) => {
      const FEATURE_MATRIX = {
        "5g_wifi": {
          useWebSocket: true,
          usePolling: false,
          pollingIntervalMs: 0,
          loadImages: true,
          loadCharts: true,
          enableAnimations: true,
          maxListPageSize: 100,
          textOnlyMode: false,
          compressionHint: "none",
          syncIntervalMs: 5000,
          requestTimeoutMs: 10000,
          maxRetries: 3,
          useSmssFallback: false,
          useUssdFallback: false,
        },
        "4g_lte": {
          useWebSocket: true,
          usePolling: false,
          pollingIntervalMs: 0,
          loadImages: true,
          loadCharts: true,
          enableAnimations: true,
          maxListPageSize: 50,
          textOnlyMode: false,
          compressionHint: "gzip",
          syncIntervalMs: 10000,
          requestTimeoutMs: 15000,
          maxRetries: 3,
          useSmssFallback: false,
          useUssdFallback: false,
        },
        "3g": {
          useWebSocket: false,
          usePolling: true,
          pollingIntervalMs: 30000,
          loadImages: false,
          loadCharts: false,
          enableAnimations: false,
          maxListPageSize: 25,
          textOnlyMode: false,
          compressionHint: "gzip",
          syncIntervalMs: 30000,
          requestTimeoutMs: 30000,
          maxRetries: 5,
          useSmssFallback: false,
          useUssdFallback: false,
        },
        "2g_edge": {
          useWebSocket: false,
          usePolling: true,
          pollingIntervalMs: 60000,
          loadImages: false,
          loadCharts: false,
          enableAnimations: false,
          maxListPageSize: 10,
          textOnlyMode: true,
          compressionHint: "deflate",
          syncIntervalMs: 60000,
          requestTimeoutMs: 60000,
          maxRetries: 10,
          useSmssFallback: true,
          useUssdFallback: false,
        },
        "2g_gprs": {
          useWebSocket: false,
          usePolling: true,
          pollingIntervalMs: 120000,
          loadImages: false,
          loadCharts: false,
          enableAnimations: false,
          maxListPageSize: 5,
          textOnlyMode: true,
          compressionHint: "deflate",
          syncIntervalMs: 120000,
          requestTimeoutMs: 120000,
          maxRetries: 15,
          useSmssFallback: true,
          useUssdFallback: true,
        },
        offline: {
          useWebSocket: false,
          usePolling: false,
          pollingIntervalMs: 0,
          loadImages: false,
          loadCharts: false,
          enableAnimations: false,
          maxListPageSize: 5,
          textOnlyMode: true,
          compressionHint: "none",
          syncIntervalMs: 0,
          requestTimeoutMs: 0,
          maxRetries: 0,
          useSmssFallback: true,
          useUssdFallback: true,
        },
      };
      return {
        tier: input.tier,
        flags: FEATURE_MATRIX[input.tier] || FEATURE_MATRIX["3g"],
        essentialFeatures: ["transactions", "balance", "auth", "offline_queue"],
        nonEssentialFeatures: [
          "charts",
          "animations",
          "images",
          "real_time_updates",
          "notifications",
        ],
      };
    }),

  /**
   * Report terminal network quality telemetry.
   * Returns adapted configuration for the detected tier.
   */
  reportTerminalTelemetry: protectedProcedure
    .input(
      z.object({
        terminalId: z.string(),
        latencyMs: z.number(),
        bandwidthKbps: z.number(),
        packetLossPct: z.number(),
        jitterMs: z.number().optional(),
        signalStrengthDbm: z.number().optional(),
        effectiveType: z.string().optional(),
        queuedTransactions: z.number().optional(),
      })
    )
    .mutation(({ input }) => {
      // Detect tier from telemetry
      let tier = "3g";
      if (input.packetLossPct > 30) tier = "offline";
      else if (input.latencyMs > 1000 || input.bandwidthKbps < 50)
        tier = "2g_gprs";
      else if (input.latencyMs > 500 || input.bandwidthKbps < 200)
        tier = "2g_edge";
      else if (input.latencyMs > 100 || input.bandwidthKbps < 2000) tier = "3g";
      else if (input.latencyMs > 50 || input.bandwidthKbps < 50000)
        tier = "4g_lte";
      else tier = "5g_wifi";

      const state =
        tier === "offline"
          ? "offline"
          : input.packetLossPct > 10
            ? "degraded"
            : "online";

      return {
        tier,
        state,
        recommendations: {
          syncIntervalMs:
            tier === "2g_gprs"
              ? 120000
              : tier === "2g_edge"
                ? 60000
                : tier === "3g"
                  ? 30000
                  : 10000,
          maxListPageSize:
            tier === "2g_gprs"
              ? 5
              : tier === "2g_edge"
                ? 10
                : tier === "3g"
                  ? 25
                  : 50,
          useWebSocket: tier === "4g_lte" || tier === "5g_wifi",
          usePolling:
            tier !== "offline" && tier !== "5g_wifi" && tier !== "4g_lte",
          useSmssFallback:
            tier === "2g_gprs" || tier === "2g_edge" || tier === "offline",
          useUssdFallback: tier === "2g_gprs" || tier === "offline",
          textOnlyMode:
            tier === "2g_gprs" || tier === "2g_edge" || tier === "offline",
        },
      };
    }),

  /**
   * Get network tier distribution across all active terminals.
   */
  getTierDistribution: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    if (!db) {
      return {
        distribution: {
          "5g_wifi": 0,
          "4g_lte": 0,
          "3g": 0,
          "2g_edge": 0,
          "2g_gprs": 0,
          offline: 0,
        },
        totalTerminals: 0,
      };
    }
    // Return default distribution since we don't have real-time data in DB
    return {
      distribution: {
        "5g_wifi": 0,
        "4g_lte": 0,
        "3g": 0,
        "2g_edge": 0,
        "2g_gprs": 0,
        offline: 0,
      },
      totalTerminals: 0,
    };
  }),

  /**
   * Get resilience dashboard summary with sync stats and terminal health.
   */
  getResilienceDashboard: protectedProcedure.query(async () => {
    return {
      syncStats: {
        totalPushes: 0,
        totalAccepted: 0,
        totalRejected: 0,
        totalDuplicates: 0,
      },
      networkHealth: {
        avgLatencyMs: 0,
        avgBandwidthKbps: 0,
        totalQueuedTransactions: 0,
      },
      terminalCounts: {
        online: 0,
        degraded: 0,
        offline: 0,
      },
    };
  }),
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().default(20),
          offset: z.number().default(0),
        })
        .default({})
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { items: [], total: 0 };
        return { items: [], total: 0 };
      } catch {
        return { items: [], total: 0 };
      }
    }),
});
