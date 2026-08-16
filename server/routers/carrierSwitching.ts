import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../_core/trpc";

/**
 * Carrier Switching Router
 *
 * Manages automatic failover between SMS/USSD carriers.
 * Switches to backup carrier when primary delivery rate drops below threshold.
 *
 * Failover Rules:
 * - Delivery rate < 90%: Switch to backup carrier
 * - Response time > 5s: Route to alternative
 * - Provider outage: Immediate failover (health check every 30s)
 */

const notImplemented = () =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: "Carrier switching is not implemented yet",
  });

export const carrierSwitchingRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(20), offset: z.number().default(0) }))
    .query(async () => {
      throw notImplemented();
    }),
  getCarrierStatus: protectedProcedure.query(async () => {
    throw notImplemented();
  }),
  triggerFailover: protectedProcedure
    .input(z.object({ fromCarrier: z.string(), toCarrier: z.string(), reason: z.string() }))
    .mutation(async () => {
      throw notImplemented();
    }),
  getFailoverHistory: protectedProcedure
    .input(z.object({ limit: z.number().default(10) }))
    .query(async () => {
      throw notImplemented();
    }),
});
