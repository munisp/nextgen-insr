// TypeScript enabled — Sprint 96 security audit
/**
 * InsurePortal POS — Temporal Worker Process
 * Run: npx tsx server/temporal-worker.ts
 * Or via Docker: CMD ["node", "dist/temporal-worker.js"]
 *
 * Registers and runs the SettlementWorkflow with all its activities.
 * Connects to Temporal server at TEMPORAL_ADDRESS (default: localhost:7233).
 */
import path from "path";

import {
  NativeConnection,
  Worker,
  Runtime,
  DefaultLogger,
} from "@temporalio/worker";

import { logger } from './_core/logger';
import {
  J01_CustomerOnboardingWorkflow, J02_PolicyPurchaseWorkflow,
  J03_ClaimsSettlementWorkflow, J04_AgentOnboardingWorkflow,
  J05_AgentDailyOpsWorkflow, J06_PolicyRenewalWorkflow,
  J07_FraudResponseWorkflow, J08_CommissionPayoutWorkflow,
  J09_RemittanceWorkflow, J10_ClaimDisputeWorkflow,
  J11_BrokerPolicyManagementWorkflow, J12_ActuaryIfrs17Workflow,
  J13_ComplianceMonitoringWorkflow, J14_PosTerminalLifecycleWorkflow,
  J15_ReinsuranceCessionWorkflow, J16_CustomerSelfServiceWorkflow,
  J17_BulkPremiumPaymentWorkflow, J18_AgentFloatReconciliationWorkflow,
  J19_UnderwritingDecisionWorkflow, J20_PlatformHealthMonitoringWorkflow,
} from "./insurance-journeys-v2";
import * as journeyActivities from "./journey-activities";
import * as extendedActivities from "./journey-activities-extended";
import * as activities from "./temporal-activities";

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "insureportal";
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "insureportal-journeys";

// OPS-11: worker build ID for Temporal worker versioning. Every deploy that
// changes workflow code MUST bump TEMPORAL_WORKER_BUILD_ID (default: package
// version + git SHA when available). See docs/TEMPORAL_VERSIONING.md.
const WORKER_BUILD_ID =
  process.env.TEMPORAL_WORKER_BUILD_ID ??
  `${process.env.npm_package_version ?? "0.0.0"}-${process.env.GIT_SHA ?? "dev"}`;
const USE_WORKER_VERSIONING = process.env.TEMPORAL_WORKER_VERSIONING === "true";
const VERSION_GUARD_STRICT = process.env.TEMPORAL_VERSION_GUARD === "strict";

/**
 * OPS-11 version guard: refuse (strict) or warn loudly when workflow code is
 * about to start serving a task queue that already has IN-FLIGHT workflows
 * and the operator has not pinned an explicit build ID. Without a build ID
 * there is no replay-safety story for those executions.
 */
async function assertVersionGuard(): Promise<void> {
  try {
    const { getTemporalClient } = await import("./temporal");
    const client = await getTemporalClient();
    if (!client) return; // Temporal unavailable — nothing in flight reachable
    const running: string[] = [];
    for await (const wf of client.workflow.list({
      query: 'ExecutionStatus = "Running"',
    })) {
      running.push(wf.workflowId);
      if (running.length >= 5) break;
    }
    if (running.length > 0 && !process.env.TEMPORAL_WORKER_BUILD_ID) {
      const msg =
        `[Temporal] OPS-11 VERSION GUARD: ${running.length}+ in-flight workflows ` +
        `(e.g. ${running[0]}) but TEMPORAL_WORKER_BUILD_ID is not pinned — ` +
        `a workflow-code change can break replay of these executions. ` +
        `Pin a build ID and follow docs/TEMPORAL_VERSIONING.md (patch/deprecatePatch).`;
      if (VERSION_GUARD_STRICT) throw new Error(msg);
      logger.error(msg);
    }
  } catch (e) {
    if (VERSION_GUARD_STRICT) throw e;
    logger.warn("[Temporal] Version guard check skipped:: " + (e as Error).message);
  }
}

/**
 * Start the Temporal worker in-process.
 * Called from server/_core/index.ts after server starts listening.
 * Throws if Temporal server is unreachable — callers should catch and warn.
 */
export async function startTemporalWorker(): Promise<void> {
  await run();
}

async function run() {
  // Set up Temporal runtime with structured logging
  Runtime.install({
    logger: new DefaultLogger("INFO", ({ level, message, meta }) => {
      logger.info(
        JSON.stringify({
          ts: new Date().toISOString(),
          level,
          msg: message,
          ...meta,
        })
      );
    }),
  });

  const connection = await NativeConnection.connect({
    address: TEMPORAL_ADDRESS,
  });

  // Resolve the workflows file path — works in both CJS and ESM contexts
  const workflowsPath = path.resolve(
    __dirname ?? process.cwd(),
    "temporal-workflows"
  );
  // Journey workflows are registered directly as workflow functions
  const journeyWorkflows = {
    J01_CustomerOnboardingWorkflow, J02_PolicyPurchaseWorkflow,
    J03_ClaimsSettlementWorkflow, J04_AgentOnboardingWorkflow,
    J05_AgentDailyOpsWorkflow, J06_PolicyRenewalWorkflow,
    J07_FraudResponseWorkflow, J08_CommissionPayoutWorkflow,
    J09_RemittanceWorkflow, J10_ClaimDisputeWorkflow,
    J11_BrokerPolicyManagementWorkflow, J12_ActuaryIfrs17Workflow,
    J13_ComplianceMonitoringWorkflow, J14_PosTerminalLifecycleWorkflow,
    J15_ReinsuranceCessionWorkflow, J16_CustomerSelfServiceWorkflow,
    J17_BulkPremiumPaymentWorkflow, J18_AgentFloatReconciliationWorkflow,
    J19_UnderwritingDecisionWorkflow, J20_PlatformHealthMonitoringWorkflow,
  };

  await assertVersionGuard();

  const worker = await Worker.create({
    connection,
    namespace: TEMPORAL_NAMESPACE,
    taskQueue: TASK_QUEUE,
    // OPS-11: buildId enables Temporal worker versioning when the server has
    // it enabled (TEMPORAL_WORKER_VERSIONING=true); harmless otherwise.
    buildId: WORKER_BUILD_ID,
    ...(USE_WORKER_VERSIONING ? { useVersioning: true } : {}),
    workflowsPath,
    activities: { ...activities, ...journeyActivities, ...extendedActivities },
    maxConcurrentActivityTaskExecutions: 50,
    maxConcurrentWorkflowTaskExecutions: 20,
    maxCachedWorkflows: 100,
  });

  logger.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "INFO",
      msg: "Temporal worker v2 starting — 20 journeys registered",
      address: TEMPORAL_ADDRESS,
      namespace: TEMPORAL_NAMESPACE,
      taskQueue: TASK_QUEUE,
      buildId: WORKER_BUILD_ID,
      workerVersioning: USE_WORKER_VERSIONING,
    })
  );

  await worker.run();
}
