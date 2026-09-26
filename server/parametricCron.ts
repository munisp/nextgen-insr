/**
 * parametricCron.ts — Q-wave Q2 (2026-09-25)
 *
 * Scheduler-invoked evaluation of active parametric triggers. Follows the
 * repo's existing cron pattern (server/settlementCron.ts,
 * server/lakehouseCron.ts: node-cron registered from server/_core/index.ts
 * after startup). Temporal journeys remain untouched; this is the same
 * lightweight node-cron discipline the settlement/lakehouse jobs use.
 *
 * Each tick evaluates every active trigger ONCE per evaluation window
 * (parametric_events.event_key makes ticks idempotent), so overlapping or
 * repeated ticks never double-pay.
 */
import cron from "node-cron";

import { logger } from "./_core/logger";
import { evaluateAllActiveTriggers } from "./lib/parametricEngine";

export function registerParametricCron(): void {
  // Default: every 5 minutes. Disable with PARAMETRIC_CRON_ENABLED=false.
  if ((process.env.PARAMETRIC_CRON_ENABLED ?? "true") === "false") {
    logger.info("[parametric-cron] disabled via PARAMETRIC_CRON_ENABLED=false");
    return;
  }
  const expression = process.env.PARAMETRIC_EVAL_CRON ?? "*/5 * * * *";
  cron.schedule(expression, async () => {
    try {
      const result = await evaluateAllActiveTriggers();
      if (result.errors.length > 0) {
        logger.warn(
          { evaluated: result.evaluated, errors: result.errors },
          "[parametric-cron] tick completed with per-trigger errors",
        );
      } else {
        logger.info({ evaluated: result.evaluated }, "[parametric-cron] tick completed");
      }
    } catch (err) {
      logger.error({ err }, "[parametric-cron] tick failed");
    }
  });
  logger.info({ expression }, "[parametric-cron] registered");
}
