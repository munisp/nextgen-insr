// TypeScript enabled — Sprint 96 security audit
/**
 * Transaction Lifecycle State Machine — InsurePortal Insurance Platform
 *
 * Enforces valid state transitions:
 * initiated → validated → processing → processed → settled → reconciled
 *                                    → failed → reversed
 */

export type TransactionState =
  | "initiated"
  | "validated"
  | "processing"
  | "processed"
  | "settled"
  | "reconciled"
  | "failed"
  | "reversed"
  | "disputed";

const VALID_TRANSITIONS: Record<TransactionState, TransactionState[]> = {
  initiated: ["validated", "failed"],
  validated: ["processing", "failed"],
  processing: ["processed", "failed"],
  processed: ["settled", "failed", "reversed", "disputed"],
  settled: ["reconciled", "disputed"],
  reconciled: [],
  failed: ["initiated"], // Allow retry
  reversed: [],
  disputed: ["processed", "reversed"], // Dispute can resolve back or reverse
};

export function canTransition(
  from: TransactionState,
  to: TransactionState
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidNextStates(
  current: TransactionState
): TransactionState[] {
  return VALID_TRANSITIONS[current] ?? [];
}

export function validateTransition(
  from: TransactionState,
  to: TransactionState
): { valid: boolean; error?: string } {
  if (!VALID_TRANSITIONS[from]) {
    return { valid: false, error: `Unknown state: ${from}` };
  }
  if (!canTransition(from, to)) {
    return {
      valid: false,
      error: `Invalid transition: ${from} → ${to}. Valid: ${VALID_TRANSITIONS[from].join(", ")}`,
    };
  }
  return { valid: true };
}

// ── Agent Onboarding Lifecycle ──────────────────────────────────────────

export type AgentOnboardingState =
  | "applied"
  | "kyc_pending"
  | "kyc_approved"
  | "training"
  | "approval_pending"
  | "active"
  | "suspended"
  | "terminated";

const AGENT_TRANSITIONS: Record<AgentOnboardingState, AgentOnboardingState[]> =
  {
    applied: ["kyc_pending", "terminated"],
    kyc_pending: ["kyc_approved", "applied", "terminated"],
    kyc_approved: ["training", "terminated"],
    training: ["approval_pending", "terminated"],
    approval_pending: ["active", "applied", "terminated"],
    active: ["suspended", "terminated"],
    suspended: ["active", "terminated"],
    terminated: [],
  };

export function canAgentTransition(
  from: AgentOnboardingState,
  to: AgentOnboardingState
): boolean {
  return AGENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getAgentNextStates(
  current: AgentOnboardingState
): AgentOnboardingState[] {
  return AGENT_TRANSITIONS[current] ?? [];
}

// ── Dispute Resolution Lifecycle ────────────────────────────────────────

export type DisputeState =
  | "filed"
  | "investigating"
  | "evidence_requested"
  | "escalated"
  | "resolved_customer"
  | "resolved_merchant"
  | "appealed"
  | "closed";

const DISPUTE_TRANSITIONS: Record<DisputeState, DisputeState[]> = {
  filed: ["investigating", "closed"],
  investigating: [
    "evidence_requested",
    "escalated",
    "resolved_customer",
    "resolved_merchant",
  ],
  evidence_requested: ["investigating", "closed"],
  escalated: ["resolved_customer", "resolved_merchant", "closed"],
  resolved_customer: ["appealed", "closed"],
  resolved_merchant: ["appealed", "closed"],
  appealed: ["investigating", "closed"],
  closed: [],
};

export function canDisputeTransition(
  from: DisputeState,
  to: DisputeState
): boolean {
  return DISPUTE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getDisputeNextStates(current: DisputeState): DisputeState[] {
  return DISPUTE_TRANSITIONS[current] ?? [];
}

// ── Settlement Lifecycle ────────────────────────────────────────────────

export type SettlementState =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "reconciled";

const SETTLEMENT_TRANSITIONS: Record<SettlementState, SettlementState[]> = {
  pending: ["processing", "failed"],
  processing: ["completed", "failed"],
  completed: ["reconciled"],
  failed: ["pending"], // Allow retry
  reconciled: [],
};

export function canSettlementTransition(
  from: SettlementState,
  to: SettlementState
): boolean {
  return SETTLEMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Commission Cascade Recalculation ────────────────────────────────────

export interface CommissionTierRate {
  tier: string;
  premiumCollectionRate: number;
  claimPayoutRate: number;
  transferRate: number;
  airtimeRate: number;
  billsRate: number;
}

const COMMISSION_RATES: CommissionTierRate[] = [
  {
    tier: "basic",
    premiumCollectionRate: 0.005,
    claimPayoutRate: 0.008,
    transferRate: 0.003,
    airtimeRate: 0.025,
    billsRate: 0.01,
  },
  {
    tier: "standard",
    premiumCollectionRate: 0.007,
    claimPayoutRate: 0.01,
    transferRate: 0.005,
    airtimeRate: 0.03,
    billsRate: 0.015,
  },
  {
    tier: "premium",
    premiumCollectionRate: 0.01,
    claimPayoutRate: 0.015,
    transferRate: 0.008,
    airtimeRate: 0.04,
    billsRate: 0.02,
  },
  {
    tier: "enterprise",
    premiumCollectionRate: 0.012,
    claimPayoutRate: 0.018,
    transferRate: 0.01,
    airtimeRate: 0.05,
    billsRate: 0.025,
  },
];

export function getCommissionRate(tier: string, txType: string): number {
  const tierRates =
    COMMISSION_RATES.find(r => r.tier === tier) ?? COMMISSION_RATES[0];
  const typeMap: Record<string, keyof CommissionTierRate> = {
    cash_in: "premiumCollectionRate",
    cash_out: "claimPayoutRate",
    transfer: "transferRate",
    airtime: "airtimeRate",
    bills: "billsRate",
  };
  const rateKey = typeMap[txType] ?? "premiumCollectionRate";
  return tierRates[rateKey] as number;
}

export function calculateCommission(
  tier: string,
  txType: string,
  amount: number
): number {
  const rate = getCommissionRate(tier, txType);
  return Math.round(amount * rate * 100) / 100;
}

export function recalculateCommissionOnTierChange(
  oldTier: string,
  newTier: string,
  pendingTransactions: { type: string; amount: number }[]
): {
  totalDelta: number;
  adjustments: {
    type: string;
    amount: number;
    oldCommission: number;
    newCommission: number;
    delta: number;
  }[];
} {
  const adjustments = pendingTransactions.map(tx => {
    const oldCommission = calculateCommission(oldTier, tx.type, tx.amount);
    const newCommission = calculateCommission(newTier, tx.type, tx.amount);
    return {
      type: tx.type,
      amount: tx.amount,
      oldCommission,
      newCommission,
      delta: newCommission - oldCommission,
    };
  });

  const totalDelta = adjustments.reduce((sum, a) => sum + a.delta, 0);
  return { totalDelta, adjustments };
}
