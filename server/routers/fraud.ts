// @ts-check
import { TRPCError } from "@trpc/server";
import { sql, gte, eq } from "drizzle-orm";
import { z } from "zod";

import { fraudAlerts, fraudRules } from "../../drizzle/schema";
import { logger } from '../_core/logger';
import { protectedProcedure, router } from "../_core/trpc";
import {
  getFraudAlerts,
  createFraudAlert,
  updateFraudAlertStatus,
  writeAuditLog,
 getDb } from "../db";
import { getAgentFromCookie } from "../middleware/agentAuth";

export const fraudRouter = router({
  // ── List alerts (admin or agent-scoped) ───────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(50),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const alerts = await getFraudAlerts(input.status);
        const search = input.search?.toLowerCase();
        const filtered = search
          ? alerts.filter(
              (a: any) =>
                (a.agentId ?? "").toLowerCase().includes(search) ||
                (a.customerName ?? "").toLowerCase().includes(search) ||
                (a.reason ?? "").toLowerCase().includes(search)
            )
          : alerts;
        const total = filtered.length;
        const offset = (input.page - 1) * input.limit;
        const items = filtered
          .slice(offset, offset + input.limit)
          .map((a: any) => ({
            ...a,
            amount: a.amount ? Number(a.amount) : null,
            fraudScore: a.fraudScore ? Number(a.fraudScore) : null,
          }));
        return {
          items,
          total,
          page: input.page,
          limit: input.limit,
          pages: Math.ceil(total / input.limit),
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

  // ── Update alert status ───────────────────────────────────────────────────
  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum([
          "open",
          "investigating",
          "escalated",
          "dismissed",
          "resolved",
        ]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const agent = await getAgentFromCookie(ctx.req);
        await updateFraudAlertStatus(input.id, input.status);
        await writeAuditLog({
          agentId: agent?.id,
          metadata: { agentCode: agent?.agentId },
          action: `FRAUD_ALERT_${input.status.toUpperCase()}`,
          resource: "fraud_alert",
          resourceId: String(input.id),
          status: "success",
        });
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

  // ── Create alert (called by fraud engine or manually) ────────────────────
  create: protectedProcedure
    .input(
      z.object({
        severity: z.enum(["critical", "high", "medium", "low"]),
        type: z.string(),
        customerName: z.string().optional(),
        amount: z.number().optional(),
        reason: z.string(),
        agentId: z.number().optional(),
        transactionId: z.number().optional(),
        fraudScore: z.number().optional(),
        aiExplanation: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const alert = await createFraudAlert({
          severity: input.severity,
          type: input.type,
          customerName: input.customerName ?? null,
          amount: input.amount ? String(input.amount) : null,
          reason: input.reason,
          agentId: input.agentId ?? null,
          transactionId: input.transactionId ?? null,
          fraudScore: input.fraudScore ? String(input.fraudScore) : null,
          aiExplanation: input.aiExplanation ?? null,
          status: "open",
        });

        // ── Fluvio fraud alert stream event (fire-and-forget) ────────────────────
        import("../lib/fluvioClient.js")
          .then(({ publishFraudAlertEvent }) =>
            publishFraudAlertEvent({
              id: alert.id,
              type: input.type,
              severity: input.severity,
              agentId: input.agentId ?? 0,
              transactionRef: input.transactionId
                ? `TXN-${input.transactionId}`
                : undefined,
            })
          )
          .catch((e: unknown) =>
            logger.error("[Fluvio] Fraud alert event failed:: " + e)
          );

        return { success: true, alertId: alert.id };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Fraud Rule Management ─────────────────────────────────────────────────
  listRules: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    if (!db) throw new Error("Database connection unavailable");
    try {
      const rows = await db
        .select()
        .from(fraudRules)
        .orderBy(fraudRules.createdAt)
        .limit(100);
      return rows.map(r => ({ ...r, threshold: Number(r.threshold) }));
    } catch (e: any) {
      // Table may not exist yet — return empty list gracefully
      if (
        e?.message?.includes("does not exist") ||
        e?.message?.includes("relation")
      )
        return [];
      throw e;
    }
  }),

  createRule: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(128),
        category: z.enum([
          "velocity",
          "geofence",
          "device_fingerprint",
          "amount_anomaly",
          "time_of_day",
          "blacklist",
          "custom",
        ]),
        description: z.string().optional(),
        threshold: z.number().min(0).max(1).default(0.7),
        windowSeconds: z.number().int().positive().optional(),
        maxCount: z.number().int().positive().optional(),
        enabled: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        const [rule] = await db
          .insert(fraudRules)
          .values({
            name: input.name,
            category: input.category,
            description: input.description ?? null,
            threshold: String(input.threshold),
            windowSeconds: input.windowSeconds ?? 3600,
            maxCount: input.maxCount ?? 5,
            enabled: input.enabled,
            hitCount: 0,
          })
          .returning();
        return { ...rule, threshold: Number(rule.threshold) };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  updateRule: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(1).max(128).optional(),
        category: z
          .enum([
            "velocity",
            "geofence",
            "device_fingerprint",
            "amount_anomaly",
            "time_of_day",
            "blacklist",
            "custom",
          ])
          .optional(),
        description: z.string().optional(),
        threshold: z.number().min(0).max(1).optional(),
        windowSeconds: z.number().int().positive().optional(),
        maxCount: z.number().int().positive().optional(),
        enabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        const { id, threshold, ...rest } = input;
        const updates: Record<string, unknown> = {
          ...rest,
          updatedAt: new Date(),
        };
        if (threshold !== undefined) updates.threshold = String(threshold);
        const [rule] = await db
          .update(fraudRules)
          .set(updates)
          .where(eq(fraudRules.id, id))
          .returning();
        if (!rule)
          throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });
        return { ...rule, threshold: Number(rule.threshold) };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  deleteRule: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        await db.delete(fraudRules).where(eq(fraudRules.id, input.id));
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

  toggleRule: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        const [rule] = await db
          .update(fraudRules)
          .set({ enabled: input.enabled, updatedAt: new Date() })
          .where(eq(fraudRules.id, input.id))
          .returning();
        return { ...rule, threshold: Number(rule.threshold) };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Seed default fraud rules (admin-only, idempotent) ────────────────────
  seedDefaultRules: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      const agent = await getAgentFromCookie(ctx.req);
      if (!agent || agent.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required",
        });
      }
      const db = (await getDb())!;
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "DB unavailable",
        });
      // Idempotent: only seed if table is empty
      const existing = await db
        .select({ id: fraudRules.id })
        .from(fraudRules)
        .limit(1);
      if (existing.length > 0)
        return { seeded: 0, message: "Rules already exist — no changes made" };
      const DEFAULT_RULES = [
        {
          name: "Velocity: Max 5 Transactions per 10 Minutes",
          category: "velocity" as const,
          description:
            "Flags agents who process more than 5 transactions within any 10-minute window. Prevents rapid-fire fraud.",
          threshold: "0.8000",
          windowSeconds: 600,
          maxCount: 5,
          enabled: true,
          createdBy: "system",
        },
        {
          name: "Velocity: Max 20 Transactions per Hour",
          category: "velocity" as const,
          description:
            "Flags agents exceeding 20 transactions in a rolling 60-minute window.",
          threshold: "0.7500",
          windowSeconds: 3600,
          maxCount: 20,
          enabled: true,
          createdBy: "system",
        },
        {
          name: "Amount Anomaly: 3× Agent Daily Average",
          category: "amount_anomaly" as const,
          description:
            "Flags transactions where the amount exceeds 3× the agent's 30-day daily average. Catches unusual large-value fraud.",
          threshold: "0.7000",
          windowSeconds: 86400,
          maxCount: 1,
          enabled: true,
          createdBy: "system",
        },
        {
          name: "Amount Anomaly: Single Transaction > ₦500,000",
          category: "amount_anomaly" as const,
          description:
            "Flags any single transaction exceeding ₦500,000 for mandatory manual review.",
          threshold: "0.9000",
          windowSeconds: null,
          maxCount: null,
          enabled: true,
          createdBy: "system",
        },
        {
          name: "Geofence: Transaction Outside Registered Zone",
          category: "geofence" as const,
          description:
            "Flags transactions processed outside the agent's registered geofence zone. Detects terminal relocation fraud.",
          threshold: "0.8500",
          windowSeconds: null,
          maxCount: null,
          enabled: true,
          createdBy: "system",
        },
        {
          name: "Device Fingerprint: Unknown Device ID",
          category: "device_fingerprint" as const,
          description:
            "Flags transactions from a device ID not registered to the agent. Detects SIM-swap and device cloning.",
          threshold: "0.9000",
          windowSeconds: null,
          maxCount: null,
          enabled: true,
          createdBy: "system",
        },
        {
          name: "Device Fingerprint: 3+ Devices in 24 Hours",
          category: "device_fingerprint" as const,
          description:
            "Flags agents who transact from 3 or more distinct device IDs within 24 hours.",
          threshold: "0.8000",
          windowSeconds: 86400,
          maxCount: 3,
          enabled: true,
          createdBy: "system",
        },
        {
          name: "Time of Day: Transactions 11 PM – 5 AM",
          category: "time_of_day" as const,
          description:
            "Flags transactions processed between 23:00 and 05:00 WAT. Agency banking fraud peaks in late-night hours.",
          threshold: "0.6500",
          windowSeconds: null,
          maxCount: null,
          enabled: true,
          createdBy: "system",
        },
        {
          name: "Blacklist: Known Fraudulent Phone Numbers",
          category: "blacklist" as const,
          description:
            "Blocks transactions where the customer phone number appears on the CBN/NFIU fraud blacklist.",
          threshold: "1.0000",
          windowSeconds: null,
          maxCount: null,
          enabled: true,
          createdBy: "system",
        },
        {
          name: "Custom: Repeated Same-Amount Transactions",
          category: "custom" as const,
          description:
            "Flags 3 or more transactions of the exact same amount within 30 minutes. Detects structured/smurfing fraud.",
          threshold: "0.7500",
          windowSeconds: 1800,
          maxCount: 3,
          enabled: true,
          createdBy: "system",
        },
      ];
      const inserted = await db
        .insert(fraudRules)
        .values(DEFAULT_RULES as any)
        .returning({ id: fraudRules.id });
      await writeAuditLog({
        agentId: agent.id,
        metadata: { agentCode: agent.agentId },
        action: "FRAUD_RULES_SEEDED",
        resource: "fraud_rules",
        resourceId: "default",
        status: "success",
      });
      return {
        seeded: inserted.length,
        message: `${inserted.length} default fraud rules created successfully`,
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

  // ── Hourly fraud stats for dashboard chart (last 24 hours) ───────────────
  hourlyStats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    if (!db) throw new Error("Database connection unavailable");
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const hourExpr = sql<string>`TO_CHAR(DATE_TRUNC('hour', ${fraudAlerts.createdAt}), 'HH24:00')`;
    const rows = await db
      .select({
        hour: hourExpr,
        alerts: sql<number>`COUNT(*)::int`,
        blocked: sql<number>`COUNT(*) FILTER (WHERE ${fraudAlerts.status} IN ('escalated','resolved'))::int`,
      })
      .from(fraudAlerts)
      .where(gte(fraudAlerts.createdAt, since))
      .groupBy(hourExpr)
      .orderBy(hourExpr);
    return rows.map((r: any) => ({
      h: r.hour,
      alerts: r.alerts,
      blocked: r.blocked,
      volume: r.alerts,
    }));
  }),
});
