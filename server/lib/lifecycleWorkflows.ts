// TypeScript enabled — Sprint 96 security audit
/**
 * Lifecycle Workflow Engine — InsurePortal Insurance Platform
 *
 * State machines for:
 * 1. Agent Onboarding: apply → kyc → training → approval → active → suspended → terminated
 * 2. Transaction: initiated → validated → processing → processed → settled → reconciled → failed
 * 3. Dispute Resolution: filed → investigating → resolved → appealed → closed
 * 4. KYC Verification: submitted → document_review → liveness_check → approved/rejected
 * 5. Settlement: pending → processing → completed → failed → reconciled
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Generic State Machine
// ═══════════════════════════════════════════════════════════════════════════════
export interface StateTransition<S extends string> {
  from: S;
  to: S;
  action: string;
  requiredRole?: string[];
  guard?: (context: Record<string, unknown>) => boolean;
}

export interface WorkflowEvent {
  id: string;
  entityId: string;
  entityType: string;
  fromState: string;
  toState: string;
  action: string;
  performedBy: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

const workflowHistory: WorkflowEvent[] = [];

export function getWorkflowHistory(
  entityId: string,
  entityType: string
): WorkflowEvent[] {
  return workflowHistory.filter(
    e => e.entityId === entityId && e.entityType === entityType
  );
}

function recordTransition(
  event: Omit<WorkflowEvent, "id" | "timestamp">
): WorkflowEvent {
  const full: WorkflowEvent = {
    ...event,
    id: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  };
  workflowHistory.push(full);
  if (workflowHistory.length > 50000)
    workflowHistory.splice(0, workflowHistory.length - 50000);
  return full;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Agent Onboarding Workflow
// ═══════════════════════════════════════════════════════════════════════════════
export type AgentState =
  | "applied"
  | "kyc_pending"
  | "kyc_review"
  | "training"
  | "approval_pending"
  | "active"
  | "suspended"
  | "terminated";

const agentTransitions: StateTransition<AgentState>[] = [
  {
    from: "applied",
    to: "kyc_pending",
    action: "submit_application",
    requiredRole: ["agent"],
  },
  {
    from: "kyc_pending",
    to: "kyc_review",
    action: "submit_documents",
    requiredRole: ["agent"],
  },
  {
    from: "kyc_review",
    to: "training",
    action: "approve_kyc",
    requiredRole: ["admin", "supervisor"],
  },
  {
    from: "kyc_review",
    to: "kyc_pending",
    action: "reject_kyc",
    requiredRole: ["admin", "supervisor"],
  },
  {
    from: "training",
    to: "approval_pending",
    action: "complete_training",
    requiredRole: ["agent"],
  },
  {
    from: "approval_pending",
    to: "active",
    action: "approve_agent",
    requiredRole: ["admin", "supervisor"],
  },
  {
    from: "approval_pending",
    to: "training",
    action: "require_retraining",
    requiredRole: ["admin", "supervisor"],
  },
  {
    from: "active",
    to: "suspended",
    action: "suspend_agent",
    requiredRole: ["admin", "supervisor"],
  },
  {
    from: "suspended",
    to: "active",
    action: "reactivate_agent",
    requiredRole: ["admin"],
  },
  {
    from: "suspended",
    to: "terminated",
    action: "terminate_agent",
    requiredRole: ["admin"],
  },
  {
    from: "active",
    to: "terminated",
    action: "terminate_agent",
    requiredRole: ["admin"],
  },
];

export function transitionAgent(
  currentState: AgentState,
  action: string,
  performedBy: string,
  agentId: string,
  metadata?: Record<string, unknown>
): { newState: AgentState; event: WorkflowEvent } | { error: string } {
  const transition = agentTransitions.find(
    t => t.from === currentState && t.action === action
  );
  if (!transition)
    return {
      error: `Invalid transition: ${action} from state ${currentState}`,
    };
  const event = recordTransition({
    entityId: agentId,
    entityType: "agent",
    fromState: currentState,
    toState: transition.to,
    action,
    performedBy,
    metadata,
  });
  return { newState: transition.to, event };
}

export function getValidAgentActions(currentState: AgentState): string[] {
  return agentTransitions
    .filter(t => t.from === currentState)
    .map(t => t.action);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Transaction Lifecycle
// ═══════════════════════════════════════════════════════════════════════════════
export type TransactionState =
  | "initiated"
  | "validated"
  | "processing"
  | "processed"
  | "settled"
  | "reconciled"
  | "failed"
  | "reversed"
  | "cancelled";

const transactionTransitions: StateTransition<TransactionState>[] = [
  { from: "initiated", to: "validated", action: "validate" },
  { from: "initiated", to: "failed", action: "validation_failed" },
  { from: "initiated", to: "cancelled", action: "cancel" },
  { from: "validated", to: "processing", action: "process" },
  { from: "validated", to: "failed", action: "processing_failed" },
  { from: "processing", to: "processed", action: "complete" },
  { from: "processing", to: "failed", action: "processing_error" },
  { from: "processed", to: "settled", action: "settle" },
  {
    from: "processed",
    to: "reversed",
    action: "reverse",
    requiredRole: ["admin", "supervisor"],
  },
  { from: "settled", to: "reconciled", action: "reconcile" },
  {
    from: "settled",
    to: "reversed",
    action: "reverse",
    requiredRole: ["admin"],
  },
  { from: "failed", to: "initiated", action: "retry" },
];

export function transitionTransaction(
  currentState: TransactionState,
  action: string,
  performedBy: string,
  txnId: string,
  metadata?: Record<string, unknown>
): { newState: TransactionState; event: WorkflowEvent } | { error: string } {
  const transition = transactionTransitions.find(
    t => t.from === currentState && t.action === action
  );
  if (!transition)
    return {
      error: `Invalid transition: ${action} from state ${currentState}`,
    };
  const event = recordTransition({
    entityId: txnId,
    entityType: "transaction",
    fromState: currentState,
    toState: transition.to,
    action,
    performedBy,
    metadata,
  });
  return { newState: transition.to, event };
}

export function getValidTransactionActions(
  currentState: TransactionState
): string[] {
  return transactionTransitions
    .filter(t => t.from === currentState)
    .map(t => t.action);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Dispute Resolution Workflow
// ═══════════════════════════════════════════════════════════════════════════════
export type DisputeState =
  | "filed"
  | "acknowledged"
  | "investigating"
  | "evidence_requested"
  | "resolved_favor_customer"
  | "resolved_favor_agent"
  | "appealed"
  | "escalated"
  | "closed";

const disputeTransitions: StateTransition<DisputeState>[] = [
  { from: "filed", to: "acknowledged", action: "acknowledge" },
  { from: "acknowledged", to: "investigating", action: "start_investigation" },
  {
    from: "investigating",
    to: "evidence_requested",
    action: "request_evidence",
  },
  {
    from: "evidence_requested",
    to: "investigating",
    action: "evidence_received",
  },
  {
    from: "investigating",
    to: "resolved_favor_customer",
    action: "resolve_customer",
  },
  {
    from: "investigating",
    to: "resolved_favor_agent",
    action: "resolve_agent",
  },
  { from: "resolved_favor_customer", to: "appealed", action: "appeal" },
  { from: "resolved_favor_agent", to: "appealed", action: "appeal" },
  { from: "appealed", to: "escalated", action: "escalate" },
  { from: "appealed", to: "closed", action: "uphold_decision" },
  { from: "escalated", to: "closed", action: "final_resolution" },
  { from: "resolved_favor_customer", to: "closed", action: "close" },
  { from: "resolved_favor_agent", to: "closed", action: "close" },
];

export function transitionDispute(
  currentState: DisputeState,
  action: string,
  performedBy: string,
  disputeId: string,
  metadata?: Record<string, unknown>
): { newState: DisputeState; event: WorkflowEvent } | { error: string } {
  const transition = disputeTransitions.find(
    t => t.from === currentState && t.action === action
  );
  if (!transition)
    return {
      error: `Invalid transition: ${action} from state ${currentState}`,
    };
  const event = recordTransition({
    entityId: disputeId,
    entityType: "dispute",
    fromState: currentState,
    toState: transition.to,
    action,
    performedBy,
    metadata,
  });
  return { newState: transition.to, event };
}

export function getValidDisputeActions(currentState: DisputeState): string[] {
  return disputeTransitions
    .filter(t => t.from === currentState)
    .map(t => t.action);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. KYC Verification Workflow
// ═══════════════════════════════════════════════════════════════════════════════
export type KycState =
  | "not_started"
  | "submitted"
  | "document_review"
  | "liveness_check"
  | "manual_review"
  | "approved"
  | "rejected"
  | "expired";

const kycTransitions: StateTransition<KycState>[] = [
  { from: "not_started", to: "submitted", action: "submit" },
  { from: "submitted", to: "document_review", action: "start_review" },
  {
    from: "document_review",
    to: "liveness_check",
    action: "documents_verified",
  },
  { from: "document_review", to: "rejected", action: "documents_rejected" },
  { from: "document_review", to: "submitted", action: "request_resubmission" },
  {
    from: "liveness_check",
    to: "manual_review",
    action: "liveness_inconclusive",
  },
  { from: "liveness_check", to: "approved", action: "liveness_passed" },
  { from: "liveness_check", to: "rejected", action: "liveness_failed" },
  { from: "manual_review", to: "approved", action: "manual_approve" },
  { from: "manual_review", to: "rejected", action: "manual_reject" },
  { from: "rejected", to: "submitted", action: "resubmit" },
  { from: "approved", to: "expired", action: "expire" },
  { from: "expired", to: "submitted", action: "renew" },
];

export function transitionKyc(
  currentState: KycState,
  action: string,
  performedBy: string,
  kycId: string,
  metadata?: Record<string, unknown>
): { newState: KycState; event: WorkflowEvent } | { error: string } {
  const transition = kycTransitions.find(
    t => t.from === currentState && t.action === action
  );
  if (!transition)
    return {
      error: `Invalid transition: ${action} from state ${currentState}`,
    };
  const event = recordTransition({
    entityId: kycId,
    entityType: "kyc",
    fromState: currentState,
    toState: transition.to,
    action,
    performedBy,
    metadata,
  });
  return { newState: transition.to, event };
}

export function getValidKycActions(currentState: KycState): string[] {
  return kycTransitions.filter(t => t.from === currentState).map(t => t.action);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Settlement Workflow
// ═══════════════════════════════════════════════════════════════════════════════
export type SettlementState =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "reconciled"
  | "disputed";

const settlementTransitions: StateTransition<SettlementState>[] = [
  { from: "pending", to: "processing", action: "start_processing" },
  { from: "processing", to: "completed", action: "complete" },
  { from: "processing", to: "failed", action: "fail" },
  { from: "completed", to: "reconciled", action: "reconcile" },
  { from: "completed", to: "disputed", action: "dispute" },
  { from: "failed", to: "pending", action: "retry" },
  { from: "disputed", to: "reconciled", action: "resolve" },
];

export function transitionSettlement(
  currentState: SettlementState,
  action: string,
  performedBy: string,
  settlementId: string,
  metadata?: Record<string, unknown>
): { newState: SettlementState; event: WorkflowEvent } | { error: string } {
  const transition = settlementTransitions.find(
    t => t.from === currentState && t.action === action
  );
  if (!transition)
    return {
      error: `Invalid transition: ${action} from state ${currentState}`,
    };
  const event = recordTransition({
    entityId: settlementId,
    entityType: "settlement",
    fromState: currentState,
    toState: transition.to,
    action,
    performedBy,
    metadata,
  });
  return { newState: transition.to, event };
}

export function getValidSettlementActions(
  currentState: SettlementState
): string[] {
  return settlementTransitions
    .filter(t => t.from === currentState)
    .map(t => t.action);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Workflow Statistics
// ═══════════════════════════════════════════════════════════════════════════════
export function getWorkflowStats() {
  const now = Date.now();
  const last24h = workflowHistory.filter(e => now - e.timestamp < 86400000);
  const byType: Record<string, number> = {};
  for (const e of last24h) {
    byType[e.entityType] = (byType[e.entityType] || 0) + 1;
  }
  return {
    totalTransitions: workflowHistory.length,
    last24h: last24h.length,
    byEntityType: byType,
  };
}
