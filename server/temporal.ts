// TypeScript enabled — Sprint 96 security audit
/**
 * InsurePortal Temporal Client
 * Provides a Temporal client for scheduling and triggering workflows.
 *
 * Workflows:
 *   SettlementWorkflow — daily settlement at 17:00 WAT
 *     Activities: aggregateSettlement → notifyAgents → archiveSettlement
 *
 * Usage:
 *   import { triggerSettlement, getTemporalClient } from "./temporal";
 *   await triggerSettlement({ date: "2025-01-15" });
 */
import {
  Connection,
  Client,
  WorkflowExecutionAlreadyStartedError,
} from "@temporalio/client";
import logger from "./_core/logger";

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "default";
const SETTLEMENT_TASK_QUEUE = "settlement-queue";

let _client: Client | null = null;

/**
 * Get (or create) the shared Temporal client.
 * Returns null if Temporal is unavailable — callers must handle gracefully.
 */
export async function getTemporalClient(): Promise<Client | null> {
  if (_client) return _client;

  try {
    const connection = await Connection.connect({
      address: TEMPORAL_ADDRESS,
    });
    _client = new Client({
      connection,
      namespace: TEMPORAL_NAMESPACE,
    });
    logger.info(
      `[Temporal] Connected to ${TEMPORAL_ADDRESS} (namespace: ${TEMPORAL_NAMESPACE})`
    );
    return _client;
  } catch (err) {
    logger.warn(
      { err },
      "[Temporal] Connection failed — workflow scheduling unavailable"
    );
    return null;
  }
}

export interface SettlementInput {
  date: string; // ISO date string e.g. "2025-01-15"
  triggeredBy?: string; // "cron" | "manual" | agentCode
}

export interface SettlementResult {
  agentsProcessed: number;
  totalVolume: number;
  totalCommission: number;
  smsCount: number;
  errors: string[];
  completedAt: string;
}

/**
 * Trigger the SettlementWorkflow for a given date.
 * Uses workflowId = `settlement-{date}` to prevent duplicate runs.
 */
export async function triggerSettlement(
  input: SettlementInput
): Promise<string | null> {
  const client = await getTemporalClient();
  if (!client) {
    logger.warn("[Temporal] Cannot trigger settlement — Temporal unavailable");
    return null;
  }

  const workflowId = `settlement-${input.date}`;

  try {
    const handle = await client.workflow.start("SettlementWorkflow", {
      taskQueue: SETTLEMENT_TASK_QUEUE,
      workflowId,
      args: [input],
    });
    logger.info(
      `[Temporal] Settlement workflow started: ${workflowId} (runId: ${handle.firstExecutionRunId})`
    );
    return handle.firstExecutionRunId;
  } catch (err) {
    if (err instanceof WorkflowExecutionAlreadyStartedError) {
      logger.warn(`[Temporal] Settlement for ${input.date} already running`);
      return null;
    }
    logger.error({ err }, "[Temporal] Failed to start settlement workflow");
    return null;
  }
}

/**
 * Schedule a daily settlement cron via Temporal.
 * This replaces the node-cron schedule when Temporal is available.
 * Cron: "0 17 * * *" = 17:00 UTC daily (adjust for WAT = UTC+1)
 */
export async function scheduleSettlementCron(): Promise<void> {
  const client = await getTemporalClient();
  if (!client) {
    logger.info(
      "[Temporal] Skipping cron schedule — Temporal unavailable (node-cron will be used)"
    );
    return;
  }

  const scheduleId = "daily-settlement-cron";

  try {
    await client.schedule.create({
      scheduleId,
      spec: {
        cronExpressions: ["0 16 * * *"], // 16:00 UTC = 17:00 WAT
      },
      action: {
        type: "startWorkflow",
        workflowType: "SettlementWorkflow",
        taskQueue: SETTLEMENT_TASK_QUEUE,
        args: [{ triggeredBy: "cron" }],
      },
    });
    logger.info(
      `[Temporal] Daily settlement cron scheduled (scheduleId: ${scheduleId})`
    );
  } catch (err: unknown) {
    // Schedule already exists — that's fine
    if (err instanceof Error && err.message?.includes("already exists")) {
      logger.debug("[Temporal] Settlement cron schedule already exists");
    } else {
      logger.warn(
        { err },
        "[Temporal] Failed to create settlement cron schedule"
      );
    }
  }
}

/**
 * Get the status of a settlement workflow by date.
 */
export async function getSettlementStatus(date: string): Promise<{
  status: string;
  result?: SettlementResult;
} | null> {
  const client = await getTemporalClient();
  if (!client) return null;

  const workflowId = `settlement-${date}`;
  try {
    const handle = client.workflow.getHandle(workflowId);
    const desc = await handle.describe();
    return { status: desc.status.name };
  } catch {
    return null;
  }
}

export default {
  getTemporalClient,
  triggerSettlement,
  scheduleSettlementCron,
  getSettlementStatus,
};
