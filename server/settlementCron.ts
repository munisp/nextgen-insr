// @ts-check
// TypeScript enabled — Sprint 96 security audit
/**
 * Daily Settlement Cron Job
 *
 * Runs at 17:00 WAT (16:00 UTC) every weekday.
 * For each active agent:
 *   1. Sets floatLocked = true on all agents (Phase 47: float lock during settlement)
 *   2. Aggregates today's transaction volume and commission from PostgreSQL
 *   3. Sends a settlement summary SMS via Termii (reuses shared sendSms helper)
 *   4. Writes an audit log entry for the settlement run
 *   5. Sets floatLocked = false on all agents after settlement completes
 *
 * Registered in server/_core/index.ts after server startup.
 */
import cron from "node-cron";
import { eq, and, gte, lte } from "drizzle-orm";
import { getDb } from "./db";
import {
  agents,
  transactions,
  auditLog,
  erpSyncLog,
  systemConfig,
  connectivityLog,
} from "../drizzle/schema";
import { notifyOwner } from "./_core/notification";
import { sendSms } from "./termii";
import { settlementPlatform } from "./_core/platformClient.js";
import { ENV } from "./_core/env";
import { logger } from './_core/logger';

interface AgentSettlement {
  agentNumericId: number;
  agentId: string;
  name: string;
  phone: string;
  txCount: number;
  totalVolume: number;
  totalCommission: number;
  premiumReserve: number;
}

function buildSettlementSms(data: AgentSettlement): string {
  return (
    `InsurePortal Daily Settlement - ${new Date().toLocaleDateString("en-NG")}\n` +
    `Agent: ${data.agentId}\n` +
    `Transactions: ${data.txCount}\n` +
    `Volume: ₦${data.totalVolume.toLocaleString("en-NG", { minimumFractionDigits: 2 })}\n` +
    `Commission: ₦${data.totalCommission.toLocaleString("en-NG", { minimumFractionDigits: 2 })}\n` +
    `Float Balance: ₦${data.premiumReserve.toLocaleString("en-NG", { minimumFractionDigits: 2 })}\n` +
    `Thank you for using InsurePortal.`
  );
}

interface SettlementResult {
  agentCount: number;
  smsSent: number;
  errors: string[];
  runAt: Date;
}

async function runDailySettlement(): Promise<SettlementResult> {
  logger.info("[settlement] Starting daily settlement run...");
  const db = await getDb();
  if (!db) {
    logger.error("[settlement] DB unavailable — skipping settlement run");
    return {
      agentCount: 0,
      smsSent: 0,
      errors: ["DB unavailable"],
      runAt: new Date(),
    };
  }

  // ── Phase 47: Lock all agents at start of settlement ──────────────────────
  try {
    await db.update(agents).set({ floatLocked: true });
    logger.info("[settlement] Float locked for all agents");
  } catch (err) {
    logger.error("[settlement] Failed to lock floats — aborting settlement:: " + err);
    return {
      agentCount: 0,
      smsSent: 0,
      errors: [`Float lock failed: ${String(err)}`],
      runAt: new Date(),
    };
  }

  const today = new Date();
  const dayStart = new Date(today);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(today);
  dayEnd.setHours(23, 59, 59, 999);

  const activeAgents = await db
    .select({
      id: agents.id,
      agentId: agents.agentId,
      name: agents.name,
      phone: agents.phone,
      premiumReserve: agents.premiumReserve,
    })
    .from(agents)
    .where(eq(agents.isActive, true));

  let successCount = 0;
  let smsSent = 0;
  const errors: string[] = [];

  for (const agent of activeAgents) {
    try {
      const txRows = await db
        .select({
          amount: transactions.amount,
          commission: transactions.commission,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.agentId, agent.id),
            eq(transactions.status, "success"),
            gte(transactions.createdAt, dayStart),
            lte(transactions.createdAt, dayEnd)
          )
        );

      const txCount = txRows.length;
      const totalVolume = txRows.reduce((sum, r) => sum + Number(r.amount), 0);
      const totalCommission = txRows.reduce(
        (sum, r) => sum + Number(r.commission),
        0
      );

      const settlementData: AgentSettlement = {
        agentNumericId: agent.id,
        agentId: agent.agentId,
        name: agent.name,
        phone: agent.phone,
        txCount,
        totalVolume,
        totalCommission,
        premiumReserve: Number(agent.premiumReserve),
      };

      const message = buildSettlementSms(settlementData);
      const smsResult = await sendSms(agent.phone, message);
      if (smsResult.success) {
        smsSent++;
      } else {
        logger.error(
          `[settlement] SMS failed for agent ${agent.agentId}: ${smsResult.error}`
        );
      }

      await db.insert(auditLog).values({
        agentId: agent.id,
        action: "DAILY_SETTLEMENT_SENT",
        resource: "settlement",
        resourceId: today.toISOString().split("T")[0],
        status: "success",
        metadata: {
          txCount,
          totalVolume,
          totalCommission,
          premiumReserve: Number(agent.premiumReserve),
          date: today.toISOString().split("T")[0],
        },
      });

      successCount++;
    } catch (err) {
      logger.error(`[settlement] Error processing agent ${agent.agentId}:: ` + err);
      errors.push(`${agent.agentId}: ${String(err)}`);
    }
  }

  // ── Phase 47: Unlock all agents after settlement completes ────────────────
  try {
    await db.update(agents).set({ floatLocked: false });
    logger.info("[settlement] Float unlocked for all agents");
  } catch (err) {
    // Critical: if unlock fails, agents cannot transact. Log prominently.
    logger.error("[settlement] CRITICAL: Failed to unlock floats after settlement:: " + err);
    errors.push(`Float unlock failed: ${String(err)}`);
  }

  // ── Platform settlement trigger (fail-open: local settlement is authoritative) ──
  try {
    const systemToken = ENV.platformServiceToken;
    if (systemToken) {
      const settlementDate = new Date().toISOString().slice(0, 10);
      await settlementPlatform.processSettlement(
        { settlement_date: settlementDate },
        systemToken
      );
      console.info(
        `[settlement] Platform settlement trigger sent for ${settlementDate}`
      );
    } else {
      logger.warn(
        "[settlement] PLATFORM_SERVICE_TOKEN not set — skipping platform settlement trigger"
      );
    }
  } catch (platformErr) {
    // Non-fatal: local settlement already completed; platform sync is best-effort
    logger.warn("[settlement] Platform settlement trigger failed (fail-open):: " + (platformErr as Error).message
    );
    errors.push(`Platform trigger failed: ${(platformErr as Error).message}`);
  }

  logger.info(
    `[settlement] Daily settlement complete — ${successCount} agents processed, ${errors.length} errors`
  );
  return { agentCount: successCount, smsSent, errors, runAt: new Date() };
}

// ─── Auto-escalate snoozed fraud alerts whose snooze has expired ─────────────
async function runAutoEscalation(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const { fraudAlerts } = await import("../drizzle/schema");
    const { notifyOwner } = await import("./_core/notification");
    const now = new Date();
    const expired = await db
      .select()
      .from(fraudAlerts)
      .where(
        and(
          eq(fraudAlerts.status, "investigating"),
          lte(fraudAlerts.snoozedUntil, now)
        )
      );
    if (expired.length === 0) return;
    for (const alert of expired) {
      await db
        .update(fraudAlerts)
        .set({ status: "escalated", escalatedAt: now })
        .where(eq(fraudAlerts.id, alert.id));
      try {
        await notifyOwner({
          title: `Auto-Escalated: ${alert.type} (Snooze Expired)`,
          content: `Alert #${alert.id} (${alert.severity}) was snoozed but not resolved. Auto-escalated at ${now.toISOString()}.`,
        });
      } catch (e) {
        logger.error("[autoEscalation] notifyOwner failed:: " + e);
      }
    }
    logger.info(
      `[autoEscalation] Escalated ${expired.length} snoozed alert(s)`
    );
  } catch (err) {
    logger.error("[autoEscalation] Error:: " + String(err));
  }
}

// ─── Weekly compliance report (PDF + S3 + owner notification) ────────────────────────────
async function runWeeklyComplianceReport(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const { fraudAlerts, complianceReports } = await import(
      "../drizzle/schema"
    );
    const { notifyOwner } = await import("./_core/notification");
    const { storagePut } = await import("./storage");
    const { generateCompliancePdfBuffer } = await import("./compliancePdf");

    const periodEnd = new Date();
    const periodStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const allAlerts = await db
      .select()
      .from(fraudAlerts)
      .where(gte(fraudAlerts.createdAt, periodStart));

    const bySeverity: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byAgent: Record<string, number> = {};
    let escalated = 0;
    let resolved = 0;
    let high = 0;
    let medium = 0;
    let low = 0;
    let critical = 0;

    for (const a of allAlerts) {
      const sev = (a.severity ?? "unknown").toLowerCase();
      const typ = a.type ?? "UNKNOWN";
      const agentKey = a.agentId ? `Agent #${a.agentId}` : "Unknown";
      bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
      byType[typ] = (byType[typ] ?? 0) + 1;
      byAgent[agentKey] = (byAgent[agentKey] ?? 0) + 1;
      if (a.status === "escalated") escalated++;
      if (a.status === "resolved") resolved++;
      if (sev === "high") high++;
      if (sev === "medium") medium++;
      if (sev === "low") low++;
      if (sev === "critical") critical++;
    }

    const topOffenders = Object.entries(byAgent)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([agentKey, count]) => ({ agentKey, count }));

    // Generate PDF
    let pdfUrl: string | undefined;
    let pdfKey: string | undefined;
    try {
      const pdfBuffer = await generateCompliancePdfBuffer({
        periodStart,
        periodEnd,
        totalAlerts: allAlerts.length,
        highAlerts: high,
        mediumAlerts: medium,
        lowAlerts: low,
        criticalAlerts: critical,
        escalatedAlerts: escalated,
        resolvedAlerts: resolved,
        topOffenders,
        byType,
      });
      const suffix = periodEnd.toISOString().slice(0, 10);
      pdfKey = `compliance-reports/weekly-${suffix}-${Date.now()}.pdf`;
      const uploaded = await storagePut(pdfKey, pdfBuffer, "application/pdf");
      pdfUrl = uploaded.url;
      logger.info(`[complianceReport] PDF uploaded: ${pdfUrl}`);
    } catch (pdfErr) {
      logger.error("[complianceReport] PDF generation/upload failed:: " + pdfErr);
    }

    // Store in compliance_reports table
    await db.insert(complianceReports).values({
      periodStart,
      periodEnd,
      totalAlerts: allAlerts.length,
      highAlerts: high,
      mediumAlerts: medium,
      lowAlerts: low,
      escalatedAlerts: escalated,
      resolvedAlerts: resolved,
      topOffendersJson: topOffenders,
      pdfUrl: pdfUrl ?? null,
      pdfKey: pdfKey ?? null,
      generatedBy: "system",
    });

    const weekStart = periodStart.toLocaleDateString("en-NG", {
      dateStyle: "short",
    });
    const weekEnd = periodEnd.toLocaleDateString("en-NG", {
      dateStyle: "short",
    });
    const topAgentsStr = topOffenders
      .slice(0, 5)
      .map(o => `${o.agentKey}: ${o.count}`)
      .join(", ");

    const content = [
      `Weekly Security Compliance Report`,
      `Period: ${weekStart} to ${weekEnd}`,
      ``,
      `SUMMARY`,
      `Total Alerts: ${allAlerts.length}`,
      `Escalated: ${escalated}`,
      `Resolved: ${resolved}`,
      `Open/Investigating: ${allAlerts.length - escalated - resolved}`,
      ``,
      `BY SEVERITY`,
      ...Object.entries(bySeverity).map(
        ([s, c]) => `  ${s.toUpperCase()}: ${c}`
      ),
      ``,
      `BY TYPE`,
      ...Object.entries(byType).map(([t, c]) => `  ${t}: ${c}`),
      ``,
      `TOP OFFENDING AGENTS`,
      topAgentsStr || "  None",
      ``,
      pdfUrl ? `PDF Report: ${pdfUrl}` : "PDF generation failed — see logs",
    ].join("\n");

    await notifyOwner({
      title: `Weekly Security Report — ${allAlerts.length} alerts (${weekStart}–${weekEnd})`,
      content,
    });
    logger.info(
      `[complianceReport] Weekly report complete — ${allAlerts.length} alerts`
    );
  } catch (err) {
    logger.error("[complianceReport] Error:: " + String(err));
  }
}

/**
 * Register the daily settlement cron job.
 * Schedule: 17:00 WAT = 16:00 UTC (cron uses server local time; server is UTC)
 * Cron expression: "0 16 * * 1-5" = 16:00 UTC, Monday–Friday
 */
export function registerSettlementCron(): void {
  // Daily settlement — 17:00 WAT (16:00 UTC), Mon–Fri
  cron.schedule("0 16 * * 1-5", async () => {
    try {
      await runDailySettlement();
    } catch (err) {
      logger.error("[settlement] Unhandled error in settlement cron:: " + String(err));
    }
  });
  logger.info(
    "[settlement] Daily settlement cron registered (16:00 UTC / 17:00 WAT, Mon–Fri)"
  );

  // Auto-escalation — every 15 minutes
  cron.schedule("*/15 * * * *", async () => {
    await runAutoEscalation();
  });
  logger.info("[settlement] Auto-escalation cron registered (every 15 min)");

  // Weekly compliance report — Mondays at 08:00 UTC (09:00 WAT)
  cron.schedule("0 8 * * 1", async () => {
    await runWeeklyComplianceReport();
  });
  logger.info(
    "[settlement] Weekly compliance report cron registered (Mon 08:00 UTC)"
  );

  // Dead-letter digest — every day at 08:00 UTC (09:00 WAT)
  cron.schedule("0 8 * * *", async () => {
    await runDeadLetterDigest();
  });
  logger.info(
    "[settlement] Dead-letter digest cron registered (daily 08:00 UTC)"
  );
  // Weekly connectivity SLA report — Mondays at 08:30 UTC (09:30 WAT)
  cron.schedule("30 8 * * 1", async () => {
    await runWeeklyConnectivitySlaReport();
  });
  logger.info(
    "[settlement] Weekly connectivity SLA report cron registered (Mon 08:30 UTC)"
  );
}

/**
 * Daily dead-letter digest.
 * Queries ERP sync queue for items in 'failed' / 'dead_letter' status and
 * notifies the owner if any exist. Runs every day at 08:00 UTC.
 */
export async function runDeadLetterDigest(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) {
      logger.warn("[deadLetterDigest] DB unavailable — skipping");
      return;
    }

    const { desc } = await import("drizzle-orm");

    const failedItems = await db
      .select()
      .from(erpSyncLog)
      .where(eq(erpSyncLog.status, "failed" as any))
      .orderBy(desc(erpSyncLog.createdAt))
      .limit(100);

    if (failedItems.length === 0) {
      logger.info(
        "[deadLetterDigest] No dead-letter items — nothing to report"
      );
      return;
    }

    // ── Auto-retry: threshold read from system_config (key: dead_letter_auto_retry_threshold) ──
    let autoRetryThreshold = 5; // default
    try {
      const cfgRows = await db
        .select()
        .from(systemConfig)
        .where(eq(systemConfig.key, "dead_letter_auto_retry_threshold"))
        .limit(1);
      if (cfgRows.length > 0) {
        const parsed = parseInt(cfgRows[0].value, 10);
        if (!isNaN(parsed) && parsed >= 0) autoRetryThreshold = parsed;
      }
    } catch {
      // fall back to default of 5
    }
    if (failedItems.length <= autoRetryThreshold) {
      const now = new Date();
      const retryResult = await db
        .update(erpSyncLog)
        .set({
          status: "pending" as any,
          retryCount: 0,
          nextRetryAt: now,
          errorMessage: null,
        })
        .where(eq(erpSyncLog.status, "failed" as any));
      const requeued = (retryResult as any).rowCount ?? failedItems.length;
      logger.info(
        `[deadLetterDigest] Auto-retried ${requeued} dead-letter item(s) (queue ≤ ${autoRetryThreshold})`
      );
      const today = new Date().toLocaleDateString("en-NG", {
        dateStyle: "full",
      });
      await notifyOwner({
        title: `[InsurePortal POS] Auto-retried ${requeued} ERP dead-letter item(s)`,
        content: [
          `Dead-Letter Auto-Retry — ${today}`,
          ``,
          `${requeued} failed ERP sync item(s) were automatically re-queued for retry`,
          `because the queue size (≤ 5) qualifies for self-healing.`,
          ``,
          `Items re-queued:`,
          ...failedItems.map((item, i) => {
            const ts =
              item.createdAt?.toISOString().replace("T", " ").slice(0, 19) ??
              "unknown";
            return `  ${i + 1}. [${ts}] ${item.entityType ?? "unknown"} #${item.entityId ?? "?"} — ${item.errorMessage ?? "no error"}`;
          }),
          ``,
          `The ERP retry worker will process these items with exponential back-off.`,
          `No manual action is required unless items fail again.`,
        ].join("\n"),
      });
      return;
    }

    const today = new Date().toLocaleDateString("en-NG", { dateStyle: "full" });
    const itemLines = failedItems.slice(0, 20).map((item, i) => {
      const createdAt =
        item.createdAt?.toISOString().replace("T", " ").slice(0, 19) ??
        "unknown";
      return `  ${i + 1}. [${createdAt}] ${item.entityType ?? "unknown"} #${item.entityId ?? "?"} — ${item.errorMessage ?? "no error message"}`;
    });

    const moreCount = failedItems.length > 20 ? failedItems.length - 20 : 0;
    const moreNote =
      moreCount > 0 ? `\n  ... and ${moreCount} more items.` : "";

    const content = [
      `Dead-Letter ERP Sync Digest — ${today}`,
      ``,
      `Total failed items: ${failedItems.length}`,
      ``,
      `ITEMS (most recent first):`,
      ...itemLines,
      moreNote,
      ``,
      `Action required: Log in to the InsurePortal Platform → Offline Resilience → ERP Retry Worker`,
      `and click "Retry All Dead-Letter" to re-queue these items.`,
    ].join("\n");

    await notifyOwner({
      title: `[InsurePortal POS] ${failedItems.length} ERP dead-letter item(s) require attention`,
      content,
    });

    logger.info(
      `[deadLetterDigest] Notified owner of ${failedItems.length} dead-letter item(s)`
    );
  } catch (err) {
    logger.error("[deadLetterDigest] Error:: " + String(err));
  }
}

/**
 * Weekly Connectivity SLA Report.
 * Queries connectivity_log for the past 7 days, calculates per-agent uptime %
 * and average latency, then emails a ranked table to the owner.
 * Runs every Monday at 08:30 UTC.
 */
export async function runWeeklyConnectivitySlaReport(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) {
      logger.warn("[connectivitySla] DB unavailable — skipping");
      return;
    }
    const {
      gte: gteOp,
      sql: sqlExpr,
      count,
      avg,
    } = await import("drizzle-orm");
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Aggregate per agent: total pings and avg latency
    const rows = await db
      .select({
        agentId: connectivityLog.agentId,
        totalPings: count(connectivityLog.id),
        avgLatencyMs: avg(connectivityLog.latencyMs),
      })
      .from(connectivityLog)
      .where(gteOp(connectivityLog.recordedAt, sevenDaysAgo))
      .groupBy(connectivityLog.agentId);

    // For uptime: count pings where quality != 'offline'
    const onlineRows = await db
      .select({
        agentId: connectivityLog.agentId,
        onlinePings: count(connectivityLog.id),
      })
      .from(connectivityLog)
      .where(
        sqlExpr`${connectivityLog.recordedAt} >= ${sevenDaysAgo} AND ${connectivityLog.quality} != 'offline'`
      )
      .groupBy(connectivityLog.agentId);

    const onlineMap = new Map(
      onlineRows.map(r => [r.agentId, Number(r.onlinePings)])
    );

    if (rows.length === 0) {
      console.info(
        "[connectivitySla] No connectivity data in last 7 days — skipping report"
      );
      return;
    }

    // Build ranked table
    const ranked = rows
      .map(r => {
        const total = Number(r.totalPings);
        const online = onlineMap.get(r.agentId) ?? 0;
        const uptimePct = total > 0 ? (online / total) * 100 : 0;
        const avgLat =
          r.avgLatencyMs != null ? Math.round(Number(r.avgLatencyMs)) : null;
        return { agentId: r.agentId, uptimePct, avgLat, total, online };
      })
      .sort((a, b) => b.uptimePct - a.uptimePct); // best uptime first

    const weekStart = sevenDaysAgo.toLocaleDateString("en-NG", {
      dateStyle: "medium",
    });
    const weekEnd = new Date().toLocaleDateString("en-NG", {
      dateStyle: "medium",
    });

    const tableLines = ranked.map((r, i) => {
      const rank = String(i + 1).padStart(3);
      const code = r.agentId.padEnd(12);
      const uptime = `${r.uptimePct.toFixed(1)}%`.padStart(7);
      const lat = r.avgLat != null ? `${r.avgLat}ms`.padStart(7) : "   N/A";
      const pings = `${r.online}/${r.total}`.padStart(10);
      const flag =
        r.uptimePct < 80
          ? " ⚠ BELOW SLA"
          : r.uptimePct < 95
            ? " ⚡ MARGINAL"
            : "";
      return `${rank}. ${code} ${uptime}  ${lat}  ${pings}${flag}`;
    });

    const belowSla = ranked.filter(r => r.uptimePct < 80);
    const marginal = ranked.filter(r => r.uptimePct >= 80 && r.uptimePct < 95);

    const content = [
      `Weekly Connectivity SLA Report — ${weekStart} to ${weekEnd}`,
      ``,
      `Agents monitored: ${ranked.length}`,
      `Below SLA (<80%): ${belowSla.length}`,
      `Marginal (80–95%): ${marginal.length}`,
      ``,
      `RANKED BY UPTIME (best → worst):`,
      `  Rank  Agent        Uptime  Avg Lat    Pings`,
      `  ${"-".repeat(49)}`,
      ...tableLines,
      ``,
      belowSla.length > 0
        ? `ACTION REQUIRED: ${belowSla.map(r => r.agentId).join(", ")} are below the 80% SLA threshold. Consider replacing terminals.`
        : `All agents are meeting the 80% SLA threshold.`,
    ].join("\n");

    await notifyOwner({
      title: `[InsurePortal POS] Weekly Connectivity SLA — ${ranked.length} agents, ${belowSla.length} below SLA`,
      content,
    });
    logger.info(
      `[connectivitySla] SLA report sent: ${ranked.length} agents, ${belowSla.length} below SLA`
    );
  } catch (err) {
    logger.error("[connectivitySla] Error:: " + String(err));
  }
}

export { runDailySettlement };
