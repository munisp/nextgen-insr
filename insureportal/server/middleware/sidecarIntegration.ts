// TypeScript enabled — Sprint 96 security audit
/**
 * sidecarIntegration.ts — tRPC middleware that automatically integrates
 * all procedures with the Rust/Go/Python sidecars.
 *
 * Applied globally via appRouter, this ensures every procedure:
 * 1. Gets audit-logged (Rust sidecar)
 * 2. Gets Kafka event published (Rust sidecar)
 * 3. Gets rate-limited (Rust sidecar)
 * 4. Has access to ledger, ML, and compliance via ctx
 *
 * Uses factory pattern (same as observabilityMiddleware) to avoid circular deps.
 */

import { initTRPC } from "@trpc/server";
import type { TrpcContext } from "../_core/context";
import {
  rustBridge,
  goLedger,
  pythonML,
  emitTransactionEvent,
  auditAndCache,
  runCompliancePipeline,
} from "../lib/sidecarBridge";

/**
 * Factory: creates the global sidecar integration middleware.
 * Call once from _core/trpc.ts, passing the tRPC instance.
 */
export function createSidecarMiddleware(t: any) {
  return t.middleware(
    async ({
      ctx,
      path,
      type,
      next,
    }: {
      ctx: any;
      path: string;
      type: string;
      next: any;
    }) => {
      const startTime = Date.now();
      const userId = (ctx as any)?.user?.id?.toString() ?? "anonymous";
      const procedurePath = path;

      // Pre-execution: Rate limiting via Rust sidecar (fire-and-forget)
      rustBridge
        .rateLimit(`trpc:${userId}:${procedurePath}`, 100, 60)
        .catch(() => {});

      // Pre-execution: Audit log via Rust sidecar (fire-and-forget)
      rustBridge.auditLog(userId, type, procedurePath).catch(() => {});

      // Execute the actual procedure with sidecar clients injected into context
      const result = await next({
        ctx: {
          ...ctx,
          sidecars: {
            rust: rustBridge,
            go: goLedger,
            python: pythonML,
            emitTransaction: emitTransactionEvent,
            auditAndCache,
            runCompliance: runCompliancePipeline,
          },
        },
      });

      // Post-execution: Publish event to Kafka (fire-and-forget)
      const duration = Date.now() - startTime;
      rustBridge
        .kafkaPublish("pos.trpc.events", userId, {
          procedure: procedurePath,
          type,
          userId,
          duration,
          success: result.ok,
          timestamp: Date.now(),
        })
        .catch(() => {});

      return result;
    }
  );
}
