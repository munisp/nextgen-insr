// TypeScript enabled — Sprint 96 security audit
/**
 * Hierarchical Commission Cascade Engine
 *
 * When a transaction occurs, commission is split across the agent hierarchy:
 *   Sub-Agent (L4) → Agent (L3) → Master Agent (L2) → Super Agent (L1) → Platform (L0)
 *
 * Split percentages are configurable per transaction type.
 * Each recipient's share is credited to their commissionBalance and recorded
 * in commission_cascade_history for full audit trail.
 *
 * Middleware integration:
 *   - Redis: cache hierarchy chains (5 min TTL)
 *   - Kafka: publish commission.cascade.completed events
 *   - TigerBeetle: double-entry ledger via Go sidecar
 *   - Fluvio: real-time streaming via Rust sidecar
 */
import { eq } from "drizzle-orm";
import { agents, commissionCascadeHistory } from "../../drizzle/schema";
import { getDb } from "../db";
import { updateAgentCommission, getAgentById } from "../db";
import {
  publishCommissionEvent,
  getCachedHierarchyChain,
  setCachedHierarchyChain,
  tbRecordCommissionCredit,
  streamCommissionEvent,
} from "../middleware/commissionMiddleware";
import logger from "../_core/logger";

// ─── Default Commission Split Percentages by Hierarchy Role ──────────────────
// These define what % of total commission each hierarchy level receives
export const DEFAULT_SPLITS: Record<string, Record<string, number>> = {
  cash_in: {
    sub_agent: 10,
    agent: 60,
    master_agent: 15,
    super_agent: 10,
    platform: 5,
  },
  cash_out: {
    sub_agent: 10,
    agent: 60,
    master_agent: 15,
    super_agent: 10,
    platform: 5,
  },
  transfer: {
    sub_agent: 10,
    agent: 65,
    master_agent: 12,
    super_agent: 8,
    platform: 5,
  },
  bill_payment: {
    sub_agent: 15,
    agent: 55,
    master_agent: 15,
    super_agent: 10,
    platform: 5,
  },
  airtime: {
    sub_agent: 10,
    agent: 70,
    master_agent: 10,
    super_agent: 5,
    platform: 5,
  },
  card_payment: {
    sub_agent: 10,
    agent: 60,
    master_agent: 15,
    super_agent: 10,
    platform: 5,
  },
  qr_payment: {
    sub_agent: 10,
    agent: 60,
    master_agent: 15,
    super_agent: 10,
    platform: 5,
  },
  nfc_payment: {
    sub_agent: 10,
    agent: 60,
    master_agent: 15,
    super_agent: 10,
    platform: 5,
  },
  remittance: {
    sub_agent: 8,
    agent: 55,
    master_agent: 17,
    super_agent: 15,
    platform: 5,
  },
  pension: {
    sub_agent: 10,
    agent: 55,
    master_agent: 15,
    super_agent: 15,
    platform: 5,
  },
  insurance: {
    sub_agent: 10,
    agent: 55,
    master_agent: 15,
    super_agent: 15,
    platform: 5,
  },
};

// Fallback split if transaction type not configured
const FALLBACK_SPLIT: Record<string, number> = {
  sub_agent: 10,
  agent: 60,
  master_agent: 15,
  super_agent: 10,
  platform: 5,
};

export interface CascadeEntry {
  recipientAgentId: number;
  recipientAgentCode: string;
  recipientHierarchyRole: string;
  recipientHierarchyLevel: number;
  splitPercentage: number;
  commissionAmount: number;
}

export interface CascadeResult {
  success: boolean;
  entries: CascadeEntry[];
  cascadeEntries: CascadeEntry[];
  totalDistributed: number;
  platformShare: number;
  error?: string;
}

/**
 * Resolve the full upline hierarchy chain for an agent.
 * Returns array from the transacting agent up to the super agent.
 * Uses Redis cache with 5-minute TTL.
 */
export async function resolveHierarchyChain(agentId: number): Promise<
  Array<{
    id: number;
    agentId: string;
    hierarchyRole: string;
    level: number;
    commissionSplitOverride: number | null;
  }>
> {
  // Try Redis cache first
  const cached = await getCachedHierarchyChain(agentId);
  if (cached && cached.length > 0) {
    return cached.map(c => ({ ...c, commissionSplitOverride: null }));
  }

  const db = (await getDb())!;
  if (!db) return [];

  const chain: Array<{
    id: number;
    agentId: string;
    hierarchyRole: string;
    level: number;
    commissionSplitOverride: number | null;
  }> = [];

  let currentId: number | null = agentId;
  const visited = new Set<number>();
  let depth = 0;
  const MAX_DEPTH = 10; // prevent infinite loops

  while (currentId !== null && depth < MAX_DEPTH) {
    if (visited.has(currentId)) break; // circular reference guard
    visited.add(currentId);

    const rows: Array<{
      id: number;
      agentId: string;
      hierarchyRole: string | null;
      hierarchyLevel: number | null;
      parentAgentId: number | null;
      commissionSplitOverride: string | null;
    }> = await db
      .select({
        id: agents.id,
        agentId: agents.agentId,
        hierarchyRole: agents.hierarchyRole,
        hierarchyLevel: agents.hierarchyLevel,
        parentAgentId: agents.parentAgentId,
        commissionSplitOverride: agents.commissionSplitOverride,
      })
      .from(agents)
      .where(eq(agents.id, currentId))
      .limit(1);

    if (rows.length === 0) break;
    const row: (typeof rows)[0] = rows[0];

    chain.push({
      id: row.id,
      agentId: row.agentId,
      hierarchyRole: row.hierarchyRole ?? "agent",
      level: row.hierarchyLevel ?? 3,
      commissionSplitOverride: row.commissionSplitOverride
        ? Number(row.commissionSplitOverride)
        : null,
    });

    currentId = row.parentAgentId;
    depth++;
  }

  // Cache the chain (without overrides for simplicity)
  if (chain.length > 0) {
    await setCachedHierarchyChain(
      agentId,
      chain.map(c => ({
        id: c.id,
        agentId: c.agentId,
        hierarchyRole: c.hierarchyRole,
        level: c.level,
      }))
    );
  }

  return chain;
}

/**
 * Execute hierarchical commission cascade.
 *
 * 1. Resolve the agent's upline hierarchy chain
 * 2. Look up split percentages for the transaction type
 * 3. Calculate each recipient's share
 * 4. Credit each recipient's commissionBalance
 * 5. Record cascade entries in commission_cascade_history
 * 6. Publish events to Kafka, TigerBeetle, Fluvio
 */
export async function executeCommissionCascade(params: {
  transactionId: number;
  transactionRef: string;
  transactionType: string;
  transactionAmount: number;
  totalCommission: number;
  originAgentId: number;
  originAgentCode: string;
  tenantId?: number;
}): Promise<CascadeResult> {
  const {
    transactionId,
    transactionRef,
    transactionType,
    transactionAmount,
    totalCommission,
    originAgentId,
    originAgentCode,
    tenantId,
  } = params;

  if (totalCommission <= 0) {
    return {
      success: true,
      entries: [],
      cascadeEntries: [],
      totalDistributed: 0,
      platformShare: 0,
    };
  }

  try {
    // 1. Resolve hierarchy chain
    const chain = await resolveHierarchyChain(originAgentId);

    // If no hierarchy data (DB not connected or agent not in hierarchy),
    // fall back to crediting the full commission to the transacting agent
    if (chain.length === 0) {
      await updateAgentCommission(originAgentId, totalCommission);
      const fallbackEntry = [
        {
          recipientAgentId: originAgentId,
          recipientAgentCode: originAgentCode,
          recipientHierarchyRole: "agent",
          recipientHierarchyLevel: 3,
          splitPercentage: 100,
          commissionAmount: totalCommission,
        },
      ];
      return {
        success: true,
        entries: fallbackEntry,
        cascadeEntries: fallbackEntry,
        totalDistributed: totalCommission,
        platformShare: 0,
      };
    }

    // 2. Get split percentages for this transaction type
    const splitConfig = DEFAULT_SPLITS[transactionType] ?? FALLBACK_SPLIT;

    // 3. Calculate each recipient's share
    const entries: CascadeEntry[] = [];
    let totalDistributed = 0;
    let platformShare = 0;

    for (const member of chain) {
      const role = member.hierarchyRole;
      // Use agent-specific override if set, otherwise use default split
      const splitPct = member.commissionSplitOverride ?? splitConfig[role] ?? 0;
      const amount =
        Math.round(((totalCommission * splitPct) / 100) * 100) / 100;

      if (amount > 0 && role !== "platform") {
        entries.push({
          recipientAgentId: member.id,
          recipientAgentCode: member.agentId,
          recipientHierarchyRole: role,
          recipientHierarchyLevel: member.level,
          splitPercentage: splitPct,
          commissionAmount: amount,
        });
        totalDistributed += amount;
      }
    }

    // Platform share = remainder
    platformShare =
      Math.round((totalCommission - totalDistributed) * 100) / 100;
    if (platformShare < 0) platformShare = 0;

    // 4. Credit each recipient's commissionBalance
    for (const entry of entries) {
      await updateAgentCommission(
        entry.recipientAgentId,
        entry.commissionAmount
      );
    }

    // 5. Record cascade entries in commission_cascade_history
    const db = (await getDb())!;
    if (db) {
      try {
        for (const entry of entries) {
          await db.insert(commissionCascadeHistory).values({
            transactionId,
            transactionRef,
            transactionType,
            transactionAmount: String(transactionAmount),
            totalCommission: String(totalCommission),
            originAgentId,
            originAgentCode,
            recipientAgentId: entry.recipientAgentId,
            recipientAgentCode: entry.recipientAgentCode,
            recipientHierarchyRole: entry.recipientHierarchyRole,
            recipientHierarchyLevel: entry.recipientHierarchyLevel,
            splitPercentage: String(entry.splitPercentage),
            commissionAmount: String(entry.commissionAmount),
            status: "credited",
            tenantId,
          });
        }
      } catch (dbErr) {
        logger.warn(
          `[CommissionCascade] Failed to write cascade history: ${dbErr}`
        );
      }
    }

    // 6. Publish events to middleware
    // [Kafka] Commission cascade completed
    await publishCommissionEvent({
      eventType: "commission.cascade.completed",
      agentId: originAgentId,
      agentId: originAgentCode,
      amount: totalCommission,
      metadata: {
        transactionRef,
        transactionType,
        entries: entries.length,
        totalDistributed,
        platformShare,
      },
    });

    // [TigerBeetle] Record double-entry for each cascade entry
    for (const entry of entries) {
      await tbRecordCommissionCredit({
        transactionId,
        transactionRef,
        agentId: entry.recipientAgentId,
        agentId: entry.recipientAgentCode,
        amount: entry.commissionAmount,
        entryType:
          entry.recipientAgentId === originAgentId
            ? "direct"
            : "hierarchy_split",
        hierarchyLevel: entry.recipientHierarchyLevel,
      });
    }

    // [Fluvio] Stream cascade event
    await streamCommissionEvent({
      eventType: "cascade.completed",
      agentId: originAgentCode,
      amount: totalCommission,
    });

    logger.info(
      `[CommissionCascade] ${transactionRef}: ₦${totalCommission} distributed to ${entries.length} agents ` +
        `(platform: ₦${platformShare})`
    );

    return {
      success: true,
      entries,
      cascadeEntries: entries,
      totalDistributed,
      platformShare,
    };
  } catch (err) {
    logger.error(`[CommissionCascade] Error: ${err}`);
    // Fallback: credit full commission to origin agent
    await updateAgentCommission(originAgentId, totalCommission);
    const fallbackEntries = [
      {
        recipientAgentId: originAgentId,
        recipientAgentCode: originAgentCode,
        recipientHierarchyRole: "agent",
        recipientHierarchyLevel: 3,
        splitPercentage: 100,
        commissionAmount: totalCommission,
      },
    ];
    return {
      success: false,
      entries: fallbackEntries,
      cascadeEntries: fallbackEntries,
      totalDistributed: totalCommission,
      platformShare: 0,
      error: (err as Error).message,
    };
  }
}
