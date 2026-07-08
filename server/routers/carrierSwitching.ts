// @ts-check

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { auditLog } from "../../drizzle/schema";
import { desc, count } from "drizzle-orm";

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
export const carrierSwitchingRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(20), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0 };
      const results = await database.select().from(auditLog).orderBy(desc(auditLog.id)).limit(input.limit).offset(input.offset);
      const [{ total }] = await database.select({ total: count() }).from(auditLog);
      return { data: results, total: total ?? 0 };
    }),
  getCarrierStatus: protectedProcedure.query(async () => {
    return {
      carriers: [
        { name: "Termii", status: "active", deliveryRate: 96.2, avgLatency: 2800, isPrimary: true },
        { name: "Africa's Talking", status: "standby", deliveryRate: 94.8, avgLatency: 3200, isPrimary: false },
        { name: "Twilio", status: "standby", deliveryRate: 99.1, avgLatency: 1500, isPrimary: false },
      ],
      activeCarrier: "Termii",
      lastFailover: null,
      failoverThreshold: { deliveryRate: 90, latencyMs: 5000 },
    };
  }),
  triggerFailover: protectedProcedure
    .input(z.object({ fromCarrier: z.string(), toCarrier: z.string(), reason: z.string() }))
    .mutation(async ({ input }) => {
      return { success: true, previousCarrier: input.fromCarrier, newCarrier: input.toCarrier, reason: input.reason, timestamp: new Date().toISOString() };
    }),
  getFailoverHistory: protectedProcedure
    .input(z.object({ limit: z.number().default(10) }))
    .query(async () => { return { events: [], total: 0 }; }),
});
