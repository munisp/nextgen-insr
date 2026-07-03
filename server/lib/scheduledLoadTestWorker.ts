// TypeScript enabled — Sprint 96 security audit
/**
 * Scheduled Load Test Worker — 54Link Agency Banking Platform
 *
 * Runs recurring load tests (nightly regression) based on cron schedule.
 * Integrates with:
 * - runtimeConfig for schedule and test parameters
 * - loadTestMetrics router for test execution
 * - notifyOwner for results delivery
 */
import { getConfig, setConfig } from "./runtimeConfig";
import { notifyOwner } from "../_core/notification";
import { notifyOwner } from "../_core/notification";
import { logger } from './_core/logger';

export interface ScheduledTestConfig {
  enabled: boolean;
  cronExpression: string; // e.g., "0 2 * * *" (2 AM daily)
  targetRps: number;
  duration: number;
  concurrency: number;
  zipfExponent: number;
  merchantCount: number;
  notifyOnComplete: boolean;
  p99ThresholdMs: number;
}

const DEFAULT_SCHEDULE: ScheduledTestConfig = {
  enabled: false,
  cronExpression: "0 2 * * *",
  targetRps: 200,
  duration: 60,
  concurrency: 5,
  zipfExponent: 1.07,
  merchantCount: 500,
  notifyOnComplete: true,
  p99ThresholdMs: 500,
};

let workerInterval: ReturnType<typeof setInterval> | null = null;
let lastCheckTime = 0;

export async function getScheduledTestConfig(): Promise<ScheduledTestConfig> {
  const raw = await getConfig("scheduled_loadtest_config");
  if (!raw) return DEFAULT_SCHEDULE;
  try {
    return { ...DEFAULT_SCHEDULE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SCHEDULE;
  }
}

export async function setScheduledTestConfig(
  config: Partial<ScheduledTestConfig>
): Promise<void> {
  const current = await getScheduledTestConfig();
  const merged = { ...current, ...config };
  await setConfig("scheduled_loadtest_config", JSON.stringify(merged));
}

function shouldRunNow(cronExpr: string): boolean {
  const now = new Date();
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  function matches(field: string, value: number, max: number): boolean {
    if (field === "*") return true;
    if (field.includes("/")) {
      const [, step] = field.split("/");
      return value % parseInt(step) === 0;
    }
    if (field.includes(",")) {
      return field.split(",").map(Number).includes(value);
    }
    if (field.includes("-")) {
      const [start, end] = field.split("-").map(Number);
      return value >= start && value <= end;
    }
    return parseInt(field) === value;
  }

  return (
    matches(minute, now.getMinutes(), 59) &&
    matches(hour, now.getHours(), 23) &&
    matches(dayOfMonth, now.getDate(), 31) &&
    matches(month, now.getMonth() + 1, 12) &&
    matches(dayOfWeek, now.getDay(), 6)
  );
}

export async function checkAndRunScheduledTest(
  executeTestFn: (config: {
    targetRps: number;
    duration: number;
    concurrency: number;
    zipfExponent: number;
    merchantCount: number;
  }) => Promise<any>
): Promise<{ ran: boolean; result?: any }> {
  const config = await getScheduledTestConfig();
  if (!config.enabled) return { ran: false };

  const now = Date.now();
  // Only check once per minute
  if (now - lastCheckTime < 55_000) return { ran: false };
  lastCheckTime = now;

  if (!shouldRunNow(config.cronExpression)) return { ran: false };

  logger.info(
    `[ScheduledLoadTest] Triggering scheduled test: ${config.targetRps} RPS for ${config.duration}s`
  );

  try {
    const result = await executeTestFn({
      targetRps: config.targetRps,
      duration: config.duration,
      concurrency: config.concurrency,
      zipfExponent: config.zipfExponent,
      merchantCount: config.merchantCount,
    });

    if (config.notifyOnComplete) {
      const p99 = result?.latency?.p99 ?? 0;
      const breached = p99 > config.p99ThresholdMs;
      await notifyOwner({
        title: breached
          ? `⚠️ Scheduled Load Test: P99 BREACH (${p99}ms > ${config.p99ThresholdMs}ms)`
          : `✅ Scheduled Load Test Completed`,
        content: `RPS: ${result?.actualRps ?? "N/A"} | P99: ${p99}ms | Errors: ${result?.errorRate ?? "N/A"}% | Duration: ${config.duration}s`,
      });
    }

    return { ran: true, result };
  } catch (err: any) {
    logger.error(`[ScheduledLoadTest] Failed:`, err.message);
    await notifyOwner({
      title: "❌ Scheduled Load Test Failed",
      content: `Error: ${err.message}`,
    });
    return { ran: false };
  }
}

export function startScheduledLoadTestWorker(
  executeTestFn: (config: any) => Promise<any>
) {
  if (workerInterval) return;
  logger.info("[ScheduledLoadTest] Worker started (checking every 60s)");
  workerInterval = setInterval(() => {
    checkAndRunScheduledTest(executeTestFn).catch(console.error);
  }, 60_000);
}

export function stopScheduledLoadTestWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    logger.info("[ScheduledLoadTest] Worker stopped");
  }
}
