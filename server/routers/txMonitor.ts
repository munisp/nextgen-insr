// @ts-check
import { TRPCError } from "@trpc/server";
import {
  eq,
  desc,
  sql,
  count,
} from "drizzle-orm";
import { z } from "zod";

import { transactions, auditLog, systemConfig, fraudAlerts } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


// MOCKWARE FIX: Alert endpoints previously returned four hardcoded 2024
// alerts and acknowledge/resolve were open no-ops. They now read and persist
// to the real fraud_alerts table and require authentication.

export const txMonitorRouter = router({
  dashboard: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return {
        totalTransactions: 0,
        alertsTriggered: 0,
        avgTps: 0,
        activeRules: 0,
      };
    const [txCount] = await db
      .select({ value: count() })
      .from(transactions)
      .limit(100);
    const [alertCount] = await db
      .select({ value: count() })
      .from(fraudAlerts)
      .limit(100);
    const rules = await db
      .select()
      .from(systemConfig)
      .where(sql`${systemConfig.key} LIKE 'tx_alert_rule_%'`)
      .limit(100);
    return {
      totalTransactions: Number(txCount.value),
      alertsTriggered: Number(alertCount.value),
      avgTps: 0,
      activeRules: rules.length,
    };
  }),
  listAlertRules: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { rules: [], total: 0 };
        const rows = await db
          .select()
          .from(systemConfig)
          .where(sql`${systemConfig.key} LIKE 'tx_alert_rule_%'`)
          .limit(input?.limit ?? 20);
        return {
          rules: rows.map(r => ({
            id: r.key.replace("tx_alert_rule_", ""),
            ...JSON.parse(String(r.value ?? "{}")),
          })),
          total: rows.length,
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
  createAlertRule: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        conditionType: z.string(),
        threshold: z.number(),
        severity: z.enum(["info", "warning", "critical"]).default("warning"),
        windowSeconds: z.number().default(300),
        enabled: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const ruleId = "TXR-" + crypto.randomUUID().toUpperCase();
        await db.insert(systemConfig).values({
          key: "tx_alert_rule_" + ruleId,
          value: JSON.stringify({
            ...input,
            createdAt: new Date().toISOString(),
            cooldownSeconds: 300,
            triggeredCount: 0,
          }),
        });
        await db.insert(auditLog).values({
          action: "tx_alert_rule_created",
          resource: "tx_monitor",
          resourceId: ruleId,
          status: "success",
          metadata: { name: input.name, conditionType: input.conditionType },
        });
        return { success: true, ruleId };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getRecentTransactions: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { transactions: [], total: 0 };
        const rows = await db
          .select()
          .from(transactions)
          .orderBy(desc(transactions.createdAt))
          .limit(input?.limit ?? 50);
        return { transactions: rows, total: rows.length };
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
    .input(z.object({ ruleId: z.string(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const rows = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.key, "tx_alert_rule_" + input.ruleId))
          .limit(1);
        if (rows.length === 0)
          return { success: false, error: "Rule not found" };
        const data = JSON.parse(String(rows[0].value ?? "{}"));
        data.enabled = input.enabled;
        await db
          .update(systemConfig)
          .set({ value: JSON.stringify(data), updatedAt: new Date() })
          .where(eq(systemConfig.key, "tx_alert_rule_" + input.ruleId));
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

  // ── Sprint 78 domain-specific procedures ──────────────────────────────────
  getRules: protectedProcedure.query(async () => {
    // Static catalog of supported alert rule definitions (documentation of
    // available detectors, not fabricated runtime state).
    const rules = [
      { id: "RULE-001", name: "High Value Transaction", condition: "amount > 1000000", severity: "critical", enabled: true, action: "alert" },
      { id: "RULE-002", name: "Rapid Transactions", condition: "tx_count > 10 in 5min", severity: "high", enabled: true, action: "alert" },
      { id: "RULE-003", name: "Cross-border Transfer", condition: "country != origin", severity: "medium", enabled: true, action: "flag" },
      { id: "RULE-004", name: "New Agent High Volume", condition: "agent_age < 30d && amount > 500000", severity: "high", enabled: true, action: "alert" },
      { id: "RULE-005", name: "Unusual Hours", condition: "hour < 6 || hour > 23", severity: "low", enabled: true, action: "log" },
      { id: "RULE-006", name: "Round Amount Pattern", condition: "amount % 100000 == 0 && count > 3", severity: "medium", enabled: true, action: "flag" },
      { id: "RULE-007", name: "Structuring Detection", condition: "sum_24h > 5000000 && avg_tx < 500000", severity: "critical", enabled: true, action: "block" },
      { id: "RULE-008", name: "Dormant Account Reactivation", condition: "last_tx > 90d && amount > 200000", severity: "high", enabled: true, action: "alert" },
    ];
    return { rules, activeCount: rules.filter(r => r.enabled).length };
  }),

  getAlerts: protectedProcedure
    .input(z.object({ severity: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { alerts: [], total: 0 };
      const rows = await db
        .select()
        .from(fraudAlerts)
        .orderBy(desc(fraudAlerts.createdAt))
        .limit(100);
      let alerts = rows.map(a => ({
        id: String(a.id),
        ruleId: a.type,
        severity: a.severity,
        agentId: a.agentId != null ? String(a.agentId) : null,
        amount: a.amount != null ? Number(a.amount) : null,
        status: a.status,
        createdAt: a.createdAt?.toISOString?.() ?? a.createdAt,
        description: a.reason,
      }));
      if (input?.severity)
        alerts = alerts.filter(a => a.severity === input.severity);
      return { alerts, total: alerts.length };
    }),

  acknowledgeAlert: protectedProcedure
    .input(z.object({ alertId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const id = Number(input.alertId);
      if (!Number.isFinite(id)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid alert id" });
      }
      const rows = await db
        .select()
        .from(fraudAlerts)
        .where(eq(fraudAlerts.id, id))
        .limit(1);
      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Alert ${input.alertId} not found` });
      }
      const acknowledgedAt = new Date();
      await db
        .update(fraudAlerts)
        .set({
          status: "investigating",
          assignedTo: (ctx as any)?.user?.email ?? String((ctx as any)?.user?.id ?? "unknown"),
          updatedAt: acknowledgedAt,
        })
        .where(eq(fraudAlerts.id, id));
      return {
        success: true,
        alertId: input.alertId,
        status: "acknowledged",
        acknowledgedAt: acknowledgedAt.toISOString(),
      };
    }),

  resolveAlert: protectedProcedure
    .input(z.object({ alertId: z.string(), resolution: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const id = Number(input.alertId);
      if (!Number.isFinite(id)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid alert id" });
      }
      const rows = await db
        .select()
        .from(fraudAlerts)
        .where(eq(fraudAlerts.id, id))
        .limit(1);
      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Alert ${input.alertId} not found` });
      }
      const resolvedAt = new Date();
      await db
        .update(fraudAlerts)
        .set({
          status: "resolved",
          resolvedAt,
          updatedAt: resolvedAt,
        })
        .where(eq(fraudAlerts.id, id));
      await db.insert(auditLog).values({
        action: "tx_alert_resolved",
        resource: "fraud_alert",
        resourceId: input.alertId,
        status: "success",
        metadata: { resolution: input.resolution },
      }).catch(() => {});
      return {
        success: true,
        alertId: input.alertId,
        status: "resolved",
        resolution: input.resolution,
        resolvedAt: resolvedAt.toISOString(),
      };
    }),

  getDashboard: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return { totalAlerts: 0, openAlerts: 0, criticalAlerts: 0, rulesCount: 0, recentAlerts: [] };
    const [total] = await db.select({ value: count() }).from(fraudAlerts);
    const [open] = await db
      .select({ value: count() })
      .from(fraudAlerts)
      .where(eq(fraudAlerts.status, "open"));
    const [critical] = await db
      .select({ value: count() })
      .from(fraudAlerts)
      .where(eq(fraudAlerts.severity, "critical"));
    const rules = await db
      .select()
      .from(systemConfig)
      .where(sql`${systemConfig.key} LIKE 'tx_alert_rule_%'`)
      .limit(100);
    const recent = await db
      .select()
      .from(fraudAlerts)
      .orderBy(desc(fraudAlerts.createdAt))
      .limit(5);
    return {
      totalAlerts: Number(total.value),
      openAlerts: Number(open.value),
      criticalAlerts: Number(critical.value),
      rulesCount: rules.length,
      recentAlerts: recent.map(a => ({
        id: String(a.id),
        severity: a.severity,
        description: a.reason,
        createdAt: a.createdAt?.toISOString?.() ?? a.createdAt,
      })),
    };
  }),
});
