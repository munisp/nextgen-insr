// TypeScript enabled — Sprint 96 security audit
/**
 * archivalCronWorker.ts
 * S60-3: Background cron worker that checks the archival schedule config
 * and triggers archival jobs at the configured times.
 *
 * Pattern follows erpRetryWorker.ts: setInterval polling + immediate startup check.
 * Schedule: checks every 60 seconds if a scheduled archival is due.
 */
import { getConfig, getConfigNumber, setConfig } from "./runtimeConfig";
import { runArchivalJob } from "./parquetArchival";
import { notifyOwner } from "../_core/notification";
import logger from "../_core/logger";

// ── Cron Parsing ────────────────────────────────────────────────────────────

interface ParsedCron {
  minute: number | "*";
  hour: number | "*";
  dayOfMonth: number | "*";
  month: number | "*";
  dayOfWeek: number | "*";
}

function parseCron(expression: string): ParsedCron | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length < 5) return null;

  const parse = (s: string): number | "*" =>
    s === "*" ? "*" : parseInt(s, 10);

  return {
    minute: parse(parts[0]),
    hour: parse(parts[1]),
    dayOfMonth: parse(parts[2]),
    month: parse(parts[3]),
    dayOfWeek: parse(parts[4]),
  };
}

function matchesCron(cron: ParsedCron, date: Date): boolean {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1; // JS months are 0-indexed
  const dayOfWeek = date.getDay(); // 0 = Sunday

  if (cron.minute !== "*" && cron.minute !== minute) return false;
  if (cron.hour !== "*" && cron.hour !== hour) return false;
  if (cron.dayOfMonth !== "*" && cron.dayOfMonth !== dayOfMonth) return false;
  if (cron.month !== "*" && cron.month !== month) return false;
  if (cron.dayOfWeek !== "*" && cron.dayOfWeek !== dayOfWeek) return false;

  return true;
}

// ── Worker State ────────────────────────────────────────────────────────────

let workerInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let lastCheckMinute = -1; // Prevent double-triggers within the same minute

// ── Core Check Logic ────────────────────────────────────────────────────────

async function checkAndRunArchival(): Promise<void> {
  if (isRunning) {
    logger.debug("[Archival Cron] Skipping check — a job is already running");
    return;
  }

  try {
    // Check if schedule is enabled
    const enabled = (await getConfig("archival_schedule_enabled")) === "true";
    if (!enabled) return;

    // Parse cron expression
    const cronExpr = (await getConfig("archival_schedule_cron")) || "0 2 * * 0";
    const cron = parseCron(cronExpr);
    if (!cron) {
      logger.warn(`[Archival Cron] Invalid cron expression: ${cronExpr}`);
      return;
    }

    // Check if current time matches the cron schedule
    const now = new Date();
    const currentMinute = now.getHours() * 60 + now.getMinutes();

    // Prevent double-trigger in the same minute
    if (currentMinute === lastCheckMinute) return;

    if (!matchesCron(cron, now)) return;

    // Mark this minute as checked
    lastCheckMinute = currentMinute;

    // Time to run!
    const retentionDays =
      (await getConfigNumber("archival_retention_days")) || 90;
    const deleteAfterArchive =
      (await getConfig("archival_delete_after_archive")) === "true";

    logger.info(
      `[Archival Cron] Scheduled archival triggered (cron=${cronExpr}, retention=${retentionDays}d, delete=${deleteAfterArchive})`
    );

    isRunning = true;
    const startTime = performance.now();

    try {
      const result = await runArchivalJob({
        retentionDays,
        deleteAfterArchive,
      });

      const duration = Math.round(performance.now() - startTime);
      const totalArchived = result.totalArchived;

      // Update last run timestamp
      await setConfig("archival_last_run", new Date().toISOString());

      logger.info(
        `[Archival Cron] Scheduled job completed: ${totalArchived} rows archived in ${duration}ms`
      );

      // Notify owner of successful scheduled archival
      await notifyOwner({
        title: "Scheduled Archival Completed",
        content: [
          `Scheduled archival job completed successfully.`,
          ``,
          `Cron: ${cronExpr}`,
          `Retention: ${retentionDays} days`,
          `Delete after archive: ${deleteAfterArchive}`,
          ``,
          `Total archived: ${result.totalArchived}`,
          `Total deleted: ${result.totalDeleted}`,
          `Duration: ${duration}ms`,
        ].join("\n"),
      }).catch((e: unknown) =>
        logger.error(`[Archival Cron] Notification failed: ${e}`)
      );
    } catch (err: any) {
      const duration = Math.round(performance.now() - startTime);

      logger.error(
        `[Archival Cron] Scheduled job failed after ${duration}ms: ${err.message}`
      );

      // Notify owner of failure
      await notifyOwner({
        title: "Scheduled Archival FAILED",
        content: [
          `Scheduled archival job failed.`,
          ``,
          `Cron: ${cronExpr}`,
          `Retention: ${retentionDays} days`,
          `Error: ${err.message}`,
          `Duration: ${duration}ms`,
          ``,
          `Action required: Check archival configuration and database connectivity.`,
        ].join("\n"),
      }).catch((e: unknown) =>
        logger.error(`[Archival Cron] Failure notification failed: ${e}`)
      );
    } finally {
      isRunning = false;
    }
  } catch (err: any) {
    logger.error(`[Archival Cron] Check error: ${err.message}`);
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export function startArchivalCronWorker(): void {
  if (workerInterval) return;
  logger.info("[Archival Cron] Worker started — checking schedule every 60s");
  workerInterval = setInterval(() => {
    checkAndRunArchival().catch(err =>
      logger.error(`[Archival Cron] Worker error: ${err}`)
    );
  }, 60_000);
  // Run one check immediately on startup
  checkAndRunArchival().catch(err =>
    logger.error(`[Archival Cron] Startup check error: ${err}`)
  );
}

export function stopArchivalCronWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    logger.info("[Archival Cron] Worker stopped");
  }
}

export function isArchivalRunning(): boolean {
  return isRunning;
}

// Export for testing
export { parseCron, matchesCron, checkAndRunArchival };
