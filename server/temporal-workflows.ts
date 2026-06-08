// @ts-nocheck
/**
 * InsurePortal — Temporal Workflow Definitions
 * These run inside the Temporal sandbox (no direct I/O).
 * All I/O is delegated to activities.
 */
import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
  sleep,
  log,
  workflowInfo,
} from "@temporalio/workflow";
import type * as activities from "./temporal-activities";

// ── Activity proxies ──────────────────────────────────────────────────────────
const {
  fetchUnsettledTransactions,
  groupTransactionsByAgent,
  calculateAgentSettlements,
  validateSettlementAmounts,
  executeSettlementTransfers,
  markTransactionsAsSettled,
  generateSettlementReport,
  notifyAgentsOfSettlement,
  archiveSettlementBatch,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "1s",
    backoffCoefficient: 2,
    maximumInterval: "30s",
  },
});

// ── Signals & Queries ─────────────────────────────────────────────────────────
export const pauseSettlementSignal =
  defineSignal<[{ reason: string }]>("pauseSettlement");
export const resumeSettlementSignal = defineSignal("resumeSettlement");
export const cancelSettlementSignal =
  defineSignal<[{ reason: string }]>("cancelSettlement");
export const getSettlementStatusQuery = defineQuery<SettlementStatus>(
  "getSettlementStatus"
);

export interface SettlementStatus {
  phase: string;
  agentsProcessed: number;
  totalAgents: number;
  totalAmountSettled: number;
  paused: boolean;
  cancelled: boolean;
  errors: string[];
}

// ── Settlement Workflow ───────────────────────────────────────────────────────
export interface SettlementWorkflowInput {
  settlementDate: string; // ISO date string e.g. "2026-04-09"
  batchId: string;
  currency: string;
  dryRun?: boolean;
}

export async function SettlementWorkflow(
  input: SettlementWorkflowInput
): Promise<{ success: boolean; batchId: string; report: string }> {
  const { workflowId } = workflowInfo();
  let paused = false;
  let cancelled = false;
  let cancelReason = "";
  const status: SettlementStatus = {
    phase: "initializing",
    agentsProcessed: 0,
    totalAgents: 0,
    totalAmountSettled: 0,
    paused: false,
    cancelled: false,
    errors: [],
  };

  // Register signal handlers
  setHandler(pauseSettlementSignal, ({ reason }) => {
    log.info("Settlement paused", { reason, workflowId });
    paused = true;
    status.paused = true;
    status.phase = "paused";
  });

  setHandler(resumeSettlementSignal, () => {
    log.info("Settlement resumed", { workflowId });
    paused = false;
    status.paused = false;
    status.phase = "resuming";
  });

  setHandler(cancelSettlementSignal, ({ reason }) => {
    log.warn("Settlement cancelled", { reason, workflowId });
    cancelled = true;
    cancelReason = reason;
    status.cancelled = true;
    status.phase = "cancelled";
  });

  setHandler(getSettlementStatusQuery, () => ({ ...status }));

  try {
    // Phase 1: Fetch unsettled transactions
    status.phase = "fetching_transactions";
    log.info("Fetching unsettled transactions", {
      date: input.settlementDate,
      batchId: input.batchId,
    });
    const transactions = await fetchUnsettledTransactions({
      date: input.settlementDate,
      currency: input.currency,
    });

    if (cancelled) {
      return {
        success: false,
        batchId: input.batchId,
        report: `Cancelled: ${cancelReason}`,
      };
    }

    // Phase 2: Group by agent
    status.phase = "grouping_by_agent";
    const agentGroups = await groupTransactionsByAgent(transactions);
    status.totalAgents = agentGroups.length;

    // Phase 3: Calculate settlements
    status.phase = "calculating_settlements";
    const settlements = await calculateAgentSettlements(agentGroups);

    // Phase 4: Validate amounts
    status.phase = "validating_amounts";
    const validationResult = await validateSettlementAmounts(settlements);
    if (!validationResult.valid) {
      status.errors.push(...validationResult.errors);
      throw new Error(
        `Settlement validation failed: ${validationResult.errors.join(", ")}`
      );
    }

    if (input.dryRun) {
      log.info("Dry run complete — no transfers executed", { workflowId });
      const report = await generateSettlementReport({
        batchId: input.batchId,
        settlements,
        dryRun: true,
      });
      return { success: true, batchId: input.batchId, report };
    }

    // Phase 5: Execute transfers (with pause support)
    status.phase = "executing_transfers";
    for (let i = 0; i < settlements.length; i++) {
      // Wait if paused
      if (paused) {
        await condition(() => !paused, "1 hour");
      }
      if (cancelled) {
        break;
      }

      await executeSettlementTransfers([settlements[i]]);
      status.agentsProcessed = i + 1;
      status.totalAmountSettled += settlements[i].amount;
    }

    if (cancelled) {
      return {
        success: false,
        batchId: input.batchId,
        report: `Cancelled after ${status.agentsProcessed} agents`,
      };
    }

    // Phase 6: Mark transactions as settled
    status.phase = "marking_settled";
    await markTransactionsAsSettled({
      batchId: input.batchId,
      transactionIds: transactions.map((t: any) => t.id),
    });

    // Phase 7: Generate report
    status.phase = "generating_report";
    const report = await generateSettlementReport({
      batchId: input.batchId,
      settlements,
      dryRun: false,
    });

    // Phase 8: Notify agents
    status.phase = "notifying_agents";
    await notifyAgentsOfSettlement({
      settlements,
      reportUrl: `https://app.insureportal.ng/settlements/${input.batchId}`,
    });

    // Phase 9: Archive
    status.phase = "archiving";
    await archiveSettlementBatch({
      batchId: input.batchId,
      report,
      date: input.settlementDate,
    });

    status.phase = "completed";
    log.info("Settlement workflow completed", {
      workflowId,
      batchId: input.batchId,
      agentsSettled: status.agentsProcessed,
      totalAmount: status.totalAmountSettled,
    });

    return { success: true, batchId: input.batchId, report };
  } catch (err: any) {
    status.phase = "failed";
    status.errors.push(err.message);
    log.error("Settlement workflow failed", { workflowId, error: err.message });
    throw err;
  }
}

// ── Float Replenishment Workflow ──────────────────────────────────────────────
export interface FloatReplenishmentInput {
  agentId: number;
  requestedAmount: number;
  currency: string;
  requestId: string;
}

const {
  checkAgentFloatBalance,
  approveFloatReplenishment,
  executeFloatTransfer,
  notifyAgentOfFloat,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 3 },
});

export async function FloatReplenishmentWorkflow(
  input: FloatReplenishmentInput
): Promise<{ approved: boolean; transferRef: string }> {
  const balance = await checkAgentFloatBalance(input.agentId);

  if (balance.pendingRequests > 0) {
    log.warn("Agent has pending float requests", {
      agentId: input.agentId,
      pending: balance.pendingRequests,
    });
  }

  // Auto-approve if below 20% threshold
  const autoApprove = balance.currentBalance < balance.minBalance * 0.2;
  const approved = autoApprove
    ? true
    : await approveFloatReplenishment({
        agentId: input.agentId,
        requestId: input.requestId,
        amount: input.requestedAmount,
        currentBalance: balance.currentBalance,
      });

  if (!approved) {
    return { approved: false, transferRef: "" };
  }

  const transferRef = await executeFloatTransfer({
    agentId: input.agentId,
    amount: input.requestedAmount,
    currency: input.currency,
    requestId: input.requestId,
  });

  await notifyAgentOfFloat({
    agentId: input.agentId,
    amount: input.requestedAmount,
    currency: input.currency,
    transferRef,
  });

  return { approved: true, transferRef };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 82: Billing Provisioning Workflow
// 7-step workflow with rollback on failure
// ═══════════════════════════════════════════════════════════════════════════════

const billingActivities = proxyActivities<typeof activities>({
  startToCloseTimeout: "60s",
  retry: { maximumAttempts: 3, initialInterval: "2s", backoffCoefficient: 2 },
});

export interface BillingProvisioningInput {
  tenantId: number;
  tenantName: string;
  billingModel: "revenue_share" | "subscription" | "hybrid";
  customConfig?: any;
  provisionedBy: number;
  region: string;
  currency: string;
}

export interface BillingProvisioningResult {
  success: boolean;
  tenantId: number;
  steps: Array<{ step: string; status: string; details?: any; error?: string }>;
  configId: number;
  rollbackPerformed: boolean;
  duration: string;
}

const cancelBillingProvisioningSignal = defineSignal(
  "cancelBillingProvisioning"
);
const billingProvisioningStepQuery = defineQuery<string>(
  "billingProvisioningStep"
);

/**
 * BillingProvisioningWorkflow — provisions billing infrastructure for a new tenant.
 * 7 sequential steps with full rollback on failure.
 */
export async function BillingProvisioningWorkflow(
  input: BillingProvisioningInput
): Promise<BillingProvisioningResult> {
  const startTime = Date.now();
  let cancelled = false;
  let currentStep = "initializing";
  const completedSteps: string[] = [];
  const stepResults: Array<{
    step: string;
    status: string;
    details?: any;
    error?: string;
  }> = [];

  setHandler(cancelBillingProvisioningSignal, () => {
    cancelled = true;
    log.info("Billing provisioning cancellation requested", {
      tenantId: input.tenantId,
    });
  });
  setHandler(billingProvisioningStepQuery, () => currentStep);

  const steps = [
    {
      name: "validate_tenant",
      fn: () =>
        billingActivities.validateTenantForBilling({
          tenantId: input.tenantId,
          tenantName: input.tenantName,
        }),
    },
    {
      name: "create_billing_config",
      fn: () =>
        billingActivities.createBillingConfig({
          tenantId: input.tenantId,
          billingModel: input.billingModel,
          customConfig: input.customConfig,
          provisionedBy: input.provisionedBy,
          currency: input.currency,
        }),
    },
    {
      name: "create_tigerbeetle_accounts",
      fn: () =>
        billingActivities.createTigerBeetleAccounts({
          tenantId: input.tenantId,
        }),
    },
    {
      name: "provision_kafka_topics",
      fn: () =>
        billingActivities.provisionKafkaTopics({ tenantId: input.tenantId }),
    },
    {
      name: "assign_billing_roles",
      fn: () =>
        billingActivities.assignBillingRoles({
          tenantId: input.tenantId,
          provisionedBy: input.provisionedBy,
        }),
    },
    {
      name: "configure_reconciliation",
      fn: () =>
        billingActivities.configureReconciliation({
          tenantId: input.tenantId,
          region: input.region,
        }),
    },
    {
      name: "activate_billing",
      fn: () =>
        billingActivities.activateBilling({
          tenantId: input.tenantId,
          provisionedBy: input.provisionedBy,
        }),
    },
  ];

  let configId = 0;

  for (const step of steps) {
    if (cancelled) {
      log.warn("Billing provisioning cancelled", {
        step: step.name,
        tenantId: input.tenantId,
      });
      break;
    }
    currentStep = step.name;
    log.info("Executing billing provisioning step", {
      step: step.name,
      tenantId: input.tenantId,
    });

    try {
      const result = await step.fn();
      completedSteps.push(step.name);
      stepResults.push({
        step: step.name,
        status: "completed",
        details: result,
      });
      if (step.name === "create_billing_config" && result?.configId) {
        configId = result.configId;
      }
    } catch (error) {
      const errMsg = (error as Error).message || "Unknown error";
      stepResults.push({ step: step.name, status: "failed", error: errMsg });
      log.error("Billing step failed — initiating rollback", {
        step: step.name,
        error: errMsg,
        tenantId: input.tenantId,
      });

      // Rollback in reverse order
      for (let i = completedSteps.length - 1; i >= 0; i--) {
        currentStep = `rollback_${completedSteps[i]}`;
        log.info("Rolling back billing step", {
          step: completedSteps[i],
          tenantId: input.tenantId,
        });
        try {
          await billingActivities.rollbackBillingStep({
            tenantId: input.tenantId,
            step: completedSteps[i],
          });
        } catch (rbErr) {
          log.error("Rollback failed (manual intervention required)", {
            step: completedSteps[i],
            error: (rbErr as Error).message,
          });
        }
      }

      return {
        success: false,
        tenantId: input.tenantId,
        steps: stepResults,
        configId,
        rollbackPerformed: true,
        duration: `${Date.now() - startTime}ms`,
      };
    }
  }

  return {
    success: !cancelled,
    tenantId: input.tenantId,
    steps: stepResults,
    configId,
    rollbackPerformed: false,
    duration: `${Date.now() - startTime}ms`,
  };
}
