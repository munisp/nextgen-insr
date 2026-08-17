/**
 * networkTelemetry.ts — Network Telemetry Router
 * F-12 (verifier round 5): the header claimed "real DB-backed telemetry,
 * zero mock data" while serving transactions rows as telemetry and
 * fabricated per-source rtt/jitter/bandwidth metrics — no network
 * telemetry store exists on this platform. Every proc fails loud.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../_core/trpc";

function loud(name: string): never {
  throw new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: `${name}: no network-telemetry store is delivered`,
  });
}

export const networkTelemetryRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20), offset: z.number().min(0).default(0) }))
    .query(async () => loud("list")),

  getLiveMetrics: protectedProcedure.query(async () => loud("getLiveMetrics")),

  getSummary: protectedProcedure.query(async () => loud("getSummary")),
});
