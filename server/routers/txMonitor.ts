// @ts-check
import { z } from "zod";
import {
  router,
  publicProcedure as openProcedure,
  protectedProcedure,
} from "../_core/trpc";
import { getDb } from "../db";
import {
  eq,
  desc,
  and,
  sql,
  count,
  sum,
  isNull,
  gte,
  lte,
  or,
  asc,
} from "drizzle-orm";
import { transactions, auditLog, systemConfig } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

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
    const rules = await db
      .select()
      .from(systemConfig)
      .where(sql`${systemConfig.key} LIKE 'tx_alert_rule_%'`)
      .limit(100);
    return {
      totalTransactions: Number(txCount.value),
      alertsTriggered: 0,
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
  getRules: openProcedure.query(async () => {
    const rules = [
      {
        id: "RULE-001",
        name: "High Value Transaction",
        condition: "amount > 1000000",
        severity: "critical",
        enabled: true,
        action: "alert",
      },
      {
        id: "RULE-002",
        name: "Rapid Transactions",
        condition: "tx_count > 10 in 5min",
        severity: "high",
        enabled: true,
        action: "alert",
      },
      {
        id: "RULE-003",
        name: "Cross-border Transfer",
        condition: "country != origin",
        severity: "medium",
        enabled: true,
        action: "flag",
      },
      {
        id: "RULE-004",
        name: "New Agent High Volume",
        condition: "agent_age < 30d && amount > 500000",
        severity: "high",
        enabled: true,
        action: "alert",
      },
      {
        id: "RULE-005",
        name: "Unusual Hours",
        condition: "hour < 6 || hour > 23",
        severity: "low",
        enabled: true,
        action: "log",
      },
      {
        id: "RULE-006",
        name: "Round Amount Pattern",
        condition: "amount % 100000 == 0 && count > 3",
        severity: "medium",
        enabled: true,
        action: "flag",
      },
      {
        id: "RULE-007",
        name: "Structuring Detection",
        condition: "sum_24h > 5000000 && avg_tx < 500000",
        severity: "critical",
        enabled: true,
        action: "block",
      },
      {
        id: "RULE-008",
        name: "Dormant Account Reactivation",
        condition: "last_tx > 90d && amount > 200000",
        severity: "high",
        enabled: true,
        action: "alert",
      },
    ];
    return { rules, activeCount: rules.filter(r => r.enabled).length };
  }),

  getAlerts: openProcedure
    .input(z.object({ severity: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const alerts = [
        {
          id: "ALT-001",
          ruleId: "RULE-001",
          severity: "critical",
          agentId: "AGT-010",
          amount: 2500000,
          status: "open",
          createdAt: "2024-06-01T14:30:00Z",
          description: "High value transaction detected",
        },
        {
          id: "ALT-002",
          ruleId: "RULE-002",
          severity: "high",
          agentId: "AGT-015",
          amount: 150000,
          status: "open",
          createdAt: "2024-06-01T15:00:00Z",
          description: "Rapid transactions detected",
        },
        {
          id: "ALT-003",
          ruleId: "RULE-007",
          severity: "critical",
          agentId: "AGT-020",
          amount: 4800000,
          status: "acknowledged",
          createdAt: "2024-06-01T16:00:00Z",
          description: "Structuring pattern detected",
        },
        {
          id: "ALT-004",
          ruleId: "RULE-005",
          severity: "low",
          agentId: "AGT-025",
          amount: 50000,
          status: "resolved",
          createdAt: "2024-06-02T02:00:00Z",
          description: "Transaction at unusual hours",
        },
      ];
      let filtered = alerts;
      if (input?.severity)
        filtered = filtered.filter(a => a.severity === input.severity);
      return { alerts: filtered, total: filtered.length };
    }),

  acknowledgeAlert: openProcedure
    .input(z.object({ alertId: z.string() }))
    .mutation(async ({ input }) => {
      return {
        success: true,
        alertId: input.alertId,
        status: "acknowledged",
        acknowledgedAt: new Date().toISOString(),
      };
    }),

  resolveAlert: openProcedure
    .input(z.object({ alertId: z.string(), resolution: z.string() }))
    .mutation(async ({ input }) => {
      return {
        success: true,
        alertId: input.alertId,
        status: "resolved",
        resolution: input.resolution,
        resolvedAt: new Date().toISOString(),
      };
    }),

  getDashboard: openProcedure.query(async () => {
    return {
      totalAlerts: 4,
      openAlerts: 2,
      criticalAlerts: 2,
      rulesCount: 8,
      recentAlerts: [
        {
          id: "ALT-001",
          severity: "critical",
          description: "High value transaction",
          createdAt: "2024-06-01T14:30:00Z",
        },
        {
          id: "ALT-002",
          severity: "high",
          description: "Rapid transactions",
          createdAt: "2024-06-01T15:00:00Z",
        },
      ],
    };
  }),
});
