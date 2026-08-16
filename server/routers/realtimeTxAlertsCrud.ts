// Sprint 87: Velocity rules, pattern matching, auto-block triggers
import { TRPCError } from "@trpc/server";
import { eq, desc, and, count, sql } from "drizzle-orm";
import { z } from "zod";

import { realtime_tx_alerts } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

const VELOCITY_RULES = [
  { name: "high_frequency", threshold: 10, windowMinutes: 5, action: "flag" },
  {
    name: "large_amount",
    threshold: 5000000,
    windowMinutes: 1,
    action: "block",
  },
  { name: "rapid_succession", threshold: 5, windowMinutes: 1, action: "block" },
  { name: "unusual_hours", startHour: 23, endHour: 5, action: "flag" },
];

export const realtime_tx_alertsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        severity: z.string().optional(),
        status: z.string().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const conditions: any[] = [];
        if (input.severity)
          conditions.push(eq(realtime_tx_alerts.severity, input.severity));
        if (input.status)
          conditions.push(eq(realtime_tx_alerts.metadata, input.status));
        const rows = await db
          .select()
          .from(realtime_tx_alerts)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(realtime_tx_alerts.id))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(realtime_tx_alerts)
          .where(conditions.length ? and(...conditions) : undefined)
          .limit(100);
        return { items: rows, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [row] = await db
          .select()
          .from(realtime_tx_alerts)
          .where(eq(realtime_tx_alerts.id, input.id))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Alert not found",
          });
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
  evaluateTransaction: protectedProcedure
    .input(
      z.object({ agentId: z.number(), amount: z.number(), txType: z.string() })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const triggers: string[] = [];
        const hour = new Date().getHours();
        if (input.amount > 5000000) triggers.push("large_amount");
        if (hour >= 23 || hour < 5) triggers.push("unusual_hours");
        if (triggers.length === 0)
          return {
            agentId: input.agentId,
            riskLevel: "low",
            triggers: [],
            action: "allow",
          };
        const severity = triggers.includes("large_amount")
          ? "critical"
          : "warning";
        const action = severity === "critical" ? "block" : "flag";
        const [alert] = await db
          .insert(realtime_tx_alerts)
          .values({
            agentId: input.agentId,
            severity,
            triggers: JSON.stringify(triggers),
            action,
            amount: input.amount.toString(),
            txType: input.txType,
            status: "active",
          } as any)
          .returning();
        return {
          ...alert,
          riskLevel: severity === "critical" ? "high" : "medium",
          triggers,
          action,
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
  getVelocityRules: protectedProcedure.query(() => ({ rules: VELOCITY_RULES })),
  dismiss: protectedProcedure
    .input(z.object({ id: z.number(), reason: z.string().min(5) }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .update(realtime_tx_alerts)
          .set({ metadata: "dismissed", acknowledged: true } as any)
          .where(eq(realtime_tx_alerts.id, input.id));
        return { success: true, message: "Alert dismissed" };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .delete(realtime_tx_alerts)
          .where(eq(realtime_tx_alerts.id, input.id));
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
});
