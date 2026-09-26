/**
 * poolSurplus.ts — Q-wave Q3 (2026-09-25): P2P pool period-close surplus
 * accounting engine (Pineapple-style P2P refunds + takaful wakala-adjusted
 * surplus mode).
 *
 * Pure computation lives here so the tRPC router (innovationRouters.ts) and
 * the period-close cron (server/cron/poolPeriodCloseSweep.ts) share ONE code
 * path. All money movements downstream go through the existing TigerBeetle
 * refund/settlement path (fail-closed); this module only computes and
 * persists the accounting records.
 *
 * Accounting model (per closed period):
 *   contributionsCollected = Σ member contributionPaid (pool members)
 *   claimsPaid             = Σ approved pool claims paidFromPool in period
 *   closingBalance         = current pool_balance (source of truth)
 *   openingBalance         = closing − contributions + claims
 *   reserveAmount          = closingBalance × reserveBps / 10_000
 *   surplusAmount          = max(0, closingBalance − reserveAmount)
 *   takaful mode: wakalaFeeAmount = surplus × wakalaFeeBps / 10_000 is the
 *   operator (wakeel) fee deducted BEFORE member distribution — the
 *   distributable surplus is surplus − wakalaFee.
 *
 * Invariants enforced here AND again at execute time in the router:
 *   - surplusAmount ≤ closingBalance (never distribute more than the pool holds)
 *   - Σ distribution amounts ≤ distributable surplus (surplus cap)
 *   - shares are pro-rata by contributionPaid; largest-remainder rounding
 *     keeps Σ amounts exactly ≤ cap (never above).
 */
import { and, eq, gte, lte, sql } from "drizzle-orm";

import type { getDb } from "../db";

import {
  p2pPoolClaims,
  p2pPoolMembers,
  p2pPools,
  poolPeriods,
} from "../../drizzle/schema.innovations";

export const P2P_RESERVE_BPS_DEFAULT = 2000; // 20% of closing balance retained
export const P2P_RESERVE_BPS_MAX = 9000; // a 100% reserve would zero the surplus honestly; cap at 90%
export const TAKAFUL_WAKALA_BPS_DEFAULT = 1500; // 15% operator fee on surplus
export const TAKAFUL_WAKALA_BPS_MAX = 5000; // 50% — above this is not a credible wakala fee

export interface PeriodCloseComputation {
  poolId: number;
  periodStart: string;
  periodEnd: string;
  openingBalance: number;
  contributionsCollected: number;
  claimsPaid: number;
  closingBalance: number;
  reserveBps: number;
  reserveAmount: number;
  surplusAmount: number;
  distributionMode: "p2p_refund" | "takaful_wakala";
  wakalaFeeBps: number | null;
  wakalaFeeAmount: number | null;
  distributableSurplus: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// 2026-09-26: canonical drizzle handle type from the repo's getDb() accessor
// (type-only import — no runtime cycle). Row types flow from the table
// definitions, so callers get fully-typed rows and the ESLint unsafe-*
// ratchet stays clean (previously `db: any`).
type DrizzleDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * Compute the period-close accounting for a pool. Pure read — no writes.
 * Throws on unknown pool or a negative closing balance (ledger drift —
 * fail-closed rather than distributing against a broken balance).
 */
export async function computePeriodClose(
  db: DrizzleDb,
  opts: {
    poolId: number;
    periodStart: string;
    periodEnd: string;
    reserveBps?: number;
    distributionMode?: "p2p_refund" | "takaful_wakala";
    wakalaFeeBps?: number;
  },
): Promise<PeriodCloseComputation> {
  const [pool] = await db.select().from(p2pPools).where(eq(p2pPools.id, opts.poolId)).limit(1);
  if (!pool) throw new Error(`Pool ${opts.poolId} not found`);

  const reserveBps = opts.reserveBps ?? P2P_RESERVE_BPS_DEFAULT;
  if (reserveBps < 0 || reserveBps > P2P_RESERVE_BPS_MAX) {
    throw new Error(`reserveBps ${reserveBps} outside 0..${P2P_RESERVE_BPS_MAX}`);
  }
  const distributionMode = opts.distributionMode ?? "p2p_refund";
  let wakalaFeeBps: number | null = null;
  if (distributionMode === "takaful_wakala") {
    wakalaFeeBps = opts.wakalaFeeBps ?? TAKAFUL_WAKALA_BPS_DEFAULT;
    if (wakalaFeeBps < 0 || wakalaFeeBps > TAKAFUL_WAKALA_BPS_MAX) {
      throw new Error(`wakalaFeeBps ${wakalaFeeBps} outside 0..${TAKAFUL_WAKALA_BPS_MAX}`);
    }
  }

  const [{ contributions }] = await db
    .select({ contributions: sql<string>`COALESCE(SUM(${p2pPoolMembers.contributionPaid}), 0)` })
    .from(p2pPoolMembers)
    .where(and(eq(p2pPoolMembers.poolId, opts.poolId), eq(p2pPoolMembers.status, "active")));

  const [{ claimsTotal }] = await db
    .select({ claimsTotal: sql<string>`COALESCE(SUM(${p2pPoolClaims.paidFromPool}), 0)` })
    .from(p2pPoolClaims)
    .where(and(
      eq(p2pPoolClaims.poolId, opts.poolId),
      eq(p2pPoolClaims.status, "approved"),
      gte(sql`${p2pPoolClaims.filedAt}::date`, opts.periodStart),
      lte(sql`${p2pPoolClaims.filedAt}::date`, opts.periodEnd),
    ));

  const contributionsCollected = r2(parseFloat(contributions));
  const claimsPaid = r2(parseFloat(claimsTotal));
  const closingBalance = r2(parseFloat(pool.poolBalance));
  if (closingBalance < 0) {
    throw new Error(`Pool ${opts.poolId} closing balance is negative (${closingBalance}) — ledger drift; refusing to close`);
  }
  const openingBalance = r2(closingBalance - contributionsCollected + claimsPaid);
  const reserveAmount = r2((closingBalance * reserveBps) / 10_000);
  const surplusAmount = Math.max(0, r2(closingBalance - reserveAmount));
  const wakalaFeeAmount = wakalaFeeBps != null ? r2((surplusAmount * wakalaFeeBps) / 10_000) : null;
  const distributableSurplus = r2(surplusAmount - (wakalaFeeAmount ?? 0));

  return {
    poolId: opts.poolId,
    periodStart: opts.periodStart,
    periodEnd: opts.periodEnd,
    openingBalance,
    contributionsCollected,
    claimsPaid,
    closingBalance,
    reserveBps,
    reserveAmount,
    surplusAmount,
    distributionMode,
    wakalaFeeBps,
    wakalaFeeAmount,
    distributableSurplus,
  };
}

export interface DistributionShare {
  memberId: number;
  customerId: number;
  shareBps: number;
  amount: number;
}

/**
 * Pro-rata distribution shares by contributionPaid. Largest-remainder
 * rounding: every member gets floor(share), remaining kobo-units (0.01) go
 * to the largest fractional remainders — Σ amounts ≤ distributable, and the
 * difference is at most one 0.01 unit (never an over-allocation).
 */
export async function computeDistributionShares(
  db: DrizzleDb,
  opts: { poolId: number; distributableSurplus: number },
): Promise<DistributionShare[]> {
  if (opts.distributableSurplus <= 0) return [];
  const members = await db
    .select()
    .from(p2pPoolMembers)
    .where(and(eq(p2pPoolMembers.poolId, opts.poolId), eq(p2pPoolMembers.status, "active")));
  const eligible = members.filter((m) => parseFloat(m.contributionPaid) > 0);
  const total = eligible.reduce((s: number, m) => s + parseFloat(m.contributionPaid), 0);
  if (eligible.length === 0 || total <= 0) return [];

  const totalUnits = Math.round(opts.distributableSurplus * 100);
  const raw = eligible.map((m) => {
    const shareBps = Math.round((parseFloat(m.contributionPaid) / total) * 10_000);
    const exactUnits = (parseFloat(m.contributionPaid) / total) * totalUnits;
    return {
      memberId: m.id,
      customerId: m.customerId,
      shareBps,
      floorUnits: Math.floor(exactUnits),
      remainder: exactUnits - Math.floor(exactUnits),
    };
  });
  let assigned = raw.reduce((s: number, r) => s + r.floorUnits, 0);
  const byRemainder = [...raw].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; assigned < totalUnits && i < byRemainder.length; i++, assigned++) {
    byRemainder[i]!.floorUnits += 1;
  }
  const shares = raw.map((r) => ({
    memberId: r.memberId,
    customerId: r.customerId,
    shareBps: r.shareBps,
    amount: r.floorUnits / 100,
  }));
  const sum = r2(shares.reduce((s: number, sh: DistributionShare) => s + sh.amount, 0));
  // Surplus-cap invariant (propose-time): never allocate above the cap.
  if (sum > opts.distributableSurplus + 0.005) {
    throw new Error(`Distribution over-allocation: ${sum} > ${opts.distributableSurplus}`);
  }
  return shares;
}

/**
 * Persist a closed period record. Idempotent per (poolId, periodStart) via
 * the unique index — a concurrent double-close returns the existing row.
 */
export async function persistPeriodClose(
  db: DrizzleDb,
  comp: PeriodCloseComputation,
  closedByUserId: number | null,
) {
  const [inserted] = await db
    .insert(poolPeriods)
    .values({
      poolId: comp.poolId,
      periodStart: comp.periodStart,
      periodEnd: comp.periodEnd,
      openingBalance: comp.openingBalance.toString(),
      contributionsCollected: comp.contributionsCollected.toString(),
      claimsPaid: comp.claimsPaid.toString(),
      closingBalance: comp.closingBalance.toString(),
      reserveBps: comp.reserveBps,
      reserveAmount: comp.reserveAmount.toString(),
      surplusAmount: comp.surplusAmount.toString(),
      distributionMode: comp.distributionMode,
      wakalaFeeBps: comp.wakalaFeeBps,
      wakalaFeeAmount: comp.wakalaFeeAmount?.toString() ?? null,
      status: "closed",
      closedByUserId,
      closedAt: new Date(),
    })
    .onConflictDoNothing({ target: [poolPeriods.poolId, poolPeriods.periodStart] })
    .returning();
  if (inserted) return { period: inserted, alreadyClosed: false };
  const [existing] = await db
    .select()
    .from(poolPeriods)
    .where(and(eq(poolPeriods.poolId, comp.poolId), eq(poolPeriods.periodStart, comp.periodStart)))
    .limit(1);
  // 2026-09-26: fail-closed — a conflict with no readable row means the
  // period record vanished between insert-conflict and re-read (or the read
  // replica lagged); refuse rather than returning an undefined period.
  if (!existing) {
    throw new Error(`pool_periods row for pool ${comp.poolId} (${comp.periodStart}) not found after insert conflict — refusing to proceed`);
  }
  return { period: existing, alreadyClosed: true };
}
