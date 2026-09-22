// TypeScript enabled — Sprint 96 security audit
/**
 * observabilityMiddleware.ts — tRPC middleware that automatically instruments
 * ALL procedures with Kafka event publishing, Redis caching, and Fluvio
 * streaming.
 *
 * 2026-09-19 (P-wave, perf hotspot #4):
 *  - The per-request TigerBeetle ZERO-AMOUNT "audit transfer" is REMOVED.
 *    Disclosure: it was never a real ledger entry (amount=0 between two fixed
 *    system accounts, id discarded) — it carried no financial information and
 *    existed only as a heartbeat. It cost one blocking ledger commit per
 *    procedure call and could saturate the TB connection pool under load.
 *    Real financial ledger writes (tbCreateTransfer with real amounts in the
 *    money paths) are untouched.
 *  - The remaining Kafka + Redis + Fluvio writes now run CONCURRENTLY
 *    (Promise.allSettled) inside the already fire-and-forget post-response
 *    promise, instead of four sequential awaits that held sockets and
 *    event-loop callbacks. Still non-blocking w.r.t. the response; still
 *    fail-open per sink.
 *
 * This is applied at the procedure level via tRPC's middleware chain, so
 * individual routers do NOT need to import or call any middleware functions.
 *
 * Usage: Import `instrumentedProcedure` / `instrumentedProtectedProcedure`
 * instead of `publicProcedure` / `protectedProcedure` in routers.
 *
 * Or apply globally via the `observabilityPlugin` on the tRPC instance.
 */
import { initTRPC, TRPCError } from "@trpc/server";

import type { TrpcContext } from "../_core/context";
import { logger } from '../_core/logger';
import { fluvioProduce } from "../fluvio";
import { publishEvent, type KafkaTopic } from "../kafkaClient";
import { recordErrorEvent, recordRequestMetric } from "../lib/telemetryStore";
import { cacheSet, cacheGet } from "../redisClient";


// ── Observability Middleware ──────────────────────────────────────────────────
// Wraps every procedure call with (all post-response, fire-and-forget):
// 1. Kafka event publish
// 2. Redis cache of last-call timestamp
// 3. Fluvio real-time stream event
//
// (The per-call TigerBeetle zero-amount transfer was removed 2026-09-19 —
// see the module header. It was an audit-shaped heartbeat, not a ledger
// entry.)
//
// All calls fail open so middleware never blocks or breaks business logic.

export interface ObservabilityContext {
  /** The router path, e.g. "agent.login" */
  path: string;
  /** The procedure type: "query" | "mutation" | "subscription" */
  type: string;
  /** The user ID if authenticated, or "anonymous" */
  userId: string;
  /** Correlation ID from the tRPC context (x-request-id or generated UUID) */
  requestId?: string;
  /** Start timestamp */
  startMs: number;
  /** Duration in ms */
  durationMs: number;
  /** Whether the procedure succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Publish observability events to all middleware.
 * All calls are fire-and-forget with try/catch.
 */
export async function emitObservabilityEvent(
  ctx: ObservabilityContext
): Promise<void> {
  const topic = `pos.${ctx.path.replace(/\./g, "_")}` as KafkaTopic;
  const payload = {
    path: ctx.path,
    type: ctx.type,
    userId: ctx.userId,
    requestId: ctx.requestId,
    durationMs: ctx.durationMs,
    success: ctx.success,
    error: ctx.error,
    timestamp: Date.now(),
  };

  // Structured log line with correlation ID (F-07). Contains no PII or
  // secrets: path, numeric user id, request id, duration, success, error
  // message only.
  const log = ctx.requestId
    ? logger.child({ requestId: ctx.requestId })
    : logger;
  if (ctx.success) {
    log.info(
      { path: ctx.path, type: ctx.type, userId: ctx.userId, durationMs: ctx.durationMs },
      `[trpc] ${ctx.path} ${ctx.type} ok ${ctx.durationMs}ms`
    );
  } else {
    log.warn(
      { path: ctx.path, type: ctx.type, userId: ctx.userId, durationMs: ctx.durationMs, error: ctx.error },
      `[trpc] ${ctx.path} ${ctx.type} failed ${ctx.durationMs}ms`
    );
  }

  // 2026-09-19 (P-wave, perf #4): Kafka + Redis + Fluvio run CONCURRENTLY in
  // one fire-and-forget pipeline (this whole function is invoked detached,
  // after the procedure result is already decided). Each sink fails open
  // independently; none can block the response or starve the others.
  await Promise.allSettled([
    // 1. Kafka — event bus for downstream consumers (analytics, audit, alerting)
    publishEvent(topic, ctx.userId, {
      event: `${ctx.path}.${ctx.success ? "success" : "failure"}`,
      ...payload,
    }).catch(err => {
      logger.error("[observabilityMiddleware] kafka publish failed:: " + err);
    }),

    // 2. Redis — cache last-call timestamp for rate limiting and monitoring
    cacheSet(
      `obs:${ctx.path}:${ctx.userId}:last`,
      JSON.stringify({
        ts: Date.now(),
        duration: ctx.durationMs,
        success: ctx.success,
      }),
      600 // 10 min TTL
    ).catch(err => {
      logger.error("[observabilityMiddleware] redis cacheSet failed:: " + err);
    }),

    // 3. Fluvio — real-time streaming for dashboards and alerting
    fluvioProduce(topic, {
      value: JSON.stringify(payload),
    }).catch(err => {
      logger.error("[observabilityMiddleware] fluvio produce failed:: " + err);
    }),
  ]);
}

/**
 * Create the observability tRPC middleware.
 * This can be chained onto any procedure base.
 */
export function createObservabilityMiddleware(t: any) {
  return t.middleware(
    async ({
      ctx,
      next,
      path,
      type,
    }: {
      ctx: any;
      next: any;
      path: string;
      type: string;
    }) => {
      const startMs = Date.now();
      const userId = ctx.user ? String(ctx.user.id) : "anonymous";
      const requestId: string | undefined = ctx.requestId;

      // Record one failure observation (emit + B8/B9 telemetry) for the real
      // error object, regardless of how tRPC surfaced it (result.ok === false
      // or a rejected next()).
      const recordFailure = (error: unknown, durationMs: number): void => {
        emitObservabilityEvent({
          path,
          type,
          userId,
          requestId,
          startMs,
          durationMs,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => {});

        // B8 + B9: real request metric + grouped error event from the actual
        // thrown error. Both are fire-and-forget with honest-drop semantics.
        try {
          recordRequestMetric({
            path,
            procedureType: type,
            durationMs,
            success: false,
            errorCode: error instanceof TRPCError ? error.code : "INTERNAL_SERVER_ERROR",
            userId,
          });
          void recordErrorEvent({
            path,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          }).catch(() => {});
        } catch { /* telemetry must never break the request path */ }
      };

      try {
        const result = await next({ ctx });
        const durationMs = Date.now() - startMs;

        // tRPC surfaces resolver errors as { ok: false, error } — next() does
        // NOT reject for downstream procedure failures. Inspect the marker so
        // failures are never recorded as successes.
        const outcome = result as { ok?: boolean; error?: unknown };
        if (outcome && outcome.ok === false) {
          recordFailure(outcome.error, durationMs);
          return result; // tRPC propagates the error to the caller itself
        }

        // Fire-and-forget: don't await, don't block the response
        emitObservabilityEvent({
          path,
          type,
          userId,
          requestId,
          startMs,
          durationMs,
          success: true,
        }).catch(() => {}); // swallow any unhandled rejection

        // B8: in-repo APM — buffered, batched, best-effort (never blocks,
        // never pretends to have written; see server/lib/telemetryStore.ts).
        try {
          recordRequestMetric({
            path,
            procedureType: type,
            durationMs,
            success: true,
            userId,
          });
        } catch { /* telemetry must never break the request path */ }

        return result;
      } catch (error) {
        const durationMs = Date.now() - startMs;
        recordFailure(error, durationMs);
        throw error; // re-throw to preserve tRPC error handling
      }
    }
  );
}
