/**
 * InsurePortal POS — Temporal Activities
 * All activities run in the worker process with full access to DB, Redis, and external APIs.
 */
import { eq, and, isNull, inArray, sql } from "drizzle-orm";

import { getDb } from "./db";
import {
  transactions,
  agents,
  tenants,
} from "../drizzle/schema";
import { logger } from './_core/logger';

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
  // Update agent premium reserve using SQL expression (no db.raw)
  for (const s of settlements) {
    const _db = await getDbInstance();

    await _db
      .update(agents)
      .set({
        premiumReserve: sql`${agents.premiumReserve} + ${String(s.netAmount)}`,
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
  logger.info(
    `[Temporal] Notified ${input.settlements.length} agents of settlement. Report: ${input.reportUrl}`
  );
}

export async function archiveSettlementBatch(input: {
  batchId: string;
  report: string;
  date: string;
}): Promise<void> {
  logger.info(
    `[Temporal] Archived settlement batch ${input.batchId} for ${input.date}`
  );
}

// ── Float Activities ──────────────────────────────────────────────────────────

export async function checkAgentFloatBalance(
  agentId: number
): Promise<FloatBalance> {
  const _db = await getDbInstance();
  const agent = await _db
    .select({ premiumReserve: agents.premiumReserve })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  return {
    agentId,
    currentBalance: Number(agent[0]?.premiumReserve ?? 0),
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
      premiumReserve: sql`${agents.premiumReserve} + ${String(input.amount)}`,
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
  logger.info(
    `[Temporal] Agent ${input.agentId} float transfer ${input.transferRef}: ${input.amount} ${input.currency}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 82: Billing Provisioning Activities
// ═══════════════════════════════════════════════════════════════════════════════
