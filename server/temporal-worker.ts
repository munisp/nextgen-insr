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

  const worker = await Worker.create({
    connection,
    namespace: TEMPORAL_NAMESPACE,
    taskQueue: TASK_QUEUE,
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
    })
  );

  await worker.run();
}
