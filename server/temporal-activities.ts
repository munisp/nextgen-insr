/**
 * InsurePortal — Temporal Activities
 * All activities run in the worker process with full access to DB, Redis, and external APIs.
 */
import { getDb } from "./db";
import {
  transactions,
  agents,
  tenants,
  tenantBillingConfig,
  billingRoleAssignments,
} from "../drizzle/schema";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";

async function getDbInstance() {
  const instance = await getDb();
  if (!instance) throw new Error("Database not available");
  return instance;
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface UnsettledTransaction {
  id: number;
  agentId: number;
  amount: number;
  currency: string;
  transactionType: string;
  completedAt: Date;
}

export interface AgentGroup {
  agentId: number;
  transactions: UnsettledTransaction[];
  totalAmount: number;
}

export interface AgentSettlement {
  agentId: number;
  amount: number;
  currency: string;
  transactionCount: number;
  commissionAmount: number;
  netAmount: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface FloatBalance {
  agentId: number;
  currentBalance: number;
  minBalance: number;
  pendingRequests: number;
}

// ── Settlement Activities ─────────────────────────────────────────────────────

export async function fetchUnsettledTransactions(input: {
  date: string;
  currency: string;
}): Promise<UnsettledTransaction[]> {
  const _db = await getDbInstance();

  const rows = await _db
    .select()
    .from(transactions)
    .where(
      and(eq(transactions.status, "success"), isNull(transactions.deletedAt))
    )
    .limit(10000);

  return rows.map((r: typeof transactions.$inferSelect) => ({
    id: r.id,
    agentId: r.agentId,
    amount: Number(r.amount),
    currency: r.currency ?? input.currency,
    transactionType: r.type,
    completedAt: r.updatedAt ?? new Date(),
  }));
}

export async function groupTransactionsByAgent(
  txs: UnsettledTransaction[]
): Promise<AgentGroup[]> {
  const groups = new Map<number, UnsettledTransaction[]>();
  for (const tx of txs) {
    const existing = groups.get(tx.agentId) ?? [];
    existing.push(tx);
    groups.set(tx.agentId, existing);
  }
  return Array.from(groups.entries()).map(([agentId, txList]) => ({
    agentId,
    transactions: txList,
    totalAmount: txList.reduce((sum, t) => sum + t.amount, 0),
  }));
}

export async function calculateAgentSettlements(
  groups: AgentGroup[]
): Promise<AgentSettlement[]> {
  const COMMISSION_RATE = 0.005; // 0.5% commission per transaction
  return groups.map(g => {
    const commissionAmount = g.totalAmount * COMMISSION_RATE;
    return {
      agentId: g.agentId,
      amount: g.totalAmount,
      currency: "NGN",
      transactionCount: g.transactions.length,
      commissionAmount,
      netAmount: g.totalAmount - commissionAmount,
    };
  });
}

export async function validateSettlementAmounts(
  settlements: AgentSettlement[]
): Promise<ValidationResult> {
  const errors: string[] = [];
  for (const s of settlements) {
    if (s.amount <= 0) {
      errors.push(`Agent ${s.agentId}: invalid amount ${s.amount}`);
    }
    if (s.netAmount < 0) {
      errors.push(`Agent ${s.agentId}: negative net amount ${s.netAmount}`);
    }
    if (s.transactionCount === 0) {
      errors.push(`Agent ${s.agentId}: no transactions`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export async function executeSettlementTransfers(
  settlements: AgentSettlement[]
): Promise<void> {
  // Update agent float balance using SQL expression (no db.raw)
  for (const s of settlements) {
    const _db = await getDbInstance();

    await _db
      .update(agents)
      .set({
        floatBalance: sql`${agents.floatBalance} + ${String(s.netAmount)}`,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, s.agentId));
  }
}

export async function markTransactionsAsSettled(input: {
  batchId: string;
  transactionIds: number[];
}): Promise<void> {
  if (input.transactionIds.length === 0) return;
  // Mark transactions as settled by updating metadata
  const _db = await getDbInstance();

  await _db
    .update(transactions)
    .set({
      metadata: sql`jsonb_set(COALESCE(metadata, '{}'), '{settlementBatchId}', ${JSON.stringify(input.batchId)})`,
      updatedAt: new Date(),
    })
    .where(inArray(transactions.id, input.transactionIds));
}

export async function generateSettlementReport(input: {
  batchId: string;
  settlements: AgentSettlement[];
  dryRun: boolean;
}): Promise<string> {
  const totalAmount = input.settlements.reduce((s, a) => s + a.amount, 0);
  const totalCommission = input.settlements.reduce(
    (s, a) => s + a.commissionAmount,
    0
  );
  const totalNet = input.settlements.reduce((s, a) => s + a.netAmount, 0);

  return JSON.stringify({
    batchId: input.batchId,
    generatedAt: new Date().toISOString(),
    dryRun: input.dryRun,
    summary: {
      agentCount: input.settlements.length,
      totalTransactions: input.settlements.reduce(
        (s, a) => s + a.transactionCount,
        0
      ),
      totalAmount,
      totalCommission,
      totalNet,
      currency: "NGN",
    },
    settlements: input.settlements,
  });
}

export async function notifyAgentsOfSettlement(input: {
  settlements: AgentSettlement[];
  reportUrl: string;
}): Promise<void> {
  console.log(
    `[Temporal] Notified ${input.settlements.length} agents of settlement. Report: ${input.reportUrl}`
  );
}

export async function archiveSettlementBatch(input: {
  batchId: string;
  report: string;
  date: string;
}): Promise<void> {
  console.log(
    `[Temporal] Archived settlement batch ${input.batchId} for ${input.date}`
  );
}

// ── Float Activities ──────────────────────────────────────────────────────────

export async function checkAgentFloatBalance(
  agentId: number
): Promise<FloatBalance> {
  const _db = await getDbInstance();
  const agent = await _db
    .select({ floatBalance: agents.floatBalance })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  return {
    agentId,
    currentBalance: Number(agent[0]?.floatBalance ?? 0),
    minBalance: 50_000,
    pendingRequests: 0,
  };
}

export async function approveFloatReplenishment(input: {
  agentId: number;
  requestId: string;
  amount: number;
  currentBalance: number;
}): Promise<boolean> {
  const MAX_AUTO_APPROVE = 500_000;
  return input.amount <= MAX_AUTO_APPROVE;
}

export async function executeFloatTransfer(input: {
  agentId: number;
  amount: number;
  currency: string;
  requestId: string;
}): Promise<string> {
  const transferRef = `FLT-${input.requestId}-${Date.now()}`;
  const _db = await getDbInstance();

  await _db
    .update(agents)
    .set({
      floatBalance: sql`${agents.floatBalance} + ${String(input.amount)}`,
      updatedAt: new Date(),
    })
    .where(eq(agents.id, input.agentId));
  return transferRef;
}

export async function notifyAgentOfFloat(input: {
  agentId: number;
  amount: number;
  currency: string;
  transferRef: string;
}): Promise<void> {
  console.log(
    `[Temporal] Agent ${input.agentId} float transfer ${input.transferRef}: ${input.amount} ${input.currency}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 82: Billing Provisioning Activities
// ═══════════════════════════════════════════════════════════════════════════════

export async function validateTenantForBilling(input: {
  tenantId: number;
  tenantName: string;
}): Promise<{ valid: boolean; tenantName: string }> {
  const _db = await getDbInstance();
  const [tenant] = await _db
    .select()
    .from(tenants)
    .where(eq(tenants.id, input.tenantId));
  if (!tenant) throw new Error(`Tenant ${input.tenantId} not found`);
  return { valid: true, tenantName: tenant.name || input.tenantName };
}

export async function createBillingConfig(input: {
  tenantId: number;
  billingModel: string;
  customConfig?: any;
  provisionedBy: number;
  currency: string;
}): Promise<{ configId: number; billingModel: string }> {
  const _db = await getDbInstance();
  const [config] = await _db
    .insert(tenantBillingConfig)
    .values({
      tenantId: input.tenantId,
      billingModel: input.billingModel,
      currency: input.currency || "NGN",
      provisionedBy: input.provisionedBy,
      status: "provisioning",
      revenueShareConfig: input.customConfig?.revenueShareConfig || null,
      subscriptionConfig: input.customConfig?.subscriptionConfig || null,
      hybridConfig: input.customConfig?.hybridConfig || null,
    })
    .returning();
  return { configId: config.id, billingModel: input.billingModel };
}

export async function createTigerBeetleAccounts(input: {
  tenantId: number;
}): Promise<{ accountId: string; accounts: string[] }> {
  const accountId = `TB-${input.tenantId}-${Date.now()}`;
  const _db = await getDbInstance();
  await _db
    .update(tenantBillingConfig)
    .set({ tigerBeetleAccountId: accountId })
    .where(eq(tenantBillingConfig.tenantId, input.tenantId));
  return {
    accountId,
    accounts: [
      `${accountId}-revenue`,
      `${accountId}-commission`,
      `${accountId}-settlement`,
      `${accountId}-escrow`,
    ],
  };
}

export async function provisionKafkaTopics(input: {
  tenantId: number;
}): Promise<{ topicPrefix: string; topics: string[] }> {
  const topicPrefix = `billing.tenant-${input.tenantId}`;
  const topics = [
    `${topicPrefix}.transactions`,
    `${topicPrefix}.splits`,
    `${topicPrefix}.reconciliation`,
    `${topicPrefix}.audit`,
  ];
  const _db = await getDbInstance();
  await _db
    .update(tenantBillingConfig)
    .set({ kafkaTopicPrefix: topicPrefix })
    .where(eq(tenantBillingConfig.tenantId, input.tenantId));
  return { topicPrefix, topics };
}

export async function assignBillingRoles(input: {
  tenantId: number;
  provisionedBy: number;
}): Promise<{ role: string; assignedTo: number }> {
  const _db = await getDbInstance();
  await _db.insert(billingRoleAssignments).values({
    userId: input.provisionedBy,
    tenantId: input.tenantId,
    billingRole: "billing_admin",
    permissions: null,
    grantedBy: input.provisionedBy,
  });
  return { role: "billing_admin", assignedTo: input.provisionedBy };
}

export async function configureReconciliation(input: {
  tenantId: number;
  region: string;
}): Promise<{ schedule: string; threshold: number }> {
  console.log(
    `[Temporal Activity] Configuring reconciliation for tenant ${input.tenantId} in ${input.region}`
  );
  return { schedule: "daily@02:00WAT", threshold: 0.01 };
}

export async function activateBilling(input: {
  tenantId: number;
  provisionedBy: number;
}): Promise<{ activated: boolean; activatedAt: string }> {
  const _db = await getDbInstance();
  await _db
    .update(tenantBillingConfig)
    .set({
      status: "active",
      lastModifiedAt: new Date(),
      lastModifiedBy: input.provisionedBy,
    })
    .where(eq(tenantBillingConfig.tenantId, input.tenantId));
  return { activated: true, activatedAt: new Date().toISOString() };
}

export async function rollbackBillingStep(input: {
  tenantId: number;
  step: string;
}): Promise<void> {
  const _db = await getDbInstance();
  console.log(
    `[Temporal Activity] Rolling back step '${input.step}' for tenant ${input.tenantId}`
  );
  switch (input.step) {
    case "create_billing_config":
      await _db
        .delete(tenantBillingConfig)
        .where(eq(tenantBillingConfig.tenantId, input.tenantId));
      break;
    case "create_tigerbeetle_accounts":
      await _db
        .update(tenantBillingConfig)
        .set({ tigerBeetleAccountId: null })
        .where(eq(tenantBillingConfig.tenantId, input.tenantId));
      break;
    case "provision_kafka_topics":
      await _db
        .update(tenantBillingConfig)
        .set({ kafkaTopicPrefix: null })
        .where(eq(tenantBillingConfig.tenantId, input.tenantId));
      break;
    case "assign_billing_roles":
      await _db
        .delete(billingRoleAssignments)
        .where(eq(billingRoleAssignments.tenantId, input.tenantId));
      break;
    case "activate_billing":
      await _db
        .update(tenantBillingConfig)
        .set({ status: "provisioning" })
        .where(eq(tenantBillingConfig.tenantId, input.tenantId));
      break;
    default:
      console.log(
        `[Temporal Activity] No rollback action for step '${input.step}'`
      );
  }
}
